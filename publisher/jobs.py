"""
publisher/jobs.py — Background multi-account publisher orchestrator and live status tracker.
"""

import os
import uuid
import datetime
import threading
from pathlib import Path
from typing import Optional
from urllib.parse import quote
from dotenv import load_dotenv

from storage import find_account
from publisher.models import PublishRequest, BatchPublishRequest, TargetStatus
from publisher.youtube_publisher import upload_to_youtube
from publisher.instagram_publisher import publish_to_instagram_reel
from publisher.history import record_publish_job

_publish_jobs: dict[str, dict] = {}
_batch_publish_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


def resolve_clip_file(clip_path_str: str) -> Path:
    """Find the clip file on disk given a relative or absolute path, or filename."""
    import urllib.parse
    unquoted = urllib.parse.unquote(clip_path_str)
    
    path = Path(unquoted)
    if path.is_file():
        return path.resolve()

    raw_path = Path(clip_path_str)
    if raw_path.is_file():
        return raw_path.resolve()

    # Try relative to project root
    project_root = Path(__file__).resolve().parent.parent
    for candidate in [project_root / unquoted, project_root / clip_path_str]:
        if candidate.is_file():
            return candidate.resolve()

    # Try searching within data/clips
    clips_dir = project_root / "data" / "clips"
    if clips_dir.exists():
        for p in clips_dir.rglob("*"):
            if p.is_file() and (p.name == path.name or p.name == raw_path.name):
                return p.resolve()

    # Try searching anywhere in data/
    data_dir = project_root / "data"
    if data_dir.exists():
        for p in data_dir.rglob("*"):
            if p.is_file() and (p.name == path.name or p.name == raw_path.name):
                return p.resolve()

    raise FileNotFoundError(f"Clip file could not be found: '{clip_path_str}'")


def _run_publish_job(job_id: str, request: PublishRequest, clip_file: Path) -> None:
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

    with _jobs_lock:
        job = _publish_jobs.get(job_id)
        if not job:
            return

    load_dotenv(override=True)
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
            def ig_progress(pct: int, msg: str = ""):
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

            # Try direct resumable binary upload first (no public URL required)
            ig_token = account.get("access_token")
            ig_uid = account.get("channel_id")
            published = False

            if ig_token and ig_uid:
                try:
                    import asyncio
                    from services.instagram_publisher import publish_instagram_reel as publish_ig_direct
                    ig_progress(20, "Uploading binary bytes to Meta...")
                    res = asyncio.run(
                        publish_ig_direct(
                            video_path=clip_file,
                            caption=caption,
                            share_to_feed=share_feed,
                            ig_user_id=ig_uid,
                            page_access_token=ig_token,
                        )
                    )
                    if res.status.value == "published":
                        with _jobs_lock:
                            job["targets"][i]["status"] = "success"
                            job["targets"][i]["progress"] = 100
                            job["targets"][i]["url"] = f"https://www.instagram.com/reel/{res.media_id}/" if res.media_id else "https://www.instagram.com"
                            job["targets"][i]["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                        published = True
                    else:
                        raise Exception(res.error_message or "Instagram direct upload failed")
                except Exception as direct_err:
                    err_msg = str(direct_err)
                    print(f"[Instagram Publisher] Direct binary upload error: {err_msg}")
                    if "localhost" in public_base or "127.0.0.1" in public_base:
                        with _jobs_lock:
                            job["targets"][i]["status"] = "failed"
                            job["targets"][i]["progress"] = 0
                            job["targets"][i]["error"] = err_msg
                            job["targets"][i]["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                        published = True

            if not published:
                # Formulate public URL fallback
                rel_clip_name = clip_file.name
                video_public_url = f"{public_base}/media/clips/{quote(rel_clip_name)}"

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

        elif platform == "facebook":
            def fb_progress(pct: int):
                with _jobs_lock:
                    job["targets"][i]["progress"] = pct

            fb_cfg = target.facebook_config
            video_title = (
                (fb_cfg.title if fb_cfg and fb_cfg.title else None)
                or request.title
                or clip_file.stem
            )
            caption = (
                (fb_cfg.description if fb_cfg and fb_cfg.description else None)
                or request.caption
                or request.title
                or clip_file.stem
            )
            as_reel = fb_cfg.as_reel if fb_cfg is not None else True

            page_id = account.get("channel_id")
            token = account.get("access_token")

            try:
                import asyncio
                from services.facebook_publisher import publish_facebook_reel, publish_facebook_video

                fb_progress(20)
                if as_reel:
                    res = asyncio.run(
                        publish_facebook_reel(
                            video_path=clip_file,
                            caption=caption,
                            title=video_title,
                            page_id=page_id,
                            page_access_token=token,
                        )
                    )
                else:
                    res = asyncio.run(
                        publish_facebook_video(
                            video_path=clip_file,
                            title=video_title,
                            description=caption,
                            page_id=page_id,
                            page_access_token=token,
                        )
                    )

                if res.status.value == "published":
                    with _jobs_lock:
                        job["targets"][i]["status"] = "success"
                        job["targets"][i]["progress"] = 100
                        vid = res.media_id
                        permalink = res.details.get("permalink_url") if res.details else None
                        if permalink:
                            fb_url = f"https://www.facebook.com{permalink}" if permalink.startswith("/") else permalink
                        elif as_reel:
                            fb_url = f"https://www.facebook.com/reel/{vid}/" if vid else f"https://www.facebook.com/{page_id}"
                        else:
                            fb_url = f"https://www.facebook.com/watch/?v={vid}" if vid else f"https://www.facebook.com/{page_id}"
                        job["targets"][i]["url"] = fb_url
                        job["targets"][i]["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                else:
                    raise Exception(res.error_message or "Facebook publish failed")
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


def _run_batch_publish_job(batch_id: str, request: BatchPublishRequest) -> None:
    load_dotenv(override=True)
    public_base = os.getenv("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")
    with _jobs_lock:
        batch = _batch_publish_jobs.get(batch_id)
        if not batch:
            return

    for clip_idx, clip_path_str in enumerate(request.clip_paths):
        try:
            clip_file = resolve_clip_file(clip_path_str)
        except Exception as exc:
            with _jobs_lock:
                for target_status in batch["clips"][clip_idx]["targets"]:
                    target_status["status"] = "failed"
                    target_status["error"] = f"Clip file not found: {exc}"
            continue

        clip_title_prefix = request.title_prefix or clip_file.stem
        # Format title cleanly
        if len(request.clip_paths) > 1 and "{part}" not in clip_title_prefix and not clip_title_prefix.lower().endswith(f"part {clip_idx+1}"):
            clip_title = f"{clip_title_prefix} - Part {clip_idx + 1}"
        else:
            clip_title = clip_title_prefix.replace("{part}", str(clip_idx + 1))

        clip_caption = (request.caption or clip_title).replace("{part}", str(clip_idx + 1))

        # Upload for each selected target
        for target_idx, target in enumerate(request.targets):
            account = find_account(target.account_id)
            if not account:
                with _jobs_lock:
                    batch["clips"][clip_idx]["targets"][target_idx]["status"] = "failed"
                    batch["clips"][clip_idx]["targets"][target_idx]["error"] = "Account not found in storage"
                continue

            with _jobs_lock:
                batch["clips"][clip_idx]["targets"][target_idx]["status"] = "uploading"
                batch["clips"][clip_idx]["targets"][target_idx]["progress"] = 5

            platform = target.platform.lower()
            if platform == "youtube":
                def yt_progress(pct: int):
                    with _jobs_lock:
                        batch["clips"][clip_idx]["targets"][target_idx]["progress"] = pct

                try:
                    res = upload_to_youtube(
                        account=account,
                        video_path=clip_file,
                        title=clip_title,
                        description=clip_caption,
                        tags=["ClipForge", "Shorts"],
                        privacy_status=request.privacy or "public",
                        progress_callback=yt_progress,
                    )
                    with _jobs_lock:
                        batch["clips"][clip_idx]["targets"][target_idx]["status"] = "success"
                        batch["clips"][clip_idx]["targets"][target_idx]["progress"] = 100
                        batch["clips"][clip_idx]["targets"][target_idx]["url"] = res.get("shorts_url") or res.get("url")
                        batch["clips"][clip_idx]["targets"][target_idx]["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                except Exception as exc:
                    with _jobs_lock:
                        batch["clips"][clip_idx]["targets"][target_idx]["status"] = "failed"
                        batch["clips"][clip_idx]["targets"][target_idx]["progress"] = 0
                        batch["clips"][clip_idx]["targets"][target_idx]["error"] = str(exc)
                        batch["clips"][clip_idx]["targets"][target_idx]["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()

            elif platform == "instagram":
                def ig_progress(pct: int, msg: str = ""):
                    with _jobs_lock:
                        batch["clips"][clip_idx]["targets"][target_idx]["progress"] = pct

                ig_token = account.get("access_token")
                ig_uid = account.get("channel_id")
                batch_published = False

                if ig_token and ig_uid:
                    try:
                        import asyncio
                        from services.instagram_publisher import publish_instagram_reel as publish_ig_direct
                        ig_progress(25)
                        res = asyncio.run(
                            publish_ig_direct(
                                video_path=clip_file,
                                caption=clip_caption,
                                share_to_feed=True,
                                ig_user_id=ig_uid,
                                page_access_token=ig_token,
                            )
                        )
                        if res.status.value == "published":
                            with _jobs_lock:
                                batch["clips"][clip_idx]["targets"][target_idx]["status"] = "success"
                                batch["clips"][clip_idx]["targets"][target_idx]["progress"] = 100
                                batch["clips"][clip_idx]["targets"][target_idx]["url"] = f"https://www.instagram.com/reel/{res.media_id}/" if res.media_id else "https://www.instagram.com"
                                batch["clips"][clip_idx]["targets"][target_idx]["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                            batch_published = True
                        else:
                            raise Exception(res.error_message or "Instagram direct upload failed")
                    except Exception as direct_err:
                        err_msg = str(direct_err)
                        print(f"[Batch Instagram] Direct binary upload error: {err_msg}")
                        if "localhost" in public_base or "127.0.0.1" in public_base:
                            with _jobs_lock:
                                batch["clips"][clip_idx]["targets"][target_idx]["status"] = "failed"
                                batch["clips"][clip_idx]["targets"][target_idx]["progress"] = 0
                                batch["clips"][clip_idx]["targets"][target_idx]["error"] = err_msg
                                batch["clips"][clip_idx]["targets"][target_idx]["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                            batch_published = True

                if not batch_published:
                    video_public_url = f"{public_base}/media/clips/{quote(clip_file.name)}"
                    try:
                        res = publish_to_instagram_reel(
                            account=account,
                            video_public_url=video_public_url,
                            caption=clip_caption,
                            share_to_feed=True,
                            progress_callback=ig_progress,
                        )
                        with _jobs_lock:
                            batch["clips"][clip_idx]["targets"][target_idx]["status"] = "success"
                            batch["clips"][clip_idx]["targets"][target_idx]["progress"] = 100
                            batch["clips"][clip_idx]["targets"][target_idx]["url"] = res.get("permalink") or res.get("url")
                            batch["clips"][clip_idx]["targets"][target_idx]["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                    except Exception as exc:
                        with _jobs_lock:
                            batch["clips"][clip_idx]["targets"][target_idx]["status"] = "failed"
                            batch["clips"][clip_idx]["targets"][target_idx]["progress"] = 0
                            batch["clips"][clip_idx]["targets"][target_idx]["error"] = str(exc)
                            batch["clips"][clip_idx]["targets"][target_idx]["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()

            elif platform == "facebook":
                def fb_batch_progress(pct: int):
                    with _jobs_lock:
                        batch["clips"][clip_idx]["targets"][target_idx]["progress"] = pct

                fb_cfg = target.facebook_config
                as_reel = fb_cfg.as_reel if fb_cfg is not None else True
                page_id = account.get("channel_id")
                token = account.get("access_token")

                try:
                    import asyncio
                    from services.facebook_publisher import publish_facebook_reel, publish_facebook_video

                    fb_batch_progress(20)
                    if as_reel:
                        res = asyncio.run(
                            publish_facebook_reel(
                                video_path=clip_file,
                                caption=clip_caption,
                                title=clip_title,
                                page_id=page_id,
                                page_access_token=token,
                            )
                        )
                    else:
                        res = asyncio.run(
                            publish_facebook_video(
                                video_path=clip_file,
                                title=clip_title,
                                description=clip_caption,
                                page_id=page_id,
                                page_access_token=token,
                            )
                        )

                    if res.status.value == "published":
                        with _jobs_lock:
                            batch["clips"][clip_idx]["targets"][target_idx]["status"] = "success"
                            batch["clips"][clip_idx]["targets"][target_idx]["progress"] = 100
                            vid = res.media_id
                            batch["clips"][clip_idx]["targets"][target_idx]["url"] = f"https://www.facebook.com/{vid}" if vid else f"https://www.facebook.com/{page_id}"
                            batch["clips"][clip_idx]["targets"][target_idx]["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                    else:
                        raise Exception(res.error_message or "Facebook publish failed")
                except Exception as exc:
                    with _jobs_lock:
                        batch["clips"][clip_idx]["targets"][target_idx]["status"] = "failed"
                        batch["clips"][clip_idx]["targets"][target_idx]["progress"] = 0
                        batch["clips"][clip_idx]["targets"][target_idx]["error"] = str(exc)
                        batch["clips"][clip_idx]["targets"][target_idx]["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()

        # Save completed clip record to history
        with _jobs_lock:
            clip_record = {
                "job_id": batch["clips"][clip_idx]["job_id"],
                "clip_path": str(clip_file),
                "clip_name": clip_file.name,
                "started_at": batch["started_at"],
                "targets": [dict(t) for t in batch["clips"][clip_idx]["targets"]],
                "all_done": True,
            }
        try:
            record_publish_job(clip_record)
        except Exception:
            pass

    with _jobs_lock:
        batch["all_done"] = True


def start_batch_publish_job(request: BatchPublishRequest) -> dict:
    batch_id = uuid.uuid4().hex
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()

    clips_list = []
    for clip_path in request.clip_paths:
        job_id = uuid.uuid4().hex
        try:
            resolved = resolve_clip_file(clip_path)
            c_name = resolved.name
        except Exception:
            c_name = Path(clip_path).name

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

        clips_list.append({
            "job_id": job_id,
            "clip_path": clip_path,
            "clip_name": c_name,
            "targets": targets_status,
        })

    batch_entry = {
        "batch_id": batch_id,
        "started_at": now,
        "total_clips": len(request.clip_paths),
        "clips": clips_list,
        "all_done": False,
    }

    with _jobs_lock:
        _batch_publish_jobs[batch_id] = batch_entry

    thread = threading.Thread(
        target=_run_batch_publish_job,
        args=(batch_id, request),
        daemon=True,
    )
    thread.start()

    return batch_entry


def get_batch_publish_job_status(batch_id: str) -> dict | None:
    with _jobs_lock:
        job = _batch_publish_jobs.get(batch_id)
        if job:
            return dict(job)
    return None
