"""
services/instagram_publisher.py — Instagram Reels upload & publish via Meta's
Direct Resumable Binary Upload (rupload.facebook.com).

This module replaces the legacy `video_url` approach (which required a publicly
reachable HTTPS server) with a four-step flow that pushes raw video bytes
directly from the server to Meta — no ngrok, no S3, no public URL needed.

Flow:
  Step 1  – Create a media container with upload_type=resumable → get container_id + upload URI
  Step 2  – Upload raw video bytes to rupload.facebook.com
  Step 3  – Poll the container until status_code == FINISHED
  Step 4  – Publish the container → get the final media_id
"""

from __future__ import annotations

import asyncio
import logging
import subprocess
import json
import tempfile
from pathlib import Path
from typing import Optional

import httpx

from config import get_settings
from services.models import PublishPlatform, PublishResult, PublishStatus

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Custom exception
# ---------------------------------------------------------------------------

class InstagramPublishError(Exception):
    """Raised for known, handled Instagram API errors."""


# ---------------------------------------------------------------------------
# Private helper steps
# ---------------------------------------------------------------------------

async def _create_container(
    client: httpx.AsyncClient,
    ig_user_id: str,
    caption: str,
    share_to_feed: bool,
    token: str,
) -> tuple[str, str]:
    """
    Step 1 — Create a resumable media container on Meta's servers.

    Args:
        client: Shared httpx async client.
        ig_user_id: Instagram Business Account ID.
        caption: Post caption (with hashtags).
        share_to_feed: Whether the reel should appear on the profile grid.
        token: Page Access Token.

    Returns:
        A (container_id, upload_uri) tuple.
    """
    settings = get_settings()
    url = f"{settings.graph_url}/{ig_user_id}/media"

    data = {
        "media_type": "REELS",
        "upload_type": "resumable",
        "caption": caption,
        # MUST be sent as lowercase string, not a Python bool
        "share_to_feed": "true" if share_to_feed else "false",
        "access_token": token,
    }

    logger.info("[IG Reels] Step 1 – Creating media container for IG user %s", ig_user_id)
    resp = await client.post(url, data=data)
    resp.raise_for_status()
    body = resp.json()

    container_id: str = body.get("id", "")
    upload_uri: str = body.get("uri", "")

    if not container_id:
        raise InstagramPublishError(
            f"Meta did not return a container ID.  Response: {body}"
        )
    if not upload_uri:
        raise InstagramPublishError(
            f"Meta did not return an upload URI.  Response: {body}"
        )

    logger.info("[IG Reels] Step 1 – Container created: %s", container_id)
    return container_id, upload_uri


async def _upload_video(
    client: httpx.AsyncClient,
    upload_uri: str,
    video_path: Path,
    token: str,
) -> None:
    """
    Step 2 — Upload the raw video bytes to Meta's rupload endpoint.

    Small files (≤ chunk_size) are sent in a single request.
    Larger files are sent in sequential chunks, each with an updated ``offset``
    header, until the full file is transferred.

    The video is sent as raw binary content (``content=`` kwarg in httpx),
    NOT as multipart form data.

    Args:
        client: Shared httpx async client.
        upload_uri: The rupload.facebook.com URL returned by Step 1.
        video_path: Absolute path to the MP4 clip.
        token: Page Access Token.
    """
    settings = get_settings()
    total_bytes = video_path.stat().st_size
    chunk_size = settings.chunk_size_bytes

    logger.info(
        "[IG Reels] Step 2 – Uploading %s bytes to rupload (%s chunk size)",
        total_bytes,
        chunk_size,
    )

    with video_path.open("rb") as fh:
        offset = 0
        while offset < total_bytes:
            chunk = fh.read(chunk_size)
            if not chunk:
                break

            headers = {
                "Authorization": f"OAuth {token}",
                "offset": str(offset),
                "file_size": str(total_bytes),
            }

            resp = await client.post(upload_uri, content=chunk, headers=headers)
            resp.raise_for_status()
            body = resp.json()

            # On success the response contains an "h" key (upload handle)
            if "h" not in body and offset + len(chunk) >= total_bytes:
                logger.warning(
                    "[IG Reels] Step 2 – Final chunk response missing 'h' key: %s", body
                )

            offset += len(chunk)
            logger.info(
                "[IG Reels] Step 2 – Uploaded %s / %s bytes (%.0f%%)",
                min(offset, total_bytes),
                total_bytes,
                100 * min(offset, total_bytes) / total_bytes,
            )

    logger.info("[IG Reels] Step 2 – Upload complete")


async def _poll_container_status(
    client: httpx.AsyncClient,
    container_id: str,
    token: str,
) -> None:
    """
    Step 3 — Poll the container until it is ready to publish.

    Meta processes the uploaded video asynchronously.  We poll every
    ``poll_interval_seconds`` seconds for up to ``poll_max_attempts`` attempts.

    Args:
        client: Shared httpx async client.
        container_id: The container ID returned by Step 1.
        token: Page Access Token.

    Raises:
        InstagramPublishError: If the container ends in an ERROR or EXPIRED state,
            or if polling times out.
    """
    settings = get_settings()
    url = f"{settings.graph_url}/{container_id}"
    params = {"fields": "status_code,status", "access_token": token}

    logger.info("[IG Reels] Step 3 – Polling container %s …", container_id)

    for attempt in range(1, settings.poll_max_attempts + 1):
        await asyncio.sleep(settings.poll_interval_seconds)

        resp = await client.get(url, params=params)
        resp.raise_for_status()
        body = resp.json()

        status_code: str = body.get("status_code", "IN_PROGRESS")
        status_detail: str = body.get("status", "")

        logger.info(
            "[IG Reels] Step 3 – Attempt %d/%d: status_code=%s",
            attempt,
            settings.poll_max_attempts,
            status_code,
        )

        if status_code == "FINISHED":
            logger.info("[IG Reels] Step 3 – Container ready to publish")
            return
        elif status_code == "ERROR":
            raise InstagramPublishError(
                f"Instagram container processing failed: {status_detail or 'unknown error'}"
            )
        elif status_code == "EXPIRED":
            raise InstagramPublishError(
                "Instagram container expired before it could be published (~24 h limit)."
            )
        # status_code == "IN_PROGRESS" → continue polling

    raise InstagramPublishError(
        f"Timed out waiting for Instagram container {container_id} to finish "
        f"(waited {settings.poll_max_attempts * settings.poll_interval_seconds}s)."
    )


async def _publish_container(
    client: httpx.AsyncClient,
    ig_user_id: str,
    container_id: str,
    token: str,
) -> str:
    """
    Step 4 — Publish the processed container to Instagram.

    Args:
        client: Shared httpx async client.
        ig_user_id: Instagram Business Account ID.
        container_id: Container ID from Step 1.
        token: Page Access Token.

    Returns:
        The published Instagram media ID.
    """
    settings = get_settings()
    url = f"{settings.graph_url}/{ig_user_id}/media_publish"

    data = {
        "creation_id": container_id,
        "access_token": token,
    }

    logger.info("[IG Reels] Step 4 – Publishing container %s", container_id)
    resp = await client.post(url, data=data)
    resp.raise_for_status()
    body = resp.json()

    media_id: str = body.get("id", "")
    if not media_id:
        raise InstagramPublishError(
            f"Media publish did not return an ID.  Response: {body}"
        )

    logger.info("[IG Reels] Step 4 – Published!  Media ID: %s", media_id)
    return media_id


def ensure_instagram_compliant_clip(video_path: Path) -> tuple[Path, bool]:
    """
    Ensure the clip meets Meta's strict Instagram Reels encoding requirements:
      - Pixel Aspect Ratio: 1:1 (setsar=1)
      - Audio: AAC, 48000 Hz, stereo
      - Container: MP4 with moov atom at start (faststart)
      - Profile: H.264 Main profile
    If compliant, returns (video_path, False).
    If adjustment is needed, quickly transcodes to a temp file and returns (temp_path, True).
    """
    needs_remux = False
    try:
        cmd = ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", str(video_path)]
        info = json.loads(subprocess.check_output(cmd).decode())
        video_stream = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), None)
        audio_stream = next((s for s in info.get("streams", []) if s.get("codec_type") == "audio"), None)

        if video_stream:
            sar = video_stream.get("sample_aspect_ratio", "1:1")
            profile = video_stream.get("profile", "")
            if sar not in ("1:1", "1/1") or "baseline" in profile.lower():
                needs_remux = True

        if audio_stream:
            sample_rate = str(audio_stream.get("sample_rate", "48000"))
            if sample_rate != "48000":
                needs_remux = True
    except Exception as e:
        logger.warning("[IG Reels] Could not probe video specs (%s), assuming remux needed", e)
        needs_remux = True

    if not needs_remux:
        return video_path, False

    logger.info("[IG Reels] Optimizing video specs for Meta compliance (setsar=1, 48kHz audio)...")
    temp_dir = Path(tempfile.gettempdir())
    out_file = temp_dir / f"meta_ig_{video_path.stem}.mp4"

    ffmpeg_cmd = [
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-vf", "setsar=1",
        "-c:v", "libx264", "-profile:v", "main", "-level", "4.0", "-pix_fmt", "yuv420p",
        "-b:v", "2500k", "-maxrate", "3000k", "-bufsize", "5000k",
        "-c:a", "aac", "-ar", "48000", "-b:a", "128k",
        "-movflags", "+faststart",
        str(out_file),
    ]
    try:
        subprocess.run(ffmpeg_cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return out_file, True
    except Exception as exc:
        logger.warning("[IG Reels] FFmpeg compliance optimization failed: %s; using original file", exc)
        return video_path, False


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

async def publish_instagram_reel(
    video_path: Path,
    caption: str,
    share_to_feed: bool = True,
    ig_user_id: Optional[str] = None,
    page_access_token: Optional[str] = None,
) -> PublishResult:
    """
    Publish a vertical MP4 clip as an Instagram Reel using Meta's resumable
    binary upload (no public URL required).

    Args:
        video_path: Absolute path to the MP4 file.
        caption: Reel caption (with hashtags).
        share_to_feed: If True, the Reel is also shown on the profile grid.
        ig_user_id: Instagram Business Account ID.  Falls back to the value
            in settings (``instagram_account_id``) if not provided.
        page_access_token: Page Access Token.  Falls back to settings
            (``meta_page_access_token``) if not provided.

    Returns:
        A ``PublishResult`` with status ``published`` on success, or
        ``failed`` with an ``error_message`` on any failure.
    """
    settings = get_settings()
    ig_uid = ig_user_id or settings.instagram_account_id
    token = page_access_token or settings.meta_page_access_token

    # ------------------------------------------------------------------ #
    # Input validation                                                     #
    # ------------------------------------------------------------------ #
    if not ig_uid:
        return PublishResult(
            platform=PublishPlatform.instagram_reels,
            status=PublishStatus.failed,
            error_message=(
                "INSTAGRAM_ACCOUNT_ID is not configured.  "
                "Run GET /api/v1/meta-publish/auth/discover to find your ID, "
                "then add it to .env as INSTAGRAM_ACCOUNT_ID."
            ),
        )

    if not token:
        return PublishResult(
            platform=PublishPlatform.instagram_reels,
            status=PublishStatus.failed,
            error_message=(
                "META_PAGE_ACCESS_TOKEN is not configured.  "
                "Use the /auth/page-token endpoint to generate and store a "
                "never-expiring page token."
            ),
        )

    if not video_path.is_file():
        return PublishResult(
            platform=PublishPlatform.instagram_reels,
            status=PublishStatus.failed,
            error_message=f"Clip file not found: {video_path}",
        )

    # ------------------------------------------------------------------ #
    # Execute 4-step upload flow                                           #
    # ------------------------------------------------------------------ #
    upload_file, is_temp = ensure_instagram_compliant_clip(video_path)
    try:
        # 300-second timeout to accommodate large file uploads
        async with httpx.AsyncClient(timeout=300) as client:
            container_id, upload_uri = await _create_container(
                client, ig_uid, caption, share_to_feed, token
            )
            await _upload_video(client, upload_uri, upload_file, token)
            await _poll_container_status(client, container_id, token)
            media_id = await _publish_container(client, ig_uid, container_id, token)

        return PublishResult(
            platform=PublishPlatform.instagram_reels,
            status=PublishStatus.published,
            media_id=media_id,
            details={"ig_user_id": ig_uid},
        )

    except InstagramPublishError as exc:
        logger.error("[IG Reels] Known error: %s", exc)
        return PublishResult(
            platform=PublishPlatform.instagram_reels,
            status=PublishStatus.failed,
            error_message=str(exc),
        )
    except httpx.HTTPStatusError as exc:
        body_text = exc.response.text[:1000]
        msg = f"HTTP {exc.response.status_code}: {body_text}"
        logger.error("[IG Reels] HTTPStatusError: %s", msg)
        return PublishResult(
            platform=PublishPlatform.instagram_reels,
            status=PublishStatus.failed,
            error_message=msg,
        )
    except Exception as exc:
        logger.exception("[IG Reels] Unexpected error")
        return PublishResult(
            platform=PublishPlatform.instagram_reels,
            status=PublishStatus.failed,
            error_message=f"Unexpected error: {exc}",
        )
    finally:
        if is_temp and upload_file and upload_file.exists():
            try:
                upload_file.unlink(missing_ok=True)
            except Exception:
                pass

