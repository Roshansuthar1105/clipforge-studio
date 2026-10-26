"""
routers/accounts_router.py — FastAPI endpoints for managing social media accounts.
"""

from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel

from accounts.manager import (
    list_accounts_safe,
    get_account,
    remove_account,
    connect_youtube_from_code,
    connect_instagram_from_code,
    add_manual_account,
    check_account_health,
)
from accounts.youtube_oauth import get_youtube_auth_url
from accounts.instagram_oauth import get_instagram_auth_url

router = APIRouter(prefix="/accounts", tags=["Accounts"])


def _popup_callback_html(platform: str, success: bool, message: str = "") -> str:
    """HTML page returned on OAuth callback that communicates with the parent window and closes."""
    status_icon = "🎉" if success else "⚠️"
    status_title = f"{platform.capitalize()} Connected!" if success else f"Connection Failed"
    status_color = "#10b981" if success else "#ef4444"

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>{status_title}</title>
  <style>
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      text-align: center;
    }}
    .card {{
      background: #1e293b;
      padding: 32px 40px;
      border-radius: 16px;
      border: 1px solid rgba(255,255,255,0.1);
      box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);
      max-width: 400px;
    }}
    .icon {{ font-size: 48px; margin-bottom: 12px; }}
    h2 {{ margin: 0 0 8px; color: {status_color}; font-size: 20px; }}
    p {{ color: #94a3b8; font-size: 14px; line-height: 1.5; }}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">{status_icon}</div>
    <h2>{status_title}</h2>
    <p>{message or "You can close this window now and return to ClipForge Studio."}</p>
  </div>
  <script>
    try {{
      if (window.opener) {{
        window.opener.postMessage({{
          type: 'account_connected',
          platform: '{platform}',
          success: {'true' if success else 'false'},
          error: '{message}'
        }}, '*');
        setTimeout(() => {{ window.close(); }}, 1500);
      }} else {{
        setTimeout(() => {{ window.location.href = '/'; }}, 2000);
      }}
    }} catch (e) {{
      setTimeout(() => {{ window.location.href = '/'; }}, 2000);
    }}
  </script>
</body>
</html>"""


class ManualAccountPayload(BaseModel):
    platform: str
    alias: str
    access_token: str
    channel_id: Optional[str] = None
    refresh_token: Optional[str] = None
    avatar_url: Optional[str] = None


@router.get("")
def list_accounts():
    """List all connected accounts with safe tokens."""
    return {"accounts": list_accounts_safe()}


@router.delete("/{account_id}")
def delete_single_account(account_id: str):
    """Disconnect and remove an account."""
    success = remove_account(account_id)
    if not success:
        raise HTTPException(status_code=404, detail="Account not found")
    return {"success": True, "message": "Account disconnected"}


@router.get("/{account_id}/status")
def test_account(account_id: str):
    """Test token validity and connection health for an account."""
    return check_account_health(account_id)


# ──────────────────────────────────────────────────────────────────────────────
# YouTube OAuth
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/youtube/connect")
def connect_youtube():
    """Return YouTube Google OAuth authorization URL."""
    try:
        url = get_youtube_auth_url()
        return {"auth_url": url}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/youtube/callback", response_class=HTMLResponse)
def youtube_oauth_callback(
    code: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
):
    """Handle Google OAuth callback redirect."""
    if error:
        return HTMLResponse(
            _popup_callback_html("youtube", False, f"Google OAuth canceled or denied: {error}"),
            status_code=400,
        )
    if not code:
        return HTMLResponse(
            _popup_callback_html("youtube", False, "Missing authorization code"),
            status_code=400,
        )

    try:
        acc = connect_youtube_from_code(code)
        return HTMLResponse(_popup_callback_html("youtube", True, f"Connected channel: {acc.get('alias')}"))
    except Exception as exc:
        return HTMLResponse(_popup_callback_html("youtube", False, str(exc)), status_code=500)


# ──────────────────────────────────────────────────────────────────────────────
# Instagram OAuth
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/instagram/connect")
def connect_instagram():
    """Return Instagram Meta OAuth authorization URL."""
    try:
        url = get_instagram_auth_url()
        return {"auth_url": url}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/instagram/callback", response_class=HTMLResponse)
def instagram_oauth_callback(
    code: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    error_description: Optional[str] = Query(None),
):
    """Handle Meta OAuth callback redirect."""
    if error:
        msg = error_description or error
        return HTMLResponse(
            _popup_callback_html("instagram", False, f"Meta Login denied: {msg}"),
            status_code=400,
        )
    if not code:
        return HTMLResponse(
            _popup_callback_html("instagram", False, "Missing authorization code"),
            status_code=400,
        )

    try:
        accounts = connect_instagram_from_code(code)
        count = len(accounts)
        names = ", ".join([a.get("alias", "") for a in accounts])
        return HTMLResponse(
            _popup_callback_html("instagram", True, f"Connected {count} Instagram account(s): {names}")
        )
    except Exception as exc:
        return HTMLResponse(_popup_callback_html("instagram", False, str(exc)), status_code=500)


# ──────────────────────────────────────────────────────────────────────────────
# Manual Account Connection (For Testing & Direct Token Usage)
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/manual")
def add_manual_account_endpoint(payload: ManualAccountPayload):
    """Directly connect an account using a user-supplied token or developer key."""
    if payload.platform.lower() not in ("youtube", "instagram"):
        raise HTTPException(status_code=400, detail="Platform must be 'youtube' or 'instagram'")

    try:
        acc = add_manual_account(
            platform=payload.platform,
            alias=payload.alias,
            access_token=payload.access_token,
            channel_id=payload.channel_id,
            refresh_token=payload.refresh_token,
            avatar_url=payload.avatar_url,
        )
        return {"success": True, "account": acc}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
