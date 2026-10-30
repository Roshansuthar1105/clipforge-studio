import datetime
from fastapi.testclient import TestClient
import main

with TestClient(main.app) as client:
    from publisher.scheduler import _scheduler_thread, _scheduler_running

    print("=== 1. VERIFYING CORE SYSTEM & PRE-EXISTING ENDPOINTS ===")

    # Root & SPA
    r = client.get("/")
    assert r.status_code == 200 and "ClipForge Studio" in r.text
    print("[OK] GET / (React SPA served successfully)")

    # Health
    r = client.get("/health")
    assert r.status_code == 200 and r.json().get("status") == "ok"
    print("[OK] GET /health: 200 OK")

    # Jobs
    r = client.get("/api/jobs")
    assert r.status_code == 200
    jobs_count = len(r.json().get("jobs", []))
    print(f"[OK] GET /api/jobs: 200 OK ({jobs_count} jobs)")

    # Clips
    r = client.get("/api/clips")
    assert r.status_code == 200
    clips = r.json().get("clips", [])
    print(f"[OK] GET /api/clips: 200 OK ({len(clips)} clips found)")
    test_clip = clips[0]["name"] if clips else "test_clip.mp4"

    # Downloads
    r = client.get("/api/downloads")
    assert r.status_code == 200
    downloads_count = len(r.json().get("downloads", []))
    print(f"[OK] GET /api/downloads: 200 OK ({downloads_count} downloads)")

    # Accounts
    r = client.get("/accounts")
    assert r.status_code == 200
    accounts = r.json().get("accounts", [])
    print(f"[OK] GET /accounts: 200 OK ({len(accounts)} accounts connected)")
    test_acc_id = accounts[0]["id"] if accounts else "acc_test_123"
    test_platform = accounts[0]["platform"] if accounts else "youtube"

    # Storage
    r = client.get("/api/media/storage")
    assert r.status_code == 200
    print("[OK] GET /api/media/storage: 200 OK")

    # Auth status
    r = client.get("/api/auth/status")
    assert r.status_code == 200
    print("[OK] GET /api/auth/status: 200 OK")

    print("\n=== 2. VERIFYING AUTO-PUBLISHING SCHEDULER SYSTEM ===")

    # Verify Scheduler daemon is running
    assert _scheduler_running is True and _scheduler_thread is not None
    print(f"[OK] Auto-scheduler daemon is ACTIVE (Thread: {_scheduler_thread.name}, Alive: {_scheduler_thread.is_alive()})")

    # Create a scheduled post
    future_time = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=2)).isoformat()
    schedule_payload = {
        "clip_path": test_clip,
        "targets": [{"account_id": test_acc_id, "platform": test_platform}],
        "title": "Automated Scheduled Reel Test",
        "caption": "Check out this automated reel! #shorts #viral",
        "privacy": "public",
        "scheduled_time": future_time
    }

    r = client.post("/api/schedule", json=schedule_payload)
    print(f"Create Schedule status: {r.status_code}")
    assert r.status_code == 200
    created_post = r.json()
    schedule_id = created_post["id"]
    assert created_post["title"] == "Automated Scheduled Reel Test"
    assert created_post["status"] == "scheduled"
    print(f"[OK] POST /api/schedule: Created scheduled post #{schedule_id[:8]} for {future_time}")

    # List scheduled posts
    r = client.get("/api/schedule")
    assert r.status_code == 200
    posts = r.json().get("posts", [])
    assert any(p["id"] == schedule_id for p in posts)
    print(f"[OK] GET /api/schedule: Verified post in list ({len(posts)} total scheduled)")

    # Get single scheduled post
    r = client.get(f"/api/schedule/{schedule_id}")
    assert r.status_code == 200
    assert r.json()["id"] == schedule_id
    print(f"[OK] GET /api/schedule/{schedule_id[:8]}: Details matched")

    # EDIT SCHEDULE OPTION
    new_future_time = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=5)).isoformat()
    edit_payload = {
        "scheduled_time": new_future_time,
        "title": "Updated Title for Scheduled Reel",
        "caption": "Updated caption text with #trending #reels"
    }
    r = client.put(f"/api/schedule/{schedule_id}", json=edit_payload)
    assert r.status_code == 200
    updated_post = r.json()
    assert updated_post["title"] == "Updated Title for Scheduled Reel"
    assert updated_post["caption"] == "Updated caption text with #trending #reels"
    assert updated_post["scheduled_time"] == new_future_time
    print(f"[OK] PUT /api/schedule/{schedule_id[:8]}: Edit schedule verified successfully! (New time: {new_future_time})")

    # Cancel / Delete scheduled post
    r = client.delete(f"/api/schedule/{schedule_id}")
    assert r.status_code == 200
    print(f"[OK] DELETE /api/schedule/{schedule_id[:8]}: Cancelled successfully")

    # Verify cancellation
    r = client.get(f"/api/schedule/{schedule_id}")
    assert r.status_code == 404
    print("[OK] Verified scheduled post removed from active queue")

    print("\n=== ALL COMPONENTS, APIS, AND SCHEDULER TESTS COMPLETED WITH 100% SUCCESS! ===")
