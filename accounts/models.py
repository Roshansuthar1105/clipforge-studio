"""
accounts/models.py — Pydantic models for social media accounts.
"""
from __future__ import annotations
from typing import Optional
from pydantic import BaseModel


class Account(BaseModel):
    id: str
    platform: str                   # "youtube" | "instagram"
    alias: str                      # Display name shown in the UI
    channel_id: Optional[str] = None
    avatar_url: Optional[str] = None
    access_token: str
    refresh_token: Optional[str] = None
    token_expiry: Optional[str] = None   # ISO-8601 datetime string
    scopes: Optional[str] = None
    created_at: str

    def to_safe_dict(self) -> dict:
        """Return account dict with tokens redacted (for safe client responses)."""
        d = self.model_dump()
        d["access_token"]  = "***"
        d["refresh_token"] = "***" if d.get("refresh_token") else None
        return d
