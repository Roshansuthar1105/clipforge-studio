"""
publisher/models.py — Data models for multi-account publishing operations.
"""

from __future__ import annotations
from typing import Optional, List
from pydantic import BaseModel, Field


class YouTubePublishConfig(BaseModel):
    title: str = "New Short"
    description: str = ""
    tags: List[str] = Field(default_factory=list)
    category_id: str = "22"          # 22 = People & Blogs
    privacy: str = "public"          # public | private | unlisted
    made_for_kids: bool = False


class InstagramPublishConfig(BaseModel):
    caption: str = ""
    share_to_feed: bool = True


class PublishTarget(BaseModel):
    account_id: str
    platform: str                    # "youtube" | "instagram"
    youtube_config: Optional[YouTubePublishConfig] = None
    instagram_config: Optional[InstagramPublishConfig] = None


class PublishRequest(BaseModel):
    clip_path: str
    targets: List[PublishTarget]
    # Quick overrides applied across targets if not individually set:
    title: Optional[str] = None
    caption: Optional[str] = None
    privacy: Optional[str] = "public"


class TargetStatus(BaseModel):
    account_id: str
    account_alias: str
    platform: str
    status: str = "queued"          # queued | uploading | processing | success | failed
    progress: int = 0
    url: Optional[str] = None
    error: Optional[str] = None
    finished_at: Optional[str] = None


class PublishJobStatus(BaseModel):
    job_id: str
    clip_path: str
    clip_name: str
    started_at: str
    targets: List[TargetStatus]
    all_done: bool = False
