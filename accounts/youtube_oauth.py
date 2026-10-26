"""
accounts/youtube_oauth.py — Google OAuth 2.0 flow for YouTube Data API v3.
"""

import os
import datetime
from typing import Optional
import requests
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from dotenv import load_dotenv

load_dotenv()

YOUTUBE_SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/userinfo.profile",
]

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"


def get_google_client_id() -> str:
    load_dotenv(override=True)
    return os.getenv("GOOGLE_CLIENT_ID", "").strip()


def get_google_client_secret() -> str:
    load_dotenv(override=True)
    return os.getenv("GOOGLE_CLIENT_SECRET", "").strip()


def get_google_redirect_uri() -> str:
    load_dotenv(override=True)
    return os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/accounts/youtube/callback").strip()


def get_youtube_auth_url(state: Optional[str] = None) -> str:
    client_id = get_google_client_id()
    if not client_id:
        raise ValueError("GOOGLE_CLIENT_ID is not configured in .env")

    redirect_uri = get_google_redirect_uri()
    scope = " ".join(YOUTUBE_SCOPES)
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": scope,
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
    }
    if state:
        params["state"] = state

    req = requests.Request("GET", GOOGLE_AUTH_URL, params=params).prepare()
    return req.url


def exchange_code_for_tokens(code: str) -> dict:
    client_id = get_google_client_id()
    client_secret = get_google_client_secret()
    redirect_uri = get_google_redirect_uri()

    if not client_id or not client_secret:
        raise ValueError("Google OAuth credentials (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) missing")

    resp = requests.post(
        GOOGLE_TOKEN_URL,
        data={
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        },
        timeout=15,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"Google token exchange failed ({resp.status_code}): {resp.text}")

    return resp.json()


def get_channel_info_from_token(access_token: str) -> dict:
    """Fetch channel title, id, and avatar thumbnail using the access token."""
    creds = Credentials(token=access_token)
    youtube = build("youtube", "v3", credentials=creds)

    res = youtube.channels().list(part="snippet,id", mine=True).execute()
    items = res.get("items", [])
    if not items:
        # Fallback to general userinfo if no channel exists yet
        return {
            "channel_id": "unknown_channel",
            "title": "YouTube User",
            "avatar_url": None,
        }

    channel = items[0]
    channel_id = channel.get("id")
    snippet = channel.get("snippet", {})
    title = snippet.get("title", "YouTube Channel")
    thumbnails = snippet.get("thumbnails", {})
    avatar_url = (
        thumbnails.get("default", {}).get("url")
        or thumbnails.get("medium", {}).get("url")
    )

    return {
        "channel_id": channel_id,
        "title": title,
        "avatar_url": avatar_url,
    }


def refresh_youtube_token(account: dict) -> dict:
    """Refresh the access token using the stored refresh_token if needed."""
    refresh_token = account.get("refresh_token")
    if not refresh_token:
        # No refresh token available, cannot refresh
        return account

    client_id = get_google_client_id()
    client_secret = get_google_client_secret()

    creds = Credentials(
        token=account.get("access_token"),
        refresh_token=refresh_token,
        token_uri=GOOGLE_TOKEN_URL,
        client_id=client_id,
        client_secret=client_secret,
        scopes=YOUTUBE_SCOPES,
    )

    try:
        creds.refresh(Request())
        account["access_token"] = creds.token
        if creds.expiry:
            account["token_expiry"] = creds.expiry.isoformat()
    except Exception as exc:
        raise RuntimeError(f"Failed to refresh YouTube token for {account.get('alias')}: {exc}") from exc

    return account


def get_youtube_service(account: dict):
    """Return an authorized YouTube Data API service instance, refreshing token if expired."""
    refreshed_account = refresh_youtube_token(account)
    creds = Credentials(
        token=refreshed_account.get("access_token"),
        refresh_token=refreshed_account.get("refresh_token"),
        token_uri=GOOGLE_TOKEN_URL,
        client_id=get_google_client_id(),
        client_secret=get_google_client_secret(),
        scopes=YOUTUBE_SCOPES,
    )
    return build("youtube", "v3", credentials=creds), refreshed_account
