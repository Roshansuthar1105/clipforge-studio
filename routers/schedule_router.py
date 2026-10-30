"""
routers/schedule_router.py — FastAPI endpoints for scheduled social media publishing.
Allows scheduling Reels & Shorts, editing schedules, canceling, and immediate dispatch.
"""

from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from publisher.schedule_models import CreateScheduleRequest, UpdateScheduleRequest
from publisher.scheduler import (
    create_scheduled_post,
    get_scheduled_posts,
    get_scheduled_post,
    update_scheduled_post,
    delete_scheduled_post,
    publish_scheduled_post_now,
)

router = APIRouter(prefix="/api/schedule", tags=["Scheduling"])


@router.post("")
def schedule_post(req: CreateScheduleRequest):
    """
    Schedule a clip to be published automatically at a future date and time.
    """
    if not req.targets:
        raise HTTPException(status_code=400, detail="At least one target channel must be selected")
    if not req.scheduled_time:
        raise HTTPException(status_code=400, detail="A valid scheduled_time is required")

    try:
        post = create_scheduled_post(req)
        return post
    except FileNotFoundError as fnf:
        raise HTTPException(status_code=404, detail=str(fnf))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("")
def list_scheduled_posts(status: Optional[str] = "all"):
    """
    List all scheduled posts with optional status filtering ('all', 'scheduled', 'completed', 'failed', 'cancelled').
    """
    try:
        posts = get_scheduled_posts(status=status)
        return {"posts": posts}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{schedule_id}")
def get_single_scheduled_post(schedule_id: str):
    """Retrieve details for a specific scheduled post."""
    post = get_scheduled_post(schedule_id)
    if not post:
        raise HTTPException(status_code=404, detail="Scheduled post not found")
    return post


@router.put("/{schedule_id}")
def edit_scheduled_post(schedule_id: str, updates: UpdateScheduleRequest):
    """
    Edit an existing scheduled post: update scheduled time, title, caption, targets, or privacy.
    """
    try:
        updated = update_scheduled_post(schedule_id, updates)
        if not updated:
            raise HTTPException(status_code=404, detail="Scheduled post not found")
        return updated
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/{schedule_id}")
def cancel_scheduled_post(schedule_id: str):
    """
    Cancel and remove a scheduled post.
    """
    deleted = delete_scheduled_post(schedule_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Scheduled post not found")
    return {"success": True, "message": "Scheduled post cancelled successfully"}


@router.post("/{schedule_id}/publish-now")
def trigger_publish_now(schedule_id: str):
    """
    Bypass scheduled wait time and publish the post immediately.
    """
    try:
        res = publish_scheduled_post_now(schedule_id)
        return res
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

