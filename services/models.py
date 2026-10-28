"""
services/models.py — Pydantic request/response models for the Meta publishing system.

These models are used by the /api/v1/meta-publish router and the Instagram/Facebook
publisher services.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional
from pydantic import BaseModel


class PublishPlatform(str, Enum):
    """Target platform for a publishing request."""
    instagram_reels = "instagram_reels"
    facebook_reels = "facebook_reels"
    facebook_video = "facebook_video"


class PublishStatus(str, Enum):
    """Lifecycle status of a single publish attempt."""
    pending = "pending"
    uploading = "uploading"
    processing = "processing"
    published = "published"
    failed = "failed"


class MetaPublishRequest(BaseModel):
    """
    Incoming request body for POST /api/v1/meta-publish/.

    Attributes:
        clip_filename: Filename (not full path) of the clip inside the
            configured ``clips_directory``.
        caption: Post caption / description, including any hashtags.
        title: Optional video title (used for Facebook feed videos).
        platforms: One or more target platforms.  Defaults to Instagram Reels.
        share_to_feed: When True the Instagram Reel is shown on the profile grid
            in addition to the Reels tab.
    """
    clip_filename: str
    caption: str = ""
    title: str = ""
    platforms: list[PublishPlatform] = [PublishPlatform.instagram_reels]
    share_to_feed: bool = True


class PublishResult(BaseModel):
    """
    Result for a single platform publish attempt.

    Attributes:
        platform: Which platform this result belongs to.
        status: Final publish status.
        media_id: Platform-assigned media ID on success.
        error_message: Human-readable error description on failure.
        details: Optional arbitrary extra details from the platform response.
    """
    platform: PublishPlatform
    status: PublishStatus
    media_id: Optional[str] = None
    error_message: Optional[str] = None
    details: Optional[dict] = None


class MetaPublishResponse(BaseModel):
    """
    Top-level API response for a publish request.

    Attributes:
        clip_filename: The clip that was published.
        results: One ``PublishResult`` per requested platform.
    """
    clip_filename: str
    results: list[PublishResult]
