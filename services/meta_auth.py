"""
services/meta_auth.py — Async Meta token exchange and account discovery utilities.

All functions in this module use `httpx.AsyncClient` and return plain dicts or
strings — they do NOT modify the .env file (that is the caller's responsibility).

Usage during initial setup:
  1. exchange_for_long_lived_user_token(short_token)  -> store 60-day token
  2. get_page_access_token(long_token, page_id)        -> store permanent page token
  3. get_instagram_account_id(page_token, page_id)     -> store IG account ID
  4. discover_pages_and_ig(user_token)                 -> list pages/IG for UI picker
"""

from __future__ import annotations

import httpx
from config import get_settings


# ---------------------------------------------------------------------------
# Token exchange helpers
# ---------------------------------------------------------------------------

async def exchange_for_long_lived_user_token(short_lived_token: str) -> dict:
    """
    Convert a 1-hour short-lived user token (from Graph API Explorer) into a
    60-day long-lived user token.

    Args:
        short_lived_token: The short-lived access token to exchange.

    Returns:
        Full response dict containing ``access_token`` (60-day) and ``expires_in``.

    Raises:
        httpx.HTTPStatusError: If the Graph API returns a non-2xx response.
    """
    settings = get_settings()
    params = {
        "grant_type": "fb_exchange_token",
        "client_id": settings.meta_app_id,
        "client_secret": settings.meta_app_secret,
        "fb_exchange_token": short_lived_token,
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{settings.graph_url}/oauth/access_token", params=params)
        resp.raise_for_status()
        return resp.json()


async def get_page_access_token(long_lived_user_token: str, page_id: str) -> str:
    """
    Fetch the Page Access Token for a specific Facebook Page.

    IMPORTANT: When a Page Access Token is obtained using a *long-lived* user
    token, the resulting page token does NOT expire (unless the user changes
    their password or revokes app access).  Store this token in .env as
    META_PAGE_ACCESS_TOKEN and use it for all publishing calls.

    Args:
        long_lived_user_token: A 60-day (or never-expiring) user access token.
        page_id: The numeric Facebook Page ID.

    Returns:
        The never-expiring Page Access Token string.

    Raises:
        httpx.HTTPStatusError: On API error.
        KeyError: If the response does not contain an ``access_token`` field.
    """
    settings = get_settings()
    params = {
        "fields": "access_token,name",
        "access_token": long_lived_user_token,
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{settings.graph_url}/{page_id}", params=params)
        resp.raise_for_status()
        data = resp.json()
        return data["access_token"]


async def get_instagram_account_id(page_access_token: str, page_id: str) -> str:
    """
    Retrieve the Instagram Business Account ID linked to a Facebook Page.

    Args:
        page_access_token: The Page Access Token for the Page.
        page_id: The numeric Facebook Page ID.

    Returns:
        The numeric Instagram Business Account ID string.

    Raises:
        ValueError: If no Instagram Business Account is linked to the Page.
        httpx.HTTPStatusError: On API error.
    """
    settings = get_settings()
    params = {
        "fields": "instagram_business_account",
        "access_token": page_access_token,
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{settings.graph_url}/{page_id}", params=params)
        resp.raise_for_status()
        data = resp.json()

    ig_account = data.get("instagram_business_account")
    if not ig_account or not ig_account.get("id"):
        raise ValueError(
            f"No Instagram Business Account is linked to Facebook Page '{page_id}'. "
            "Make sure the page is connected to an Instagram Business or Creator account "
            "via the Facebook Business Settings."
        )

    return ig_account["id"]


async def discover_pages_and_ig(user_token: str) -> list[dict]:
    """
    List all Facebook Pages the user manages, including any linked Instagram
    Business Accounts.

    Useful during initial setup to let users find their Page ID and IG Account ID.

    Args:
        user_token: A valid user access token with ``pages_show_list`` scope.

    Returns:
        A list of page dicts, each containing at minimum ``id``, ``name``,
        ``access_token``, and optionally ``instagram_business_account``.
    """
    settings = get_settings()
    params = {
        "fields": "id,name,access_token,instagram_business_account",
        "access_token": user_token,
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{settings.graph_url}/me/accounts", params=params)
        resp.raise_for_status()
        return resp.json().get("data", [])
