"""
services/ytdlp_utils.py — Unified yt-dlp downloader configuration and cookie management.
Handles YouTube bot check bypasses, deployment environment variables, and Netscape cookie files.
"""

from __future__ import annotations

import os
import re
import base64
import shutil
import logging
from pathlib import Path
from typing import Optional, Dict, Any, List

logger = logging.getLogger("clipforge.ytdlp")

APP_DIR = Path(__file__).resolve().parent.parent
BASE_DIR = Path(os.getenv("DATA_DIR", str(APP_DIR / "data"))).resolve()
DEFAULT_COOKIES_FILE = BASE_DIR / "cookies.txt"


def init_cookies_from_env() -> Optional[Path]:
    """
    Check if YouTube cookies are passed via environment variables
    (essential for cloud deployments like Render, Railway, Docker, Fly.io, Heroku)
    and write them to a persistent cookies.txt file.

    Supported env vars:
    - YOUTUBE_COOKIES
    - COOKIES_CONTENT
    - COOKIES_TEXT
    - YTDLP_COOKIES_TEXT
    - COOKIES_BASE64
    """
    try:
        raw_cookies = (
            os.getenv("YOUTUBE_COOKIES")
            or os.getenv("COOKIES_CONTENT")
            or os.getenv("COOKIES_TEXT")
            or os.getenv("YTDLP_COOKIES_TEXT")
            or ""
        ).strip()

        b64_cookies = os.getenv("COOKIES_BASE64", "").strip()
        if not raw_cookies and b64_cookies:
            try:
                raw_cookies = base64.b64decode(b64_cookies).decode("utf-8", errors="ignore").strip()
            except Exception as e:
                logger.warning("Failed to decode COOKIES_BASE64: %s", e)

        if raw_cookies:
            # Handle quoted multiline strings or JSON-escaped newlines (\n)
            cleaned = raw_cookies.strip('"\'').replace("\\n", "\n")
            DEFAULT_COOKIES_FILE.parent.mkdir(parents=True, exist_ok=True)
            DEFAULT_COOKIES_FILE.write_text(cleaned, encoding="utf-8")
            logger.info("Successfully initialized YouTube cookies from environment variable to %s", DEFAULT_COOKIES_FILE)
            return DEFAULT_COOKIES_FILE
    except Exception as exc:
        logger.warning("Error initializing cookies from environment: %s", exc)

    return None


def find_cookies_file() -> Optional[Path]:
    """
    Discover cookies.txt file across common cloud deployment and local locations.
    """
    # 1. First check if cookies can be synthesized from env var
    env_file = init_cookies_from_env()
    if env_file and env_file.is_file() and env_file.stat().st_size > 0:
        return env_file

    # 2. Check candidate paths
    candidates = [
        os.getenv("COOKIES_FILE"),
        os.getenv("YTDLP_COOKIES"),
        os.getenv("YOUTUBE_COOKIES_FILE"),
        DEFAULT_COOKIES_FILE,
        BASE_DIR / "cookies.txt",
        APP_DIR / "cookies.txt",
        Path("cookies.txt"),
        Path("/etc/secrets/cookies.txt"),   # Render Secret Files mount path
        Path("/app/cookies.txt"),           # Docker root
        Path.home() / "cookies.txt",        # User home
    ]

    for cand in candidates:
        if not cand:
            continue
        try:
            cand_p = Path(cand).resolve()
            if cand_p.exists() and cand_p.is_file() and cand_p.stat().st_size > 10:
                return cand_p
        except Exception:
            continue

    return None


def get_cookies_status() -> Dict[str, Any]:
    """
    Return comprehensive diagnostics on the current YouTube cookie configuration.
    """
    cookie_path = find_cookies_file()
    browser_env = os.getenv("COOKIES_FROM_BROWSER", "").strip()

    if not cookie_path and not browser_env:
        return {
            "configured": False,
            "source": "none",
            "path": None,
            "has_youtube_auth": False,
            "cookie_count": 0,
            "message": "No cookies configured. Bot check may trigger on cloud deployment servers."
        }

    if browser_env:
        return {
            "configured": True,
            "source": f"browser ({browser_env})",
            "path": None,
            "has_youtube_auth": True,
            "cookie_count": -1,
            "message": f"Using cookies from local browser '{browser_env}'"
        }

    try:
        content = cookie_path.read_text(encoding="utf-8", errors="ignore")
        lines = [l.strip() for l in content.splitlines() if l.strip() and not l.startswith("#")]
        has_yt = any("youtube.com" in l for l in lines)
        has_auth = any(k in content for k in ("LOGIN_INFO", "SID", "SSID", "HSID", "__Secure-3PSID"))

        return {
            "configured": True,
            "source": "file",
            "path": str(cookie_path),
            "has_youtube_auth": has_auth,
            "cookie_count": len(lines),
            "message": "Valid YouTube authenticated cookies loaded" if has_auth else "Cookies file loaded (auth tokens not detected)"
        }
    except Exception as exc:
        return {
            "configured": False,
            "source": "error",
            "path": str(cookie_path) if cookie_path else None,
            "has_youtube_auth": False,
            "cookie_count": 0,
            "message": f"Error reading cookies file: {exc}"
        }


def save_cookies_text(text: str) -> Path:
    """Save user-provided raw Netscape cookies text directly to disk."""
    cleaned = text.strip().strip('"\'').replace("\\n", "\n")
    DEFAULT_COOKIES_FILE.parent.mkdir(parents=True, exist_ok=True)
    DEFAULT_COOKIES_FILE.write_text(cleaned, encoding="utf-8")
    logger.info("Saved %d bytes of cookies to %s", len(cleaned), DEFAULT_COOKIES_FILE)
    return DEFAULT_COOKIES_FILE


def get_yt_dlp_options(
    extra_opts: Optional[dict] = None,
    player_clients: Optional[list[str]] = None,
) -> dict:
    """
    Build robust yt-dlp options configured to bypass YouTube bot detection
    in both local and cloud deployment environments.
    """
    cookies_path = find_cookies_file()
    browser_env = os.getenv("COOKIES_FROM_BROWSER", "").strip()

    # When cookies are available, web and mweb clients authenticate seamlessly with web session cookies.
    # When cookies are not available, mobile app API clients (android/ios) have higher success on local IPs.
    if player_clients:
        clients = player_clients
    elif cookies_path or browser_env:
        clients = ["web", "mweb", "android", "ios"]
    else:
        clients = ["android", "ios", "mweb"]

    opts: dict = {
        "quiet": True,
        "no_warnings": True,
        "extractor_args": {
            "youtube": {
                "player_client": clients
            }
        },
        "http_headers": {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/125.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9",
        },
    }

    # Pass cookies file or browser
    if cookies_path:
        opts["cookiefile"] = str(cookies_path)
    elif browser_env:
        opts["cookiesfrombrowser"] = (browser_env, None, None, None)

    # PO Token (Proof of Origin) if provided
    po_token = os.getenv("YOUTUBE_PO_TOKEN", "").strip()
    if po_token:
        opts["extractor_args"]["youtube"]["po_token"] = [po_token]

    # Enable Node.js as JavaScript runtime if installed (critical for deciphering modern YouTube signatures)
    node_path = shutil.which("node")
    if node_path:
        opts["js_runtimes"] = {"node": {}}

    if extra_opts:
        opts.update(extra_opts)

    return opts


def clean_ytdlp_error(err: Exception | str) -> str:
    """Format yt-dlp error message with clear, actionable deployment instructions."""
    raw = str(err)
    clean = re.sub(r"\x1b\[[0-9;]*m", "", raw)
    clean = clean.replace("ERROR: ", "").strip()

    if "bot" in clean.lower() or "sign in" in clean.lower():
        clean = (
            f"{clean}\n\n"
            "[YouTube Bot Check Triggered in Deployment]\n"
            "Cloud hosts (Render, Railway, AWS, Docker) have datacenter IPs that require authentication.\n"
            "To fix this, provide YouTube cookies using ANY of the following methods:\n"
            "1. Set the 'YOUTUBE_COOKIES' or 'COOKIES_CONTENT' environment variable in your deployment dashboard with your exported Netscape cookies.\n"
            "2. Place a 'cookies.txt' file in the ClipForge folder or mount it at /etc/secrets/cookies.txt (Render Secret Files).\n"
            "3. Set COOKIES_FILE=/path/to/cookies.txt in your .env file.\n"
            "Tip: Export cookies in 1 click using the 'Get cookies.txt LOCALLY' Chrome/Firefox extension while signed into YouTube."
        )

    return clean

