"""
publisher/youtube_publisher.py — Upload video clips to YouTube via Data API v3.
"""

import os
from pathlib import Path
from typing import Callable, Optional
from googleapiclient.http import MediaFileUpload
from googleapiclient.errors import HttpError

from accounts.youtube_oauth import get_youtube_service
from storage import upsert_account


def upload_to_youtube(
    account: dict,
    video_path: Path,
    title: str,
    description: str = "",
    tags: list[str] | None = None,
    category_id: str = "22",
    privacy_status: str = "public",
    made_for_kids: bool = False,
    progress_callback: Optional[Callable[[int], None]] = None,
) -> dict:
    """
    Perform resumable chunked upload to YouTube for the given account.
    Returns: {"video_id": str, "url": str, "shorts_url": str}
    """
    if not video_path.exists():
        raise FileNotFoundError(f"Video file not found at: {video_path}")

    # Build service and get refreshed account if token was refreshed
    youtube, refreshed_account = get_youtube_service(account)
    upsert_account(refreshed_account)

    safe_title = (title or "ClipForge Short")[:100]
    body = {
        "snippet": {
            "title": safe_title,
            "description": description or "",
            "tags": tags or ["Shorts", "ClipForge"],
            "categoryId": category_id or "22",
        },
        "status": {
            "privacyStatus": privacy_status.lower() if privacy_status.lower() in ("public", "private", "unlisted") else "public",
            "selfDeclaredMadeForKids": bool(made_for_kids),
        },
    }

    # Use 5MB chunks for reliable resumable upload
    chunk_size = 5 * 1024 * 1024
    media = MediaFileUpload(
        str(video_path),
        mimetype="video/mp4",
        chunksize=chunk_size,
        resumable=True,
    )

    request = youtube.videos().insert(
        part="snippet,status",
        body=body,
        media_body=media,
    )

    response = None
    while response is None:
        try:
            status, response = request.next_chunk()
            if status and progress_callback:
                progress_percent = int(status.progress() * 100)
                progress_callback(min(progress_percent, 99))
        except HttpError as err:
            raise RuntimeError(f"YouTube upload HTTP error: {err.reason} ({err.resp.status})") from err
        except Exception as err:
            raise RuntimeError(f"YouTube upload error: {str(err)}") from err

    video_id = response.get("id")
    if not video_id:
        raise RuntimeError("YouTube upload succeeded but no video ID was returned")

    if progress_callback:
        progress_callback(100)

    return {
        "video_id": video_id,
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "shorts_url": f"https://www.youtube.com/shorts/{video_id}",
    }
