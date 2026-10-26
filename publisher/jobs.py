"""
publisher/jobs.py — Background multi-account publisher orchestrator and live status tracker.
"""

import os
import uuid
import datetime
import threading
from pathlib import Path
from typing import Optional

from storage import find_account
from publisher.models import PublishRequest, TargetStatus
from publisher.youtube_publisher import upload_to_youtube
from publisher.instagram_publisher import publish_to_instagram_reel
from publisher.history import record_publish_job

_publish_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


def resolve_clip_file(clip_path_str: str) -> Path:
    """Find the clip file on disk given a relative or absolute path, or filename."""
    path = Path(clip_path_str)
    if path.is_file():
        return path.resolve()

    # Try relative to project root
    project_root = Path(__file__).resolve().parent.parent
    candidate = project_root / clip_path_str
    if candidate.is_file():
        return candidate.resolve()

    # Try searching within data/clips
    clips_dir = project_root / "data" / "clips"
    if clips_dir.exists():
        # Match by name
        matches = list(clips_dir.glob(f"**/{path.name}"))
        if matches:
            return matches[0].resolve()

    # Try searching anywhere in data/
    data_dir = project_root / "data"
    if data_dir.exists():
        matches = list(data_dir.glob(f"**/{path.name}"))
        if matches:
            return matches[0].resolve()

    raise FileNotFoundError(f"Clip file could not be found: '{clip_path_str}'")


def _run_publish_job(job_id: str, request: PublishRequest, clip_file: Path) -> None:
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

    with _jobs_lock:
        job = _publish_jobs.get(job_id)
        if not job:
            return

    public_base = os.getenv("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")

    for i, target in enumerate(request.targets):
        account = find_account(target.account_id)
        if not account:
            with _jobs_lock:
                job["targets"][i]["status"] = "failed"
                job["targets"][i]["error"] = f"Account '{target.account_id}' not found in storage"
                job["targets"][i]["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            continue

        alias = account.get("alias", target.platform)
        with _jobs_lock:
            job["targets"][i]["account_alias"] = alias
            job["targets"][i]["status"] = "uploading"
            job["targets"][i]["progress"] = 5

        # Execute upload for this target
        platform = target.platform.lower()

        if platform == "youtube":
            def yt_progress(pct: int):
                with _jobs_lock:
                    job["targets"][i]["progress"] = pct

            yt_cfg = target.youtube_config
            video_title = (
                (yt_cfg.title if yt_cfg and yt_cfg.title else None)
                or request.title
                or clip_file.stem
            )
            video_desc = (yt_cfg.description if yt_cfg else "") or request.caption or ""
            video_tags = (yt_cfg.tags if yt_cfg else []) or ["ClipForge", "Shorts"]
            privacy = (yt_cfg.privacy if yt_cfg else None) or request.privacy or "public"
            kids = yt_cfg.made_for_kids if yt_cfg else False
            cat_id = yt_cfg.category_id if yt_cfg else "22"

            try:
                res = upload_to_youtube(
                    account=account,
                    video_path=clip_file,
                    title=video_title,
                    description=video_desc,
                    tags=video_tags,
                    category_id=cat_id,
                    privacy_status=privacy,
                    made_for_kids=kids,
                    progress_callback=yt_progress,
                )
                with _jobs_lock:
                    job["targets"][i]["status"] = "success"
                    job["targets"][i]["progress"] = 100
                    job["targets"][i]["url"] = res.get("shorts_url") or res.get("url")
                    job["targets"][i]["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            except Exception as exc:
                with _jobs_lock:
                    job["targets"][i]["status"] = "failed"
                    job["targets"][i]["progress"] = 0
                    job["targets"][i]["error"] = str(exc)
                    job["targets"][i]["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()

        elif platform == "instagram":
            def ig_progress(pct: int, msg: str):
                with _jobs_lock:
                    job["targets"][i]["progress"] = pct

            ig_cfg = target.instagram_config
            caption = (
                (ig_cfg.caption if ig_cfg and ig_cfg.caption else None)
                or request.caption
                or request.title
                or clip_file.stem
            )
            share_feed = ig_cfg.share_to_feed if ig_cfg else True

            # Formulate public URL to reach this clip via the /media/ endpoint or server
            rel_clip_name = clip_file.name
            video_public_url = f"{public_base}/media/clips/{rel_clip_name}"

            try:
                res = publish_to_instagram_reel(
                    account=account,
                    video_public_url=video_public_url,
                    caption=caption,
                    share_to_feed=share_feed,
                    progress_callback=ig_progress,
                )
                with _jobs_lock:
                    job["targets"][i]["status"] = "success"
                    job["targets"][i]["progress"] = 100
                    job["targets"][i]["url"] = res.get("permalink") or res.get("url")
                    job["targets"][i]["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            except Exception as exc:
                with _jobs_lock:
                    job["targets"][i]["status"] = "failed"
                    job["targets"][i]["progress"] = 0
                    job["targets"][i]["error"] = str(exc)
                    job["targets"][i]["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()

        else:
            with _jobs_lock:
                job["targets"][i]["status"] = "failed"
                job["targets"][i]["error"] = f"Unsupported platform: {platform}"
                job["targets"][i]["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()

    with _jobs_lock:
        job["all_done"] = True
        job_copy = dict(job)

    # Persist the finished run to data/publish_history.json
    try:
        record_publish_job(job_copy)
    except Exception as exc:
        print(f"[Warning] Failed to write publish history: {exc}")


def start_publish_job(request: PublishRequest) -> dict:
    """Validate clip file, create job record, and dispatch background thread."""
    clip_file = resolve_clip_file(request.clip_path)

    job_id = uuid.uuid4().hex
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()

    targets_status = []
    for t in request.targets:
        acc = find_account(t.account_id)
        alias = acc.get("alias", t.platform) if acc else t.account_id
        targets_status.append({
            "account_id": t.account_id,
            "account_alias": alias,
            "platform": t.platform,
            "status": "queued",
            "progress": 0,
            "url": None,
            "error": None,
            "finished_at": None,
        })

    job_entry = {
        "job_id": job_id,
        "clip_path": str(clip_file),
        "clip_name": clip_file.name,
        "started_at": now,
        "targets": targets_status,
        "all_done": False,
    }

    with _jobs_lock:
        _publish_jobs[job_id] = job_entry

    thread = threading.Thread(
        target=_run_publish_job,
        args=(job_id, request, clip_file),
        daemon=True,
    )
    thread.start()

    return dict(job_entry)


def get_publish_job_status(job_id: str) -> dict | None:
    with _jobs_lock:
        job = _publish_jobs.get(job_id)
        if job:
            return dict(job)

    # If not in active memory, check history file
    from publisher.history import get_publish_history
    history = get_publish_history()
    for rec in history:
        if rec.get("job_id") == job_id:
            return rec

    return None
