"""
accounts/manager.py — High-level account lifecycle, CRUD, and status checks.
"""

import uuid
import datetime
from typing import Optional

from storage import (
    load_accounts,
    save_accounts,
    find_account,
    upsert_account,
    delete_account,
)
from accounts.models import Account
from accounts.youtube_oauth import (
    exchange_code_for_tokens,
    get_channel_info_from_token,
    refresh_youtube_token,
)
from accounts.instagram_oauth import (
    exchange_code_for_user_token,
    get_long_lived_token,
    fetch_instagram_accounts,
    check_instagram_token_validity,
)


def list_accounts_safe() -> list[dict]:
    """Return all stored accounts with tokens safely redacted for frontend display."""
    accounts = load_accounts()
    safe_list = []
    for raw in accounts:
        try:
            acc = Account(**raw)
            safe_list.append(acc.to_safe_dict())
        except Exception:
            # In case of partial dict, redact manually
            safe = dict(raw)
            safe["access_token"] = "***"
            if safe.get("refresh_token"):
                safe["refresh_token"] = "***"
            safe_list.append(safe)
    return safe_list


def get_account(account_id: str) -> dict | None:
    return find_account(account_id)


def remove_account(account_id: str) -> bool:
    return delete_account(account_id)


def connect_youtube_from_code(code: str) -> dict:
    """Exchange Google OAuth code and save connected YouTube channel account."""
    token_data = exchange_code_for_tokens(code)
    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    expires_in = token_data.get("expires_in", 3600)
    scopes = token_data.get("scope", "")

    expiry_time = (
        datetime.datetime.now(datetime.timezone.utc)
        + datetime.timedelta(seconds=expires_in)
    ).isoformat()

    channel_info = get_channel_info_from_token(access_token)
    channel_id = channel_info.get("channel_id")
    title = channel_info.get("title") or "YouTube Channel"
    avatar_url = channel_info.get("avatar_url")

    # Check if this channel already exists in storage to reuse ID
    existing = None
    for acc in load_accounts():
        if acc.get("platform") == "youtube" and acc.get("channel_id") == channel_id:
            existing = acc
            break

    account_id = existing["id"] if existing else str(uuid.uuid4())
    # If existing has refresh_token and new response didn't supply one, keep old refresh_token
    if existing and not refresh_token:
        refresh_token = existing.get("refresh_token")

    account = {
        "id": account_id,
        "platform": "youtube",
        "alias": title,
        "channel_id": channel_id,
        "avatar_url": avatar_url,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_expiry": expiry_time,
        "scopes": scopes,
        "created_at": existing.get("created_at") if existing else datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }

    upsert_account(account)
    return Account(**account).to_safe_dict()


def connect_instagram_from_code(code: str) -> list[dict]:
    """Exchange Meta OAuth code, fetch linked IG accounts, and store them."""
    user_token_resp = exchange_code_for_user_token(code)
    short_token = user_token_resp.get("access_token")

    # Upgrade to long-lived 60-day token
    long_token_resp = get_long_lived_token(short_token)
    long_token = long_token_resp.get("access_token", short_token)
    expires_in = long_token_resp.get("expires_in", 5184000)  # ~60 days

    expiry_time = (
        datetime.datetime.now(datetime.timezone.utc)
        + datetime.timedelta(seconds=expires_in)
    ).isoformat()

    ig_accounts = fetch_instagram_accounts(long_token)
    if not ig_accounts:
        raise ValueError(
            "No Instagram Business or Creator accounts linked to your Facebook pages were found. "
            "Please ensure your Instagram account is set to Business/Creator and linked to a Facebook Page."
        )

    connected_list = []
    for ig in ig_accounts:
        channel_id = ig["ig_user_id"]
        alias = f"@{ig['username']}"
        avatar_url = ig.get("avatar_url")
        token = ig.get("access_token", long_token)

        existing = None
        for acc in load_accounts():
            if acc.get("platform") == "instagram" and acc.get("channel_id") == channel_id:
                existing = acc
                break

        account_id = existing["id"] if existing else str(uuid.uuid4())
        account = {
            "id": account_id,
            "platform": "instagram",
            "alias": alias,
            "channel_id": channel_id,
            "avatar_url": avatar_url,
            "access_token": token,
            "refresh_token": None,
            "token_expiry": expiry_time,
            "scopes": "instagram_basic,instagram_content_publish",
            "created_at": existing.get("created_at") if existing else datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }
        upsert_account(account)
        connected_list.append(Account(**account).to_safe_dict())

    return connected_list


def add_manual_account(
    platform: str,
    alias: str,
    access_token: str,
    channel_id: Optional[str] = None,
    refresh_token: Optional[str] = None,
    avatar_url: Optional[str] = None,
) -> dict:
    """Manually add an account (useful for testing or direct token input)."""
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    account_id = str(uuid.uuid4())
    account = {
        "id": account_id,
        "platform": platform.lower(),
        "alias": alias,
        "channel_id": channel_id or alias,
        "avatar_url": avatar_url,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_expiry": None,
        "scopes": "manual",
        "created_at": now,
    }
    upsert_account(account)
    return Account(**account).to_safe_dict()


def check_account_health(account_id: str) -> dict:
    """Check whether the stored token is still valid and refresh if necessary."""
    account = find_account(account_id)
    if not account:
        return {"valid": False, "message": "Account not found"}

    platform = account.get("platform")

    if platform == "youtube":
        try:
            # Refresh if refresh_token exists
            refreshed = refresh_youtube_token(account)
            upsert_account(refreshed)
            info = get_channel_info_from_token(refreshed["access_token"])
            return {
                "valid": True,
                "message": f"Channel active: {info.get('title')}",
                "expires_at": refreshed.get("token_expiry"),
            }
        except Exception as exc:
            return {"valid": False, "message": f"YouTube auth check failed: {str(exc)}"}

    elif platform == "instagram":
        valid = check_instagram_token_validity(account.get("access_token", ""))
        return {
            "valid": valid,
            "message": "Token active" if valid else "Token invalid or expired",
            "expires_at": account.get("token_expiry"),
        }

    return {"valid": False, "message": f"Unknown platform: {platform}"}
