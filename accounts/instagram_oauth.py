"""
accounts/instagram_oauth.py — Meta Graph API OAuth & Instagram Account helpers.
"""

import os
import datetime
from typing import Optional
import requests
from dotenv import load_dotenv

load_dotenv()

META_AUTH_URL = "https://www.facebook.com/v19.0/dialog/oauth"
META_GRAPH_URL = "https://graph.facebook.com/v19.0"

META_SCOPES = [
    "instagram_basic",
    "instagram_content_publish",
    "pages_show_list",
    "pages_read_engagement",
]


def get_meta_app_id() -> str:
    load_dotenv(override=True)
    return os.getenv("META_APP_ID", "").strip()


def get_meta_app_secret() -> str:
    load_dotenv(override=True)
    return os.getenv("META_APP_SECRET", "").strip()


def get_meta_redirect_uri() -> str:
    load_dotenv(override=True)
    return os.getenv("META_REDIRECT_URI", "http://localhost:8000/accounts/instagram/callback").strip()


def get_instagram_auth_url(state: Optional[str] = None) -> str:
    app_id = get_meta_app_id()
    if not app_id:
        raise ValueError("META_APP_ID is not configured in .env")

    redirect_uri = get_meta_redirect_uri()
    scope = ",".join(META_SCOPES)
    params = {
        "client_id": app_id,
        "redirect_uri": redirect_uri,
        "scope": scope,
        "response_type": "code",
    }
    if state:
        params["state"] = state

    req = requests.Request("GET", META_AUTH_URL, params=params).prepare()
    return req.url


def exchange_code_for_user_token(code: str) -> dict:
    """Exchange OAuth code for a short-lived user access token."""
    app_id = get_meta_app_id()
    app_secret = get_meta_app_secret()
    redirect_uri = get_meta_redirect_uri()

    if not app_id or not app_secret:
        raise ValueError("Meta credentials (META_APP_ID / META_APP_SECRET) missing")

    url = f"{META_GRAPH_URL}/oauth/access_token"
    params = {
        "client_id": app_id,
        "client_secret": app_secret,
        "redirect_uri": redirect_uri,
        "code": code,
    }
    resp = requests.get(url, params=params, timeout=15)
    if resp.status_code != 200:
        raise RuntimeError(f"Meta code exchange failed ({resp.status_code}): {resp.text}")

    return resp.json()


def get_long_lived_token(short_token: str) -> dict:
    """Exchange short-lived token for a long-lived (~60 days) token."""
    app_id = get_meta_app_id()
    app_secret = get_meta_app_secret()

    url = f"{META_GRAPH_URL}/oauth/access_token"
    params = {
        "grant_type": "fb_exchange_token",
        "client_id": app_id,
        "client_secret": app_secret,
        "fb_exchange_token": short_token,
    }
    resp = requests.get(url, params=params, timeout=15)
    if resp.status_code != 200:
        raise RuntimeError(f"Meta long-lived token exchange failed ({resp.status_code}): {resp.text}")

    return resp.json()


def fetch_instagram_accounts(user_access_token: str) -> list[dict]:
    """
    Fetch linked Instagram Business / Creator accounts via Facebook Pages.
    Returns list of dicts with keys: {ig_user_id, username, name, avatar_url, page_access_token}
    """
    url = f"{META_GRAPH_URL}/me/accounts"
    params = {
        "fields": "id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}",
        "access_token": user_access_token,
    }
    resp = requests.get(url, params=params, timeout=15)
    if resp.status_code != 200:
        raise RuntimeError(f"Failed to fetch Facebook pages ({resp.status_code}): {resp.text}")

    data = resp.json().get("data", [])
    results = []
    for page in data:
        ig_biz = page.get("instagram_business_account")
        if ig_biz:
            results.append({
                "ig_user_id": ig_biz.get("id"),
                "username": ig_biz.get("username", "instagram_account"),
                "name": ig_biz.get("name") or page.get("name"),
                "avatar_url": ig_biz.get("profile_picture_url"),
                "access_token": page.get("access_token", user_access_token),
                "page_id": page.get("id"),
            })

    return results


def check_instagram_token_validity(access_token: str) -> bool:
    """Quick check if token is valid by querying /me."""
    try:
        url = f"{META_GRAPH_URL}/me"
        resp = requests.get(url, params={"access_token": access_token}, timeout=10)
        return resp.status_code == 200
    except Exception:
        return False
