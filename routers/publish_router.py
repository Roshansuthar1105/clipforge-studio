"""
routers/publish_router.py — FastAPI endpoints for publishing clips and retrieving publish history.
"""

from fastapi import APIRouter, HTTPException
from publisher.models import PublishRequest, BatchPublishRequest
from publisher.jobs import (
    start_publish_job,
    get_publish_job_status,
    start_batch_publish_job,
    get_batch_publish_job_status,
    retry_batch_publish_job,
)
from publisher.history import get_publish_history, delete_publish_record

router = APIRouter(prefix="/publish", tags=["Publishing"])


@router.post("")
def publish_clip(request: PublishRequest):
    """
    Start an asynchronous multi-target publishing job for a single clip.
    """
    if not request.targets:
        raise HTTPException(status_code=400, detail="At least one target account must be selected")

    try:
        job = start_publish_job(request)
        return job
    except FileNotFoundError as fnf:
        raise HTTPException(status_code=404, detail=str(fnf))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/batch")
def publish_batch_clips(request: BatchPublishRequest):
    """
    Start an asynchronous batch publishing job to publish multiple clips across selected targets.
    """
    if not request.clip_paths:
        raise HTTPException(status_code=400, detail="At least one clip must be selected")
    if not request.targets:
        raise HTTPException(status_code=400, detail="At least one target account must be selected")

    try:
        batch_job = start_batch_publish_job(request)
        return batch_job
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/batch/{batch_id}")
@router.get("/batch/{batch_id}/status")
def get_batch_status(batch_id: str):
    """Get live progress for a batch publish job."""
    status = get_batch_publish_job_status(batch_id)
    if not status:
        raise HTTPException(status_code=404, detail="Batch publish job not found")
    return status


@router.post("/batch/{batch_id}/retry")
def retry_batch_job(batch_id: str):
    """Retry failed part N and resume sequential batch upload."""
    try:
        updated = retry_batch_publish_job(batch_id, skip_failed=False)
        return updated
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/batch/{batch_id}/skip")
def skip_batch_failed_part(batch_id: str):
    """Skip failed part N and proceed to next sequential part N+1."""
    try:
        updated = retry_batch_publish_job(batch_id, skip_failed=True)
        return updated
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/history")
def list_history():
    """Retrieve full log of past publish jobs and their target URLs."""
    records = get_publish_history()
    return {"records": records}


@router.delete("/history")
def clear_all_history():
    """Clear all publish history records."""
    from storage import save_history
    save_history([])
    return {"success": True, "message": "All publish history records cleared"}


@router.delete("/history/{job_id}")
def delete_history_item(job_id: str):
    """Remove a specific publish record from history."""
    deleted = delete_publish_record(job_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Publish record not found")
    return {"success": True, "message": "History entry deleted"}


@router.get("/{job_id}/status")
def get_job_status(job_id: str):
    """Get live progress and target statuses for a publish job."""
    status = get_publish_job_status(job_id)
    if not status:
        raise HTTPException(status_code=404, detail="Publish job not found")
    return status

