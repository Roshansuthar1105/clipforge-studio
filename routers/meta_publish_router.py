"""
routers/meta_publish_router.py — FastAPI router for Meta (Instagram + Facebook)
publishing and one-time auth setup.

Prefix: /api/v1/meta-publish

Endpoints:
  POST  /                         — Publish a clip to one or more Meta platforms
  POST  /auth/exchange-token      — Exchange short-lived → long-lived user token
  POST  /auth/page-token          — Get a never-expiring Page Access Token
  GET   /auth/discover            — List Pages + linked IG accounts
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from config import get_settings
from services.models import (
    MetaPublishRequest,
    MetaPublishResponse,
    PublishPlatform,
    PublishResult,
    PublishStatus,
)
from services.meta_auth import (
    discover_pages_and_ig,
    exchange_for_long_lived_user_token,
    get_page_access_token,
)
from services.instagram_publisher import publish_instagram_reel
from services.facebook_publisher import publish_facebook_reel, publish_facebook_video

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/meta-publish", tags=["Meta Publishing"])

# Allowed video file extensions
_ALLOWED_EXTENSIONS = {".mp4", ".mov"}


# ---------------------------------------------------------------------------
# Main publish endpoint
# ---------------------------------------------------------------------------

@router.post("/", response_model=MetaPublishResponse)
async def publish_clip(req: MetaPublishRequest) -> MetaPublishResponse:
    """
    Publish a clip from the configured clips directory to one or more Meta
    platforms (Instagram Reels, Facebook Reels, and/or Facebook Feed Video).

    Each platform is attempted independently — a failure on one does NOT
    prevent attempts on the others.

    Request body example::

        {
            "clip_filename": "my_video_part_1.mp4",
            "caption": "Check this out! #shorts #reels",
            "title": "My Awesome Clip",
            "platforms": ["instagram_reels", "facebook_reels"],
            "share_to_feed": true
        }
    """
    settings = get_settings()

    # ------------------------------------------------------------------ #
    # Validate the clip file                                               #
    # ------------------------------------------------------------------ #
    clip_path = Path(settings.clips_directory) / req.clip_filename

    if not clip_path.is_file():
        raise HTTPException(
            status_code=404,
            detail=(
                f"Clip '{req.clip_filename}' was not found in "
                f"'{settings.clips_directory}'.  "
                "Make sure the file is in the clips directory and try again."
            ),
        )

    if clip_path.suffix.lower() not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported file format '{clip_path.suffix}'.  "
                f"Allowed: {', '.join(_ALLOWED_EXTENSIONS)}"
            ),
        )

    # ------------------------------------------------------------------ #
    # Publish to each requested platform                                   #
    # ------------------------------------------------------------------ #
    results: list[PublishResult] = []

    for platform in req.platforms:
        logger.info("Publishing '%s' to %s …", req.clip_filename, platform)

        if platform == PublishPlatform.instagram_reels:
            result = await publish_instagram_reel(
                video_path=clip_path,
                caption=req.caption,
                share_to_feed=req.share_to_feed,
            )

        elif platform == PublishPlatform.facebook_reels:
            result = await publish_facebook_reel(
                video_path=clip_path,
                caption=req.caption,
                title=req.title,
            )

        elif platform == PublishPlatform.facebook_video:
            result = await publish_facebook_video(
                video_path=clip_path,
                caption=req.caption,
                title=req.title,
            )

        else:
            # Should never happen due to Pydantic enum validation
            result = PublishResult(
                platform=platform,
                status=PublishStatus.failed,
                error_message=f"Unknown platform: {platform}",
            )

        results.append(result)
        logger.info(
            "Platform %s → status=%s media_id=%s",
            platform,
            result.status,
            result.media_id,
        )

    return MetaPublishResponse(clip_filename=req.clip_filename, results=results)


# ---------------------------------------------------------------------------
# Auth helper endpoints (one-time setup)
# ---------------------------------------------------------------------------

@router.post("/auth/exchange-token")
async def exchange_token(
    short_lived_token: str = Query(
        ...,
        description=(
            "A short-lived (1-hour) user access token obtained from the "
            "Meta Graph API Explorer.  This call exchanges it for a 60-day token."
        ),
    )
) -> dict:
    """
    Exchange a short-lived user token for a long-lived (~60 day) user token.

    **Next step**: Use ``POST /auth/page-token`` with this token to get a
    never-expiring Page Access Token.
    """
    try:
        data = await exchange_for_long_lived_user_token(short_lived_token)
        return {
            "long_lived_token": data.get("access_token"),
            "expires_in_seconds": data.get("expires_in"),
            "next_step": (
                "Store this token temporarily and call "
                "POST /api/v1/meta-publish/auth/page-token with it."
            ),
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/auth/page-token")
async def page_token(
    long_lived_user_token: str = Query(
        ...,
        description="The 60-day long-lived user token from /auth/exchange-token.",
    ),
    page_id: str = Query(
        ...,
        description="Your Facebook Page numeric ID (find it via GET /auth/discover).",
    ),
) -> dict:
    """
    Get a never-expiring Page Access Token for a specific Facebook Page.

    **Store this in your .env** as ``META_PAGE_ACCESS_TOKEN``.  It is used for
    all Instagram and Facebook publishing calls.
    """
    try:
        token = await get_page_access_token(long_lived_user_token, page_id)
        return {
            "page_access_token": token,
            "expires": "never (unless password changed or app access revoked)",
            "action_required": (
                f"Add this to .env:  META_PAGE_ACCESS_TOKEN={token}  "
                f"and also set  FACEBOOK_PAGE_ID={page_id}"
            ),
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/auth/discover")
async def discover(
    user_token: str = Query(
        ...,
        description=(
            "Any valid user access token with pages_show_list scope.  "
            "Returns all Pages + linked Instagram accounts."
        ),
    )
) -> dict:
    """
    Discover all Facebook Pages you manage and any linked Instagram Business
    Accounts.

    Use the IDs from this response to populate:
    - ``FACEBOOK_PAGE_ID`` in .env
    - ``INSTAGRAM_ACCOUNT_ID`` in .env
    """
    try:
        pages = await discover_pages_and_ig(user_token)
        return {
            "pages": pages,
            "tip": (
                "Copy the Page 'id' into FACEBOOK_PAGE_ID and the "
                "instagram_business_account.id into INSTAGRAM_ACCOUNT_ID in your .env file."
            ),
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
