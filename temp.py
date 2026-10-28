import os
import sys
import time
import requests

# Fix Windows terminal encoding for print statements
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# ------------------------------------------------------------------------------
# 1. CREDENTIALS & ENDPOINT
# ------------------------------------------------------------------------------
INSTAGRAM_USER_ID = "17841461512030909"
INSTAGRAM_ACCESS_TOKEN = "IGAAPR8q5u1O1BZAGFtYVRjUHc3dGp5Wk8zSGQ4MVNFNGJvUENERXQ0VDZAvQUhtZAkVDUGo0ZADRjXzBvYUJuMU9hOGY5ME5KZAkNNSUJNaUQ0QmNDVExtTTYtWXZAjcmxwMmdKTTg0NEtNYmRWLUJCMGROc1NmdVlRRUZAtd1dMRks2OAZDZD"
BASE_URL = "https://graph.instagram.com/v26.0"

# ------------------------------------------------------------------------------
# 2. CLIP / REEL SETTINGS
# ------------------------------------------------------------------------------
# NOTE: Instagram's servers require a publicly reachable HTTPS video URL.
# - If testing immediately: You can use a public sample MP4.
# - If using your local clip from ClipForge: Start a tunnel (e.g. `ngrok http 8000`)
#   and use: "https://<your-subdomain>.ngrok-free.app/media/clips/Phulera%20Ka%20Asli%20Mard_part_1.mp4"
VIDEO_URL = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"
CAPTION = "Testing Reel publishing from ClipForge Studio! 🚀🎬 #reels #automation"

print("=" * 60)
print("  Instagram Reel Publishing Test")
print("=" * 60)

# ------------------------------------------------------------------------------
# STEP 1: CREATE REEL CONTAINER
# ------------------------------------------------------------------------------
print("\n[Step 1] Creating Reel Container...")
create_url = f"{BASE_URL}/{INSTAGRAM_USER_ID}/media"
create_params = {
    "media_type": "REELS",
    "video_url": VIDEO_URL,
    "caption": CAPTION,
    "share_to_feed": "true",
    "access_token": INSTAGRAM_ACCESS_TOKEN,
}

create_resp = requests.post(create_url, data=create_params, timeout=30)
print(f"Status Code: {create_resp.status_code}")
create_data = create_resp.json()
print("Response:", create_data)

if create_resp.status_code != 200 or "id" not in create_data:
    print("❌ Failed to create Reel container.")
    sys.exit(1)

container_id = create_data["id"]
print(f"✅ Container ID created: {container_id}")

# ------------------------------------------------------------------------------
# STEP 2: WAIT FOR INSTAGRAM TO PROCESS / TRANSCODE THE VIDEO
# ------------------------------------------------------------------------------
print("\n[Step 2] Waiting for Instagram to process the video...")
status_url = f"{BASE_URL}/{container_id}"
status_params = {
    "fields": "status_code,status",
    "access_token": INSTAGRAM_ACCESS_TOKEN,
}

max_wait = 180  # seconds
start_time = time.time()
status_code = "IN_PROGRESS"

while status_code != "FINISHED":
    elapsed = int(time.time() - start_time)
    if elapsed > max_wait:
        print(f"❌ Timed out after {max_wait}s waiting for video processing.")
        sys.exit(1)

    time.sleep(5)
    chk_resp = requests.get(status_url, params=status_params, timeout=15)
    if chk_resp.status_code != 200:
        print(f"   [{elapsed}s] Check warning: {chk_resp.text}")
        continue

    chk_data = chk_resp.json()
    status_code = chk_data.get("status_code", "IN_PROGRESS")
    print(f"   [{elapsed}s elapsed] Status: {status_code}")

    if status_code == "ERROR":
        print(f"❌ Processing error: {chk_data.get('status')}")
        sys.exit(1)
    elif status_code == "EXPIRED":
        print("❌ Container expired.")
        sys.exit(1)

print("✅ Video is ready to publish!")

# ------------------------------------------------------------------------------
# STEP 3: PUBLISH THE CONTAINER
# ------------------------------------------------------------------------------
print("\n[Step 3] Publishing Reel to Instagram...")
pub_url = f"{BASE_URL}/{INSTAGRAM_USER_ID}/media_publish"
pub_params = {
    "creation_id": container_id,
    "access_token": INSTAGRAM_ACCESS_TOKEN,
}

pub_resp = requests.post(pub_url, data=pub_params, timeout=30)
print(f"Status Code: {pub_resp.status_code}")
pub_data = pub_resp.json()
print("Response:", pub_data)

if pub_resp.status_code != 200 or "id" not in pub_data:
    print("❌ Failed to publish Reel.")
    sys.exit(1)

media_id = pub_data["id"]
print(f"✅ Reel Published successfully! Media ID: {media_id}")

# ------------------------------------------------------------------------------
# STEP 4: FETCH PERMALINK
# ------------------------------------------------------------------------------
print("\n[Step 4] Fetching Reel link...")
info_url = f"{BASE_URL}/{media_id}"
info_resp = requests.get(
    info_url,
    params={"fields": "permalink,id", "access_token": INSTAGRAM_ACCESS_TOKEN},
    timeout=15,
)
permalink = info_resp.json().get("permalink", f"https://www.instagram.com/reel/{media_id}")

print("\n" + "=" * 60)
print(f"🎉 Live Reel URL: {permalink}")
print("=" * 60)