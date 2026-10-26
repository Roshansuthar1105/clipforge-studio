"""
publisher/instagram_publisher.py — Publish Instagram Reels via Meta Graph API.
"""

import os
import time
from typing import Callable, Optional
import requests
from dotenv import load_dotenv

load_dotenv()

META_GRAPH_URL = "https://graph.facebook.com/v19.0"


def publish_to_instagram_reel(
    account: dict,
    video_public_url: str,
    caption: str = "",
    share_to_feed: bool = True,
    progress_callback: Optional[Callable[[int, str], None]] = None,
) -> dict:
    """
    Publish a Reel to an Instagram Business/Creator account.
    Requires:
      - account['channel_id']: Instagram User ID
      - account['access_token']: Page or User Access Token with instagram_content_publish
      - video_public_url: Publicly reachable HTTPS URL where Instagram can download the video
    Returns: {"media_id": str, "permalink": str, "url": str}
    """
    ig_user_id = account.get("channel_id")
    token = account.get("access_token")

    if not ig_user_id or not token:
        raise ValueError("Instagram account is missing channel_id or access_token")

    if "localhost" in video_public_url or "127.0.0.1" in video_public_url:
        raise ValueError(
            f"Instagram requires a publicly accessible video URL, but got: {video_public_url}. "
            "Please configure PUBLIC_BASE_URL in .env (e.g. using ngrok or cloud domain) so Meta can download the clip."
        )

    # Step 1: Initialize container
    if progress_callback:
        progress_callback(10, "Creating reel container...")

    container_endpoint = f"{META_GRAPH_URL}/{ig_user_id}/media"
    container_params = {
        "media_type": "REELS",
        "video_url": video_public_url,
        "caption": caption or "",
        "share_to_feed": "true" if share_to_feed else "false",
        "access_token": token,
    }

    resp = requests.post(container_endpoint, data=container_params, timeout=30)
    if resp.status_code != 200:
        err_msg = resp.text
        try:
            err_json = resp.json().get("error", {})
            err_msg = err_json.get("message", resp.text)
        except Exception:
            pass
        raise RuntimeError(f"Failed to create Instagram container ({resp.status_code}): {err_msg}")

    container_id = resp.json().get("id")
    if not container_id:
        raise RuntimeError("Instagram container ID was not returned")

    # Step 2: Poll container until processed
    if progress_callback:
        progress_callback(30, "Waiting for Instagram to process video...")

    poll_url = f"{META_GRAPH_URL}/{container_id}"
    max_wait_seconds = 180
    start_time = time.time()
    status_code = "IN_PROGRESS"

    while status_code != "FINISHED":
        if time.time() - start_time > max_wait_seconds:
            raise TimeoutError("Timed out waiting for Instagram to process video container (180s)")

        time.sleep(5)
        poll_resp = requests.get(
            poll_url,
            params={"fields": "status_code,status", "access_token": token},
            timeout=15,
        )
        if poll_resp.status_code != 200:
            raise RuntimeError(f"Error checking container status: {poll_resp.text}")

        res_data = poll_resp.json()
        status_code = res_data.get("status_code", "IN_PROGRESS")

        if status_code == "ERROR":
            err_details = res_data.get("status", "Unknown processing error")
            raise RuntimeError(f"Instagram container processing failed: {err_details}")
        elif status_code == "EXPIRED":
            raise RuntimeError("Instagram container expired before publishing")

        elapsed = int(time.time() - start_time)
        est_pct = min(30 + int(elapsed * 1.5), 85)
        if progress_callback:
            progress_callback(est_pct, f"Processing by Instagram ({status_code})...")

    # Step 3: Publish container
    if progress_callback:
        progress_callback(90, "Publishing Reel...")

    publish_endpoint = f"{META_GRAPH_URL}/{ig_user_id}/media_publish"
    publish_params = {
        "creation_id": container_id,
        "access_token": token,
    }
    pub_resp = requests.post(publish_endpoint, data=publish_params, timeout=30)
    if pub_resp.status_code != 200:
        raise RuntimeError(f"Instagram publish failed ({pub_resp.status_code}): {pub_resp.text}")

    media_id = pub_resp.json().get("id")

    # Step 4: Fetch permalink
    permalink = None
    try:
        media_info = requests.get(
            f"{META_GRAPH_URL}/{media_id}",
            params={"fields": "permalink,id", "access_token": token},
            timeout=10,
        ).json()
        permalink = media_info.get("permalink")
    except Exception:
        pass

    fallback_url = permalink or f"https://www.instagram.com/reel/{media_id}"
    if progress_callback:
        progress_callback(100, "Published successfully!")

    return {
        "media_id": media_id,
        "permalink": fallback_url,
        "url": fallback_url,
    }
