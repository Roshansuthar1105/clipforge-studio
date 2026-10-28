"""
services/facebook_publisher.py — Facebook Page Reels and Feed Video upload via
Meta's Direct Resumable Binary Upload.

Two publish modes are supported:

A) Facebook Reels (``publish_facebook_reel``) — 3-phase binary upload:
   Phase 1  START  : POST /{page_id}/video_reels (upload_phase=start) → video_id + upload_url
   Phase 2  UPLOAD : POST {upload_url}           raw binary bytes
   Phase 3  FINISH : POST /{page_id}/video_reels (upload_phase=finish)

B) Facebook Feed Video (``publish_facebook_video``) — 3-phase chunked multipart:
   Phase 1  START    : POST /{page_id}/videos (upload_phase=start, file_size) → session + offsets
   Phase 2  TRANSFER : POST /{page_id}/videos (upload_phase=transfer, chunk per response offsets)
   Phase 3  FINISH   : POST /{page_id}/videos (upload_phase=finish)

Neither flow requires a publicly reachable URL.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

import httpx

from config import get_settings
from services.models import PublishPlatform, PublishResult, PublishStatus

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Custom exception
# ---------------------------------------------------------------------------

class FacebookPublishError(Exception):
    """Raised for known, handled Facebook API errors."""


# ===========================================================================
# Part A — Facebook Page Reels (rupload binary upload, no polling needed)
# ===========================================================================

async def _fb_reel_start(
    client: httpx.AsyncClient,
    page_id: str,
    token: str,
) -> tuple[str, str]:
    """
    Phase 1 — Initialise a Facebook Reels upload session.

    Args:
        client: Shared httpx async client.
        page_id: Facebook Page ID.
        token: Page Access Token.

    Returns:
        (video_id, upload_url) tuple.
    """
    settings = get_settings()
    url = f"{settings.graph_url}/{page_id}/video_reels"
    data = {
        "upload_phase": "start",
        "access_token": token,
    }

    logger.info("[FB Reels] Phase 1 – Starting upload session for page %s", page_id)
    resp = await client.post(url, data=data)
    resp.raise_for_status()
    body = resp.json()

    video_id: str = body.get("video_id", "")
    upload_url: str = body.get("upload_url", "")

    if not video_id or not upload_url:
        raise FacebookPublishError(
            f"Phase 1 response missing video_id or upload_url.  Response: {body}"
        )

    logger.info("[FB Reels] Phase 1 – video_id=%s", video_id)
    return video_id, upload_url


async def _fb_reel_upload(
    client: httpx.AsyncClient,
    upload_url: str,
    video_path: Path,
    token: str,
) -> None:
    """
    Phase 2 — Upload raw video bytes to rupload.facebook.com.

    The full file is sent in a single request as raw binary content (``content=``),
    not multipart form data.  Large files may take a while — the client timeout
    is set to 300 s.

    Args:
        client: Shared httpx async client.
        upload_url: The rupload URL from Phase 1.
        video_path: Absolute path to the MP4.
        token: Page Access Token.
    """
    total_bytes = video_path.stat().st_size
    headers = {
        "Authorization": f"OAuth {token}",
        # Custom Meta headers — not standard HTTP
        "offset": "0",
        "file_size": str(total_bytes),
    }

    logger.info("[FB Reels] Phase 2 – Uploading %s bytes to rupload", total_bytes)

    video_data = video_path.read_bytes()
    resp = await client.post(upload_url, content=video_data, headers=headers)
    resp.raise_for_status()
    body = resp.json()

    # Successful response contains "success": true or an "h" key
    if not body.get("success") and "h" not in body:
        logger.warning("[FB Reels] Phase 2 – Unexpected upload response: %s", body)

    logger.info("[FB Reels] Phase 2 – Upload complete")


async def _fb_reel_finish(
    client: httpx.AsyncClient,
    page_id: str,
    video_id: str,
    token: str,
    title: str = "",
    description: str = "",
) -> None:
    """
    Phase 3 — Finalise the Reel upload and trigger Meta's processing pipeline.

    Facebook handles the rest after this call returns.  The Reel will appear on
    the Page within minutes once Meta finishes processing (no polling needed).

    Args:
        client: Shared httpx async client.
        page_id: Facebook Page ID.
        video_id: The video ID from Phase 1.
        token: Page Access Token.
        title: Optional Reel title.
        description: Optional Reel description / caption.
    """
    settings = get_settings()
    url = f"{settings.graph_url}/{page_id}/video_reels"
    data = {
        "upload_phase": "finish",
        "video_id": video_id,
        "access_token": token,
        "video_state": "PUBLISHED",
    }
    if title:
        data["title"] = title
    if description:
        data["description"] = description

    logger.info("[FB Reels] Phase 3 – Finishing upload for video_id=%s with video_state=PUBLISHED", video_id)
    resp = await client.post(url, data=data)
    resp.raise_for_status()
    body = resp.json()

    if not body.get("success"):
        raise FacebookPublishError(
            f"Phase 3 finish did not return success=true.  Response: {body}"
        )

    logger.info("[FB Reels] Phase 3 – Reel submitted for processing")


async def publish_facebook_reel(
    video_path: Path,
    caption: str = "",
    title: str = "",
    page_id: Optional[str] = None,
    page_access_token: Optional[str] = None,
) -> PublishResult:
    """
    Publish a vertical MP4 as a Facebook Page Reel.

    Uses a 3-phase resumable binary upload.  No polling step is needed —
    Meta processes the video asynchronously after Phase 3 completes.

    Args:
        video_path: Absolute path to the MP4 clip.
        caption: Reel description / caption.
        title: Optional Reel title.
        page_id: Facebook Page ID.  Falls back to settings (``facebook_page_id``).
        page_access_token: Page Access Token.  Falls back to settings
            (``meta_page_access_token``).

    Returns:
        ``PublishResult`` with status ``published`` on success or ``failed``
        with an ``error_message`` on any failure.
    """
    settings = get_settings()
    pid = page_id or settings.facebook_page_id
    token = page_access_token or settings.meta_page_access_token

    # ------------------------------------------------------------------ #
    # Input validation                                                     #
    # ------------------------------------------------------------------ #
    if not pid:
        return PublishResult(
            platform=PublishPlatform.facebook_reels,
            status=PublishStatus.failed,
            error_message=(
                "FACEBOOK_PAGE_ID is not configured.  "
                "Use GET /api/v1/meta-publish/auth/discover to find your Page ID "
                "and add it to .env as FACEBOOK_PAGE_ID."
            ),
        )

    if not token:
        return PublishResult(
            platform=PublishPlatform.facebook_reels,
            status=PublishStatus.failed,
            error_message=(
                "META_PAGE_ACCESS_TOKEN is not configured.  "
                "Use the /auth/page-token endpoint to obtain a never-expiring token."
            ),
        )

    if not video_path.is_file():
        return PublishResult(
            platform=PublishPlatform.facebook_reels,
            status=PublishStatus.failed,
            error_message=f"Clip file not found: {video_path}",
        )

    # ------------------------------------------------------------------ #
    # Execute 3-phase upload                                               #
    # ------------------------------------------------------------------ #
    try:
        permalink_url = ""
        async with httpx.AsyncClient(timeout=300) as client:
            video_id, upload_url = await _fb_reel_start(client, pid, token)
            await _fb_reel_upload(client, upload_url, video_path, token)
            await _fb_reel_finish(client, pid, video_id, token, title=title, description=caption)

            try:
                p_resp = await client.get(
                    f"{settings.graph_url}/{video_id}",
                    params={"fields": "permalink_url,status", "access_token": token},
                    timeout=10,
                )
                if p_resp.status_code == 200:
                    p_data = p_resp.json()
                    permalink_url = p_data.get("permalink_url") or ""
            except Exception:
                pass

        if not permalink_url:
            permalink_url = f"/reel/{video_id}/"

        return PublishResult(
            platform=PublishPlatform.facebook_reels,
            status=PublishStatus.published,
            media_id=video_id,
            details={"page_id": pid, "permalink_url": permalink_url},
        )

    except FacebookPublishError as exc:
        logger.error("[FB Reels] Known error: %s", exc)
        return PublishResult(
            platform=PublishPlatform.facebook_reels,
            status=PublishStatus.failed,
            error_message=str(exc),
        )
    except httpx.HTTPStatusError as exc:
        body_text = exc.response.text[:1000]
        msg = f"HTTP {exc.response.status_code}: {body_text}"
        logger.error("[FB Reels] HTTPStatusError: %s", msg)
        return PublishResult(
            platform=PublishPlatform.facebook_reels,
            status=PublishStatus.failed,
            error_message=msg,
        )
    except Exception as exc:
        logger.exception("[FB Reels] Unexpected error")
        return PublishResult(
            platform=PublishPlatform.facebook_reels,
            status=PublishStatus.failed,
            error_message=f"Unexpected error: {exc}",
        )


# ===========================================================================
# Part B — Facebook Feed Video (chunked multipart, Meta controls offsets)
# ===========================================================================

async def _fb_video_start(
    client: httpx.AsyncClient,
    page_id: str,
    file_size: int,
    token: str,
) -> tuple[str, str, int, int]:
    """
    Phase 1 — Initiate a chunked Facebook Feed Video upload session.

    Args:
        client: Shared httpx async client.
        page_id: Facebook Page ID.
        file_size: Total size of the video file in bytes.
        token: Page Access Token.

    Returns:
        (upload_session_id, video_id, start_offset, end_offset) tuple.
    """
    settings = get_settings()
    url = f"{settings.graph_url}/{page_id}/videos"
    data = {
        "upload_phase": "start",
        "file_size": str(file_size),
        "access_token": token,
    }

    logger.info("[FB Video] Phase 1 – Starting chunked upload session (%d bytes)", file_size)
    resp = await client.post(url, data=data)
    resp.raise_for_status()
    body = resp.json()

    session_id: str = body.get("upload_session_id", "")
    video_id: str = body.get("video_id", "")
    start_offset: int = int(body.get("start_offset", 0))
    end_offset: int = int(body.get("end_offset", 0))

    if not session_id or not video_id:
        raise FacebookPublishError(
            f"Phase 1 response missing upload_session_id or video_id.  Response: {body}"
        )

    logger.info(
        "[FB Video] Phase 1 – session=%s video=%s first_chunk=[%d, %d)",
        session_id, video_id, start_offset, end_offset,
    )
    return session_id, video_id, start_offset, end_offset


async def _fb_video_transfer(
    client: httpx.AsyncClient,
    page_id: str,
    upload_session_id: str,
    video_path: Path,
    start_offset: int,
    end_offset: int,
    token: str,
) -> None:
    """
    Phase 2 — Transfer all video chunks.  Meta dictates chunk boundaries via
    ``start_offset`` / ``end_offset`` returned in each response.

    The loop continues until ``start_offset == end_offset`` (all bytes sent).

    Args:
        client: Shared httpx async client.
        page_id: Facebook Page ID.
        upload_session_id: Session ID from Phase 1.
        video_path: Absolute path to the MP4.
        start_offset: Initial byte offset (from Phase 1 response).
        end_offset: Initial end byte (from Phase 1 response).
        token: Page Access Token.
    """
    settings = get_settings()
    url = f"{settings.graph_url}/{page_id}/videos"
    total_bytes = video_path.stat().st_size

    logger.info("[FB Video] Phase 2 – Beginning chunk transfer")

    with video_path.open("rb") as fh:
        while start_offset != end_offset:
            chunk_size = end_offset - start_offset
            fh.seek(start_offset)
            chunk_data = fh.read(chunk_size)

            # This phase uses multipart form data (unlike the Reels binary upload)
            files = {
                "video_file_chunk": (
                    video_path.name,
                    chunk_data,
                    "application/octet-stream",
                ),
            }
            form_data = {
                "upload_phase": "transfer",
                "upload_session_id": upload_session_id,
                "start_offset": str(start_offset),
                "access_token": token,
            }

            resp = await client.post(url, data=form_data, files=files)
            resp.raise_for_status()
            body = resp.json()

            # Update offsets from the response — Meta controls the next chunk boundary
            new_start = int(body.get("start_offset", start_offset))
            new_end = int(body.get("end_offset", end_offset))

            logger.info(
                "[FB Video] Phase 2 – Uploaded bytes [%d, %d) → next=[%d, %d) (%.0f%%)",
                start_offset, end_offset, new_start, new_end,
                100 * min(new_start, total_bytes) / total_bytes,
            )

            start_offset = new_start
            end_offset = new_end

    logger.info("[FB Video] Phase 2 – All chunks transferred")


async def _fb_video_finish(
    client: httpx.AsyncClient,
    page_id: str,
    upload_session_id: str,
    token: str,
    title: str = "",
    description: str = "",
) -> None:
    """
    Phase 3 — Finalise the Feed Video upload.

    Args:
        client: Shared httpx async client.
        page_id: Facebook Page ID.
        upload_session_id: Session ID from Phase 1.
        token: Page Access Token.
        title: Optional video title.
        description: Optional video description / caption.
    """
    settings = get_settings()
    url = f"{settings.graph_url}/{page_id}/videos"
    data = {
        "upload_phase": "finish",
        "upload_session_id": upload_session_id,
        "access_token": token,
    }
    if title:
        data["title"] = title
    if description:
        data["description"] = description

    logger.info(
        "[FB Video] Phase 3 – Finishing upload for session %s", upload_session_id
    )
    resp = await client.post(url, data=data)
    resp.raise_for_status()
    body = resp.json()

    if not body.get("success"):
        raise FacebookPublishError(
            f"Phase 3 finish did not return success=true.  Response: {body}"
        )

    logger.info("[FB Video] Phase 3 – Video submitted for processing")


async def publish_facebook_video(
    video_path: Path,
    caption: str = "",
    title: str = "",
    page_id: Optional[str] = None,
    page_access_token: Optional[str] = None,
) -> PublishResult:
    """
    Publish an MP4 as a Facebook Page Feed Video using the 3-phase chunked
    multipart upload API.

    Args:
        video_path: Absolute path to the MP4 clip.
        caption: Video description / caption.
        title: Optional video title.
        page_id: Facebook Page ID.  Falls back to settings (``facebook_page_id``).
        page_access_token: Page Access Token.  Falls back to settings
            (``meta_page_access_token``).

    Returns:
        ``PublishResult`` with status ``published`` on success or ``failed``
        with an ``error_message`` on any failure.
    """
    settings = get_settings()
    pid = page_id or settings.facebook_page_id
    token = page_access_token or settings.meta_page_access_token

    # ------------------------------------------------------------------ #
    # Input validation                                                     #
    # ------------------------------------------------------------------ #
    if not pid:
        return PublishResult(
            platform=PublishPlatform.facebook_video,
            status=PublishStatus.failed,
            error_message=(
                "FACEBOOK_PAGE_ID is not configured.  "
                "Use GET /api/v1/meta-publish/auth/discover to find your Page ID."
            ),
        )

    if not token:
        return PublishResult(
            platform=PublishPlatform.facebook_video,
            status=PublishStatus.failed,
            error_message=(
                "META_PAGE_ACCESS_TOKEN is not configured.  "
                "Use the /auth/page-token endpoint to obtain a never-expiring token."
            ),
        )

    if not video_path.is_file():
        return PublishResult(
            platform=PublishPlatform.facebook_video,
            status=PublishStatus.failed,
            error_message=f"Clip file not found: {video_path}",
        )

    # ------------------------------------------------------------------ #
    # Execute 3-phase chunked upload                                       #
    # ------------------------------------------------------------------ #
    try:
        file_size = video_path.stat().st_size

        async with httpx.AsyncClient(timeout=300) as client:
            session_id, video_id, start_offset, end_offset = await _fb_video_start(
                client, pid, file_size, token
            )
            await _fb_video_transfer(
                client, pid, session_id, video_path, start_offset, end_offset, token
            )
            await _fb_video_finish(
                client, pid, session_id, token, title=title, description=caption
            )

        return PublishResult(
            platform=PublishPlatform.facebook_video,
            status=PublishStatus.published,
            media_id=video_id,
            details={"page_id": pid, "upload_session_id": session_id},
        )

    except FacebookPublishError as exc:
        logger.error("[FB Video] Known error: %s", exc)
        return PublishResult(
            platform=PublishPlatform.facebook_video,
            status=PublishStatus.failed,
            error_message=str(exc),
        )
    except httpx.HTTPStatusError as exc:
        body_text = exc.response.text[:1000]
        msg = f"HTTP {exc.response.status_code}: {body_text}"
        logger.error("[FB Video] HTTPStatusError: %s", msg)
        return PublishResult(
            platform=PublishPlatform.facebook_video,
            status=PublishStatus.failed,
            error_message=msg,
        )
    except Exception as exc:
        logger.exception("[FB Video] Unexpected error")
        return PublishResult(
            platform=PublishPlatform.facebook_video,
            status=PublishStatus.failed,
            error_message=f"Unexpected error: {exc}",
        )
