"""
publisher/models.py — Data models for multi-account publishing operations.
"""

from __future__ import annotations
from typing import Optional, List, Any
from pydantic import BaseModel, Field, model_validator


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


class FacebookPublishConfig(BaseModel):
    title: str = ""
    description: str = ""
    as_reel: bool = True             # True = Facebook Reel, False = Facebook Feed Video


class PublishTarget(BaseModel):
    account_id: str
    platform: Optional[str] = "youtube"                    # "youtube" | "instagram" | "facebook"
    youtube_config: Optional[YouTubePublishConfig] = None
    instagram_config: Optional[InstagramPublishConfig] = None
    facebook_config: Optional[FacebookPublishConfig] = None


class PublishRequest(BaseModel):
    clip_path: Optional[str] = None
    clip_url: Optional[str] = None
    clip_name: Optional[str] = None
    targets: Optional[List[PublishTarget]] = None
    target_account_ids: Optional[List[str]] = None
    # Quick overrides applied across targets if not individually set:
    title: Optional[str] = None
    caption: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    privacy: Optional[str] = "public"
    publish_at: Optional[str] = None
    facebook_as_reel: bool = True
    instagram_share_to_feed: bool = True

    @model_validator(mode="before")
    @classmethod
    def populate_defaults(cls, data: Any) -> Any:
        if isinstance(data, dict):
            # Resolve clip path from clip_path, clip_url, or clip_name
            if not data.get("clip_path"):
                data["clip_path"] = data.get("clip_url") or data.get("clip_name") or ""
            # Resolve targets from targets or target_account_ids
            if not data.get("targets") and data.get("target_account_ids"):
                from storage import find_account
                targets = []
                for aid in data["target_account_ids"]:
                    acc = find_account(aid)
                    platform = (acc or {}).get("platform", "youtube")
                    targets.append({"account_id": aid, "platform": platform})
                data["targets"] = targets
        return data


class BatchPublishRequest(BaseModel):
    clip_paths: Optional[List[str]] = None
    clips: Optional[List[Any]] = None
    targets: Optional[List[PublishTarget]] = None
    target_account_ids: Optional[List[str]] = None
    title: Optional[str] = None
    title_prefix: Optional[str] = None
    caption: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    privacy: Optional[str] = "public"
    publish_at: Optional[str] = None
    stagger_minutes: int = 0
    facebook_as_reel: bool = True
    instagram_share_to_feed: bool = True

    @model_validator(mode="before")
    @classmethod
    def populate_defaults(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if not data.get("title_prefix") and data.get("title"):
                data["title_prefix"] = data["title"]
            if not data.get("clip_paths") and data.get("clips"):
                paths = []
                for c in data["clips"]:
                    if isinstance(c, str):
                        paths.append(c)
                    elif isinstance(c, dict):
                        paths.append(
                            c.get("clip_url")
                            or c.get("clip_path")
                            or c.get("clip_name")
                            or c.get("url")
                            or c.get("name")
                            or ""
                        )
                data["clip_paths"] = paths
            if not data.get("targets") and data.get("target_account_ids"):
                from storage import find_account
                targets = []
                for aid in data["target_account_ids"]:
                    acc = find_account(aid)
                    platform = (acc or {}).get("platform", "youtube")
                    targets.append({"account_id": aid, "platform": platform})
                data["targets"] = targets
        return data


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
