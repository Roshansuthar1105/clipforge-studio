"""
routers/publish_router.py — FastAPI endpoints for publishing clips and retrieving publish history.
"""

from fastapi import APIRouter, HTTPException
from publisher.models import PublishRequest
from publisher.jobs import start_publish_job, get_publish_job_status
from publisher.history import get_publish_history, delete_publish_record

router = APIRouter(prefix="/publish", tags=["Publishing"])


@router.post("")
def publish_clip(request: PublishRequest):
    """
    Start an asynchronous multi-target publishing job.
    Accepts clip path and list of target accounts with optional per-platform configs.
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


@router.get("/history")
def list_history():
    """Retrieve full log of past publish jobs and their target URLs."""
    records = get_publish_history()
    return {"records": records}


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
