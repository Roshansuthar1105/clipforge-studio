"""
publisher/scheduler.py — Automated Background Scheduler for Social Media Reels & Shorts.
Provides persistent scheduling, scheduled time editing, background polling, and automatic dispatch.
"""

from __future__ import annotations

import os
import json
import uuid
import time
import logging
import threading
import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any

from publisher.models import PublishRequest, PublishTarget
from publisher.schedule_models import CreateScheduleRequest, UpdateScheduleRequest
from publisher.jobs import start_publish_job, get_publish_job_status, resolve_clip_file
import db

logger = logging.getLogger("clipforge.scheduler")

DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).resolve().parent.parent / "data")).resolve()
SCHEDULED_POSTS_FILE = DATA_DIR / "scheduled_posts.json"
_schedule_lock = threading.Lock()

_scheduler_thread: Optional[threading.Thread] = None
_scheduler_running = False


# ──────────────────────────────────────────────────────────────────────────────
# Storage Layer (MongoDB with JSON Flat-File Fallback)
# ──────────────────────────────────────────────────────────────────────────────

def _load_json_scheduled_posts() -> List[Dict[str, Any]]:
    if not SCHEDULED_POSTS_FILE.exists():
        return []
    try:
        with open(SCHEDULED_POSTS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error("Failed to load scheduled_posts.json: %s", e)
        return []


def _save_json_scheduled_posts(posts: List[Dict[str, Any]]) -> None:
    try:
        SCHEDULED_POSTS_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = SCHEDULED_POSTS_FILE.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(posts, f, indent=2, default=str)
        tmp.replace(SCHEDULED_POSTS_FILE)
    except Exception as e:
        logger.error("Failed to save scheduled_posts.json: %s", e)


def create_scheduled_post(req: CreateScheduleRequest, user_id: Optional[str] = None) -> Dict[str, Any]:
    """Create a new scheduled post."""
    resolved = resolve_clip_file(req.clip_path)
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    post_id = uuid.uuid4().hex

    post_doc = {
        "id": post_id,
        "clip_path": str(resolved),
        "clip_name": resolved.name,
        "clip_url": f"/media/clips/{resolved.name}",
        "targets": [t.model_dump() for t in req.targets],
        "title": req.title or resolved.stem.replace("_", " "),
        "caption": req.caption or "",
        "privacy": req.privacy or "public",
        "scheduled_time": req.scheduled_time,
        "status": "scheduled",  # scheduled | publishing | completed | failed | cancelled
        "created_at": now,
        "updated_at": now,
        "published_at": None,
        "publish_job_id": None,
        "error_message": None,
        "user_id": user_id,
    }

    # 1. MongoDB
    database = db.get_db()
    if database is not None:
        try:
            doc_copy = dict(post_doc)
            database.scheduled_posts.insert_one(doc_copy)
            doc_copy.pop("_id", None)
            return doc_copy
        except Exception as e:
            logger.warning("MongoDB insert failed, falling back to JSON: %s", e)

    # 2. Local JSON Fallback
    with _schedule_lock:
        posts = _load_json_scheduled_posts()
        posts.append(post_doc)
        _save_json_scheduled_posts(posts)

    return post_doc


def get_scheduled_posts(status: Optional[str] = None, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Retrieve scheduled posts with optional status and user filters."""
    database = db.get_db()
    if database is not None:
        try:
            query: Dict[str, Any] = {}
            if status and status != "all":
                query["status"] = status
            if user_id:
                query["user_id"] = user_id

            cursor = database.scheduled_posts.find(query).sort("scheduled_time", 1)
            results = []
            for doc in cursor:
                doc.pop("_id", None)
                results.append(doc)
            return results
        except Exception as e:
            logger.warning("MongoDB query failed, falling back to JSON: %s", e)

    # JSON fallback
    with _schedule_lock:
        posts = _load_json_scheduled_posts()
        if status and status != "all":
            posts = [p for p in posts if p.get("status") == status]
        if user_id:
            posts = [p for p in posts if p.get("user_id") == user_id]
        posts.sort(key=lambda x: x.get("scheduled_time", ""))
        return posts


def get_scheduled_post(schedule_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve a single scheduled post by ID."""
    database = db.get_db()
    if database is not None:
        try:
            doc = database.scheduled_posts.find_one({"id": schedule_id})
            if doc:
                doc.pop("_id", None)
                return doc
        except Exception as e:
            logger.warning("MongoDB find failed: %s", e)

    with _schedule_lock:
        posts = _load_json_scheduled_posts()
        for p in posts:
            if p.get("id") == schedule_id:
                return p
    return None


def update_scheduled_post(schedule_id: str, updates: UpdateScheduleRequest) -> Optional[Dict[str, Any]]:
    """Edit an existing scheduled post (scheduled time, caption, title, targets, privacy)."""
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    fields_to_update: Dict[str, Any] = {"updated_at": now}

    if updates.scheduled_time is not None:
        fields_to_update["scheduled_time"] = updates.scheduled_time
    if updates.title is not None:
        fields_to_update["title"] = updates.title
    if updates.caption is not None:
        fields_to_update["caption"] = updates.caption
    if updates.privacy is not None:
        fields_to_update["privacy"] = updates.privacy
    if updates.targets is not None:
        fields_to_update["targets"] = [t.model_dump() for t in updates.targets]

    database = db.get_db()
    if database is not None:
        try:
            res = database.scheduled_posts.find_one_and_update(
                {"id": schedule_id},
                {"$set": fields_to_update},
                return_document=True,
            )
            if res:
                res.pop("_id", None)
                return res
        except Exception as e:
            logger.warning("MongoDB update failed: %s", e)

    with _schedule_lock:
        posts = _load_json_scheduled_posts()
        for p in posts:
            if p.get("id") == schedule_id:
                p.update(fields_to_update)
                _save_json_scheduled_posts(posts)
                return p
    return None


def delete_scheduled_post(schedule_id: str) -> bool:
    """Cancel and delete a scheduled post."""
    database = db.get_db()
    if database is not None:
        try:
            res = database.scheduled_posts.delete_one({"id": schedule_id})
            if res.deleted_count > 0:
                return True
        except Exception as e:
            logger.warning("MongoDB delete failed: %s", e)

    with _schedule_lock:
        posts = _load_json_scheduled_posts()
        orig_len = len(posts)
        posts = [p for p in posts if p.get("id") != schedule_id]
        if len(posts) < orig_len:
            _save_json_scheduled_posts(posts)
            return True
    return False


def _update_post_status(schedule_id: str, status: str, extra: Optional[Dict[str, Any]] = None) -> None:
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    update_dict: Dict[str, Any] = {"status": status, "updated_at": now}
    if extra:
        update_dict.update(extra)

    database = db.get_db()
    if database is not None:
        try:
            database.scheduled_posts.update_one({"id": schedule_id}, {"$set": update_dict})
            return
        except Exception:
            pass

    with _schedule_lock:
        posts = _load_json_scheduled_posts()
        for p in posts:
            if p.get("id") == schedule_id:
                p.update(update_dict)
                break
        _save_json_scheduled_posts(posts)


# ──────────────────────────────────────────────────────────────────────────────
# Publishing Execution Engine
# ──────────────────────────────────────────────────────────────────────────────

def publish_scheduled_post_now(schedule_id: str) -> Dict[str, Any]:
    """Manually or automatically trigger immediate publishing for a scheduled post."""
    post = get_scheduled_post(schedule_id)
    if not post:
        raise ValueError(f"Scheduled post '{schedule_id}' not found")

    if post.get("status") == "publishing":
        raise ValueError("Post is already actively publishing")

    # Build targets
    target_objs: List[PublishTarget] = []
    for t_data in post.get("targets", []):
        target_objs.append(PublishTarget(**t_data))

    req = PublishRequest(
        clip_path=post["clip_path"],
        targets=target_objs,
        title=post.get("title"),
        caption=post.get("caption"),
        privacy=post.get("privacy", "public"),
    )

    _update_post_status(schedule_id, "publishing")

    try:
        job = start_publish_job(req)
        job_id = job["job_id"]
        _update_post_status(schedule_id, "publishing", {"publish_job_id": job_id})

        # Launch watcher thread to update scheduled post once publish finishes
        threading.Thread(
            target=_watch_publish_job,
            args=(schedule_id, job_id),
            daemon=True,
            name=f"watch-publish-{schedule_id}"
        ).start()

        return {"success": True, "job_id": job_id, "schedule_id": schedule_id}
    except Exception as e:
        logger.error("Failed to trigger scheduled publish: %s", e)
        _update_post_status(schedule_id, "failed", {"error_message": str(e)})
        raise e


def _watch_publish_job(schedule_id: str, job_id: str) -> None:
    """Monitor background publish job and mark scheduled post completed or failed."""
    max_wait = 600  # 10 minutes max
    start_time = time.time()

    while time.time() - start_time < max_wait:
        time.sleep(3)
        job = get_publish_job_status(job_id)
        if not job:
            continue

        status = job.get("status")
        if status in ("success", "completed"):
            now = datetime.datetime.now(datetime.timezone.utc).isoformat()
            _update_post_status(schedule_id, "completed", {"published_at": now})
            logger.info("Scheduled post '%s' published successfully!", schedule_id)
            return
        elif status == "failed":
            error = job.get("error") or "Publishing failed for one or more targets"
            _update_post_status(schedule_id, "failed", {"error_message": error})
            logger.warning("Scheduled post '%s' failed: %s", schedule_id, error)
            return


# ──────────────────────────────────────────────────────────────────────────────
# Background Scheduler Polling Daemon
# ──────────────────────────────────────────────────────────────────────────────

def _parse_scheduled_datetime(dt_str: str) -> Optional[datetime.datetime]:
    """Parse various ISO format strings into a UTC aware datetime object."""
    if not dt_str:
        return None
    try:
        # Replace Z with UTC offset
        clean = dt_str.replace("Z", "+00:00")
        dt = datetime.datetime.fromisoformat(clean)
        if dt.tzinfo is None:
            # Assume UTC if naive
            dt = dt.replace(tzinfo=datetime.timezone.utc)
        return dt
    except Exception:
        return None


def _scheduler_loop() -> None:
    """Continuous background loop checking for due scheduled posts."""
    logger.info("Social media auto-publishing scheduler daemon started.")
    while _scheduler_running:
        try:
            now_utc = datetime.datetime.now(datetime.timezone.utc)
            pending_posts = get_scheduled_posts(status="scheduled")

            for post in pending_posts:
                sch_time_str = post.get("scheduled_time")
                if not sch_time_str:
                    continue

                scheduled_dt = _parse_scheduled_datetime(sch_time_str)
                if scheduled_dt and scheduled_dt <= now_utc:
                    post_id = post["id"]
                    logger.info("Scheduled time reached for post '%s' (due %s). Auto-dispatching...", post_id, sch_time_str)
                    try:
                        publish_scheduled_post_now(post_id)
                    except Exception as err:
                        logger.error("Auto-publishing error for schedule '%s': %s", post_id, err)

        except Exception as exc:
            logger.error("Error in scheduler loop: %s", exc)

        # Poll interval: check every 15 seconds
        time.sleep(15)


def start_scheduler_daemon() -> None:
    """Start the background scheduler daemon thread if not already running."""
    global _scheduler_thread, _scheduler_running
    if _scheduler_running and _scheduler_thread and _scheduler_thread.is_alive():
        return

    _scheduler_running = True
    _scheduler_thread = threading.Thread(target=_scheduler_loop, daemon=True, name="clipforge-auto-scheduler")
    _scheduler_thread.start()
    logger.info("Auto-scheduler daemon thread initialized.")

