"""
accounts/manager.py — High-level account lifecycle, CRUD, and status checks.
"""

import os
import uuid
import datetime
from typing import Optional
import requests
from dotenv import load_dotenv

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


def sync_accounts_from_env(auto: bool = False, user_id: Optional[str] = None) -> list[dict]:
    """
    Sync Facebook Page and Instagram accounts defined in .env into local storage.
    Uses META_PAGE_ACCESS_TOKEN, FACEBOOK_PAGE_ID, and INSTAGRAM_ACCOUNT_ID.
    Fetches real account aliases and avatars from Meta Graph API when possible.
    """
    load_dotenv(override=True)
    page_token = os.getenv("META_PAGE_ACCESS_TOKEN", "").strip()
    fb_page_id = os.getenv("FACEBOOK_PAGE_ID", "").strip()
    ig_account_id = os.getenv("INSTAGRAM_ACCOUNT_ID", "").strip()
    api_version = os.getenv("META_API_VERSION", "v22.0").strip()

    if not page_token:
        return []

    synced_accounts = []
    current_accounts = load_accounts(user_id)

    # 1. Sync Facebook Page Account
    if fb_page_id:
        existing_fb = None
        for acc in current_accounts:
            if acc.get("platform") == "facebook" and str(acc.get("channel_id")) == str(fb_page_id):
                existing_fb = acc
                break

        page_name = "Facebook Page"
        avatar_url = None

        try:
            url = f"https://graph.facebook.com/{api_version}/{fb_page_id}"
            resp = requests.get(
                url,
                params={"fields": "id,name,picture", "access_token": page_token},
                timeout=8,
            )
            if resp.status_code == 200:
                data = resp.json()
                page_name = data.get("name") or page_name
                pic_data = data.get("picture", {}).get("data", {})
                if pic_data.get("url"):
                    avatar_url = pic_data["url"]
        except Exception:
            if existing_fb and existing_fb.get("alias"):
                page_name = existing_fb["alias"]

        fb_acc_id = existing_fb["id"] if existing_fb else f"fb-{fb_page_id}"
        fb_account = {
            "id": fb_acc_id,
            "platform": "facebook",
            "alias": page_name,
            "channel_id": fb_page_id,
            "avatar_url": avatar_url or (existing_fb.get("avatar_url") if existing_fb else None),
            "access_token": page_token,
            "refresh_token": None,
            "token_expiry": None,  # Permanent page token
            "scopes": "pages_show_list,pages_manage_posts,pages_read_engagement",
            "created_at": existing_fb.get("created_at") if existing_fb else datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }
        upsert_account(fb_account, user_id=user_id or "global")
        synced_accounts.append(fb_account)

    # 2. Sync Instagram Account linked to the Page
    if ig_account_id:
        existing_ig = None
        for acc in current_accounts:
            if acc.get("platform") == "instagram" and str(acc.get("channel_id")) == str(ig_account_id):
                existing_ig = acc
                break

        ig_name = "Instagram Account"
        ig_avatar = None

        try:
            url = f"https://graph.facebook.com/{api_version}/{ig_account_id}"
            resp = requests.get(
                url,
                params={"fields": "id,username,name,profile_picture_url", "access_token": page_token},
                timeout=8,
            )
            if resp.status_code == 200:
                data = resp.json()
                username = data.get("username")
                ig_name = f"@{username}" if username else (data.get("name") or ig_name)
                ig_avatar = data.get("profile_picture_url")
        except Exception:
            if existing_ig and existing_ig.get("alias"):
                ig_name = existing_ig["alias"]

        ig_acc_id = existing_ig["id"] if existing_ig else f"ig-{ig_account_id}"
        ig_account = {
            "id": ig_acc_id,
            "platform": "instagram",
            "alias": ig_name,
            "channel_id": ig_account_id,
            "avatar_url": ig_avatar or (existing_ig.get("avatar_url") if existing_ig else None),
            "access_token": page_token,
            "refresh_token": None,
            "token_expiry": None,
            "scopes": "instagram_basic,instagram_content_publish",
            "created_at": existing_ig.get("created_at") if existing_ig else datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }
        upsert_account(ig_account, user_id=user_id or "global")
        synced_accounts.append(ig_account)

    return synced_accounts


def list_accounts_safe(user_id: Optional[str] = None) -> list[dict]:
    """Return stored accounts scoped to user_id (and global) with tokens safely redacted for frontend display."""
    try:
        sync_accounts_from_env(auto=True, user_id=user_id)
    except Exception:
        pass

    accounts = load_accounts(user_id)
    if user_id:
        global_accounts = [a for a in load_accounts("global") if a.get("id") not in [x.get("id") for x in accounts]]
        accounts = accounts + global_accounts

    safe_list = []
    for raw in accounts:
        try:
            acc = Account(**raw)
            safe_list.append(acc.to_safe_dict())
        except Exception:
            safe = dict(raw)
            safe["access_token"] = "***"
            if safe.get("refresh_token"):
                safe["refresh_token"] = "***"
            safe_list.append(safe)
    return safe_list


def get_account(account_id: str, user_id: Optional[str] = None) -> dict | None:
    return find_account(account_id, user_id=user_id)


def remove_account(account_id: str, user_id: Optional[str] = None) -> bool:
    return delete_account(account_id, user_id=user_id)


def connect_youtube_from_code(code: str, user_id: Optional[str] = None) -> dict:
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
    for acc in load_accounts(user_id):
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
        "user_id": user_id or "global",
        "created_at": existing.get("created_at") if existing else datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }

    upsert_account(account, user_id=user_id)
    return Account(**account).to_safe_dict()


def connect_instagram_from_code(code: str, user_id: Optional[str] = None) -> list[dict]:
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
        for acc in load_accounts(user_id):
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
            "user_id": user_id or "global",
            "created_at": existing.get("created_at") if existing else datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }
        upsert_account(account, user_id=user_id)
        connected_list.append(Account(**account).to_safe_dict())

    return connected_list


def add_manual_account(
    platform: str,
    alias: str,
    access_token: str,
    channel_id: Optional[str] = None,
    refresh_token: Optional[str] = None,
    avatar_url: Optional[str] = None,
    user_id: Optional[str] = None,
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
        "user_id": user_id or "global",
        "created_at": now,
    }
    upsert_account(account, user_id=user_id)
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

    elif platform == "facebook":
        page_id = account.get("channel_id")
        token = account.get("access_token", "")
        api_ver = os.getenv("META_API_VERSION", "v22.0")
        try:
            r = requests.get(
                f"https://graph.facebook.com/{api_ver}/{page_id}",
                params={"fields": "id,name", "access_token": token},
                timeout=10,
            )
            if r.status_code == 200:
                p_name = r.json().get("name", "Facebook Page")
                return {
                    "valid": True,
                    "message": f"Page active: {p_name}",
                    "expires_at": "Never (Permanent Page Token)",
                }
            else:
                return {"valid": False, "message": f"Facebook check failed: {r.text}"}
        except Exception as exc:
            return {"valid": False, "message": f"Facebook check error: {str(exc)}"}

    return {"valid": False, "message": f"Unknown platform: {platform}"}
