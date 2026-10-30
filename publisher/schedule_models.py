"""
publisher/schedule_models.py — Data models for scheduled video publishing operations.
"""

from __future__ import annotations
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from publisher.models import PublishTarget


class CreateScheduleRequest(BaseModel):
    clip_path: str
    targets: List[PublishTarget]
    title: Optional[str] = None
    caption: Optional[str] = None
    privacy: Optional[str] = "public"
    scheduled_time: str  # ISO 8601 string, e.g. "2026-10-31T14:30:00"


class UpdateScheduleRequest(BaseModel):
    scheduled_time: Optional[str] = None
    title: Optional[str] = None
    caption: Optional[str] = None
    targets: Optional[List[PublishTarget]] = None
    privacy: Optional[str] = None


class ScheduledPost(BaseModel):
    id: str
    clip_path: str
    clip_name: str
    clip_url: Optional[str] = None
    targets: List[Dict[str, Any]]
    title: Optional[str] = None
    caption: Optional[str] = None
    privacy: str = "public"
    scheduled_time: str
    status: str = "scheduled"  # scheduled | publishing | completed | failed | cancelled
    created_at: str
    updated_at: str
    published_at: Optional[str] = None
    publish_job_id: Optional[str] = None
    error_message: Optional[str] = None
    user_id: Optional[str] = None

