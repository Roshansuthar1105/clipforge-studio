"""
test_post_reel.py — Standalone script to test publishing a video clip as an Instagram Reel
using Instagram Graph API v26.0 with container creation and status polling.
"""

import os
import sys
import time
from pathlib import Path
from urllib.parse import quote
import requests
from dotenv import load_dotenv

# Ensure Unicode output works across all Windows terminals
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

load_dotenv()

# --------------------------------------------------
# CONFIGURATION
# --------------------------------------------------

INSTAGRAM_USER_ID = os.getenv("INSTAGRAM_USER_ID", "17841461512030909")
INSTAGRAM_ACCESS_TOKEN = os.getenv(
    "INSTAGRAM_ACCESS_TOKEN",
    "IGAAPR8q5u1O1BZAGFtYVRjUHc3dGp5Wk8zSGQ4MVNFNGJvUENERXQ0VDZAvQUhtZAkVDUGo0ZADRjXzBvYUJuMU9hOGY5ME5KZAkNNSUJNaUQ0QmNDVExtTTYtWXZAjcmxwMmdKTTg0NEtNYmRWLUJCMGROc1NmdVlRRUZAtd1dMRks2OAZDZD",
)
BASE_API_URL = "https://graph.instagram.com/v26.0"

# Note: Instagram requires a publicly accessible HTTPS video URL.
# If you are running ngrok (e.g. `ngrok http 8000`), set PUBLIC_BASE_URL in your .env
# e.g.: https://xxxx.ngrok-free.app/media/clips/Phulera%20Ka%20Asli%20Mard_part_1.mp4
DEFAULT_LOCAL_CLIP = "Phulera Ka Asli Mard_part_1.mp4"
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")


def check_account_details():
    """Verify Instagram account ID and username."""
    print("\n🔍 Step 0: Checking Instagram Account Details...")
    url = f"{BASE_API_URL}/me"
    params = {
        "fields": "user_id,username,name",
        "access_token": INSTAGRAM_ACCESS_TOKEN,
    }
    resp = requests.get(url, params=params, timeout=15)
    if resp.status_code != 200:
        print(f"❌ Failed to query account info ({resp.status_code}): {resp.text}")
        return False
    data = resp.json()
    print(f"✅ Connected as: @{data.get('username')} (ID: {data.get('user_id') or data.get('id')})")
    return True


def create_reel_container(video_url: str, caption: str) -> str:
    """Create Reel media container on Instagram."""
    print(f"\n📦 Step 1: Initializing Reel Container...")
    print(f"   Video URL: {video_url}")
    print(f"   Caption:   {caption}")

    url = f"{BASE_API_URL}/{INSTAGRAM_USER_ID}/media"
    payload = {
        "media_type": "REELS",
        "video_url": video_url,
        "caption": caption,
        "share_to_feed": "true",
        "access_token": INSTAGRAM_ACCESS_TOKEN,
    }

    resp = requests.post(url, data=payload, timeout=30)
    if resp.status_code != 200:
        raise RuntimeError(f"Failed to create Reel container ({resp.status_code}): {resp.text}")

    container_id = resp.json().get("id")
    if not container_id:
        raise RuntimeError(f"No container ID returned in response: {resp.text}")

    print(f"✅ Container created successfully! Container ID: {container_id}")
    return container_id


def poll_container_status(container_id: str, max_wait_seconds: int = 180) -> bool:
    """
    Poll the container status until Instagram finishes transcoding and processing the video.
    Status can be: IN_PROGRESS | FINISHED | ERROR | EXPIRED
    """
    print(f"\n⏳ Step 2: Polling container processing status (max {max_wait_seconds}s)...")
    poll_url = f"{BASE_API_URL}/{container_id}"
    params = {
        "fields": "status_code,status",
        "access_token": INSTAGRAM_ACCESS_TOKEN,
    }

    start_time = time.time()
    while True:
        elapsed = int(time.time() - start_time)
        if elapsed > max_wait_seconds:
            raise TimeoutError(f"Timed out after {max_wait_seconds}s waiting for video processing.")

        resp = requests.get(poll_url, params=params, timeout=15)
        if resp.status_code != 200:
            print(f"   ⚠️ Status check warning ({resp.status_code}): {resp.text}")
        else:
            data = resp.json()
            status_code = data.get("status_code", "IN_PROGRESS")
            print(f"   [{elapsed}s elapsed] Status: {status_code} ({data.get('status', '')})")

            if status_code == "FINISHED":
                print("✅ Instagram finished processing the video!")
                return True
            elif status_code == "ERROR":
                raise RuntimeError(f"Instagram video processing failed: {data.get('status', 'Unknown error')}")
            elif status_code == "EXPIRED":
                raise RuntimeError("Container expired before it could be published.")

        time.sleep(5)


def publish_container(container_id: str) -> str:
    """Publish the processed Reel container."""
    print(f"\n🚀 Step 3: Publishing Reel Container {container_id}...")
    url = f"{BASE_API_URL}/{INSTAGRAM_USER_ID}/media_publish"
    payload = {
        "creation_id": container_id,
        "access_token": INSTAGRAM_ACCESS_TOKEN,
    }

    resp = requests.post(url, data=payload, timeout=30)
    if resp.status_code != 200:
        raise RuntimeError(f"Failed to publish Reel ({resp.status_code}): {resp.text}")

    media_id = resp.json().get("id")
    print(f"✅ Reel Published successfully! Media ID: {media_id}")
    return media_id


def get_reel_permalink(media_id: str) -> str:
    """Retrieve published Reel permalink."""
    print(f"\n🔗 Step 4: Fetching Reel permalink...")
    url = f"{BASE_API_URL}/{media_id}"
    params = {
        "fields": "permalink,id",
        "access_token": INSTAGRAM_ACCESS_TOKEN,
    }
    resp = requests.get(url, params=params, timeout=15)
    permalink = None
    if resp.status_code == 200:
        permalink = resp.json().get("permalink")

    result_url = permalink or f"https://www.instagram.com/reel/{media_id}"
    print(f"🎉 Live Reel URL: {result_url}")
    return result_url


def main():
    print("=" * 60)
    print("  ClipForge Studio — Instagram Reel Publisher Test")
    print("=" * 60)

    # 1. Verify credentials
    if not check_account_details():
        sys.exit(1)

    # 2. Determine video URL
    # Can be passed as command line argument: python test_post_reel.py <VIDEO_URL>
    if len(sys.argv) > 1:
        video_url = sys.argv[1]
    else:
        # Default candidate from local clip
        from urllib.parse import quote
        safe_clip_path = quote(DEFAULT_LOCAL_CLIP)
        video_url = f"{PUBLIC_BASE_URL}/media/clips/{safe_clip_path}"

    print(f"\nTarget Video URL: {video_url}")

    if "localhost" in video_url or "127.0.0.1" in video_url:
        print("\n⚠️ WARNING: Instagram cannot download videos from 'localhost' or '127.0.0.1'.")
        print("To test with your local clip, either:")
        print("  1. Start a free ngrok tunnel: `ngrok http 8000`")
        print("     and set PUBLIC_BASE_URL=https://<your-subdomain>.ngrok-free.app in .env")
        print("  2. Run this script passing any public HTTPS video URL:")
        print("     python test_post_reel.py https://example.com/sample_video.mp4\n")

        cont = input("Do you want to continue anyway? (y/n): ").strip().lower()
        if cont != "y":
            print("Aborted.")
            sys.exit(0)

    caption = "First clip posted with ClipForge Studio! 🎬🔥 #clipforge #reels #viral"

    try:
        # 1. Create container
        container_id = create_reel_container(video_url=video_url, caption=caption)

        # 2. Poll until processed
        poll_container_status(container_id=container_id)

        # 3. Publish container
        media_id = publish_container(container_id=container_id)

        # 4. Get permalink
        permalink = get_reel_permalink(media_id=media_id)

        print("\n" + "=" * 60)
        print("✨ ALL STEPS COMPLETED SUCCESSFULLY!")
        print(f"👉 Watch your Reel at: {permalink}")
        print("=" * 60)

    except Exception as e:
        print(f"\n❌ Error during publishing: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
