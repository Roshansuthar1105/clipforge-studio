"""
config.py — Pydantic Settings for ClipForge Studio (Meta publishing).

Reads all configuration from the .env file so no secrets are hard-coded.
Import `get_settings()` anywhere in the project to access settings.
"""

from __future__ import annotations

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central configuration loaded from .env."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",          # silently ignore unrecognised env vars
        case_sensitive=False,
    )

    # ------------------------------------------------------------------ #
    # Meta / Facebook / Instagram credentials                              #
    # ------------------------------------------------------------------ #
    meta_app_id: str = ""
    meta_app_secret: str = ""

    # Short-lived or long-lived *user* token (used only during token exchange,
    # NOT for publishing).  Store here after the initial OAuth dance.
    meta_user_access_token: str = ""

    # Never-expiring Page Access Token — used for ALL publishing API calls.
    meta_page_access_token: str = ""

    # Facebook Page linked to the Instagram Business/Creator account.
    facebook_page_id: str = ""

    # Instagram Business Account ID linked to the Facebook Page.
    instagram_account_id: str = ""

    # ------------------------------------------------------------------ #
    # Meta Graph API settings                                              #
    # ------------------------------------------------------------------ #
    meta_api_version: str = "v22.0"
    meta_graph_base: str = "https://graph.facebook.com"

    # ------------------------------------------------------------------ #
    # Instagram container polling                                          #
    # ------------------------------------------------------------------ #
    poll_interval_seconds: int = 5
    poll_max_attempts: int = 60   # 5 minutes max (60 × 5 s)

    # ------------------------------------------------------------------ #
    # Upload chunking                                                       #
    # ------------------------------------------------------------------ #
    chunk_size_bytes: int = 10 * 1024 * 1024  # 10 MB

    # ------------------------------------------------------------------ #
    # File paths                                                            #
    # ------------------------------------------------------------------ #
    clips_directory: str = "data/clips"

    # ------------------------------------------------------------------ #
    # Computed helpers                                                      #
    # ------------------------------------------------------------------ #
    @property
    def graph_url(self) -> str:
        """Full versioned Graph API base URL, e.g. https://graph.facebook.com/v22.0."""
        return f"{self.meta_graph_base}/{self.meta_api_version}"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """
    Return a cached Settings instance.

    Using @lru_cache ensures the .env file is read only once per process.
    Call get_settings.cache_clear() in tests to reload the file.
    """
    return Settings()
