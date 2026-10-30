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


def fetch_meta_pages_and_instagram(token: str) -> dict:
    """
    Auto-discover all Facebook Pages and linked Instagram Business/Creator accounts
    from any Meta access token (User Token, Long-Lived Token, or Page Token).
    """
    token = token.strip()
    result = {
        "facebook_pages": [],
        "instagram_accounts": [],
    }

    # 1. Try fetching via /me/accounts (works for User Access Tokens)
    try:
        url = f"{META_GRAPH_URL}/me/accounts"
        params = {
            "fields": "id,name,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}",
            "access_token": token,
        }
        resp = requests.get(url, params=params, timeout=15)
        if resp.status_code == 200:
            pages = resp.json().get("data", [])
            for p in pages:
                page_id = p.get("id")
                page_name = p.get("name")
                page_token = p.get("access_token", token)
                page_pic = (p.get("picture", {}) or {}).get("data", {}).get("url")

                result["facebook_pages"].append({
                    "page_id": page_id,
                    "name": page_name,
                    "access_token": page_token,
                    "avatar_url": page_pic,
                })

                ig = p.get("instagram_business_account")
                if ig:
                    result["instagram_accounts"].append({
                        "ig_user_id": ig.get("id"),
                        "username": ig.get("username", "instagram_account"),
                        "name": ig.get("name") or page_name,
                        "avatar_url": ig.get("profile_picture_url") or page_pic,
                        "access_token": page_token,
                        "page_id": page_id,
                    })
    except Exception:
        pass

    # 2. If nothing found via /me/accounts, try querying /me directly (works if token is already a Page Token)
    if not result["facebook_pages"] and not result["instagram_accounts"]:
        try:
            url = f"{META_GRAPH_URL}/me"
            params = {
                "fields": "id,name,picture{url},instagram_business_account{id,username,name,profile_picture_url}",
                "access_token": token,
            }
            resp = requests.get(url, params=params, timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                page_id = data.get("id")
                page_name = data.get("name")
                page_pic = (data.get("picture", {}) or {}).get("data", {}).get("url")

                result["facebook_pages"].append({
                    "page_id": page_id,
                    "name": page_name,
                    "access_token": token,
                    "avatar_url": page_pic,
                })

                ig = data.get("instagram_business_account")
                if ig:
                    result["instagram_accounts"].append({
                        "ig_user_id": ig.get("id"),
                        "username": ig.get("username", "instagram_account"),
                        "name": ig.get("name") or page_name,
                        "avatar_url": ig.get("profile_picture_url") or page_pic,
                        "access_token": token,
                        "page_id": page_id,
                    })
        except Exception:
            pass

    return result


def check_instagram_token_validity(access_token: str) -> bool:
    """Quick check if token is valid by querying /me."""
    try:
        if access_token.startswith("IG"):
            url = "https://graph.instagram.com/v26.0/me"
            resp = requests.get(url, params={"fields": "user_id,username", "access_token": access_token}, timeout=10)
        else:
            url = f"{META_GRAPH_URL}/me"
            resp = requests.get(url, params={"access_token": access_token}, timeout=10)
        return resp.status_code == 200
    except Exception:
        return False
