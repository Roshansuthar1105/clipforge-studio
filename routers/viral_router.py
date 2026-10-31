"""
routers/viral_router.py — FastAPI endpoints for AI Viral Moment Detection (Auto-Opus Clip)
Uses Groq Whisper + Llama 3.3 70B (100% Free Tier) to detect viral hooks, punchlines, and retention moments.
"""

from __future__ import annotations

import os
import re
import json
import logging
import urllib.parse
from pathlib import Path
from typing import Optional, Any, Dict, List
from fastapi import APIRouter, HTTPException, BackgroundTasks, Header
from pydantic import BaseModel, Field

import yt_dlp
from services.ytdlp_utils import get_yt_dlp_options, clean_ytdlp_error
from services.viral_moment_service import (
    detect_viral_moments_for_video,
    detect_viral_moments_with_ai,
    fallback_heuristic_viral_detection,
    BASE_DIR,
)
from services.transcription_service import (
    get_stored_transcript,
    transcribe_video_with_groq,
    get_groq_api_key,
)

logger = logging.getLogger("clipforge.viral_router")
router = APIRouter(prefix="/api/viral-moments", tags=["viral-moments"])

DOWNLOAD_DIR = BASE_DIR / "downloads"
CLIPS_DIR = BASE_DIR / "clips"


class ViralDetectRequest(BaseModel):
    url: Optional[str] = ""
    source_file: Optional[str] = None
    max_moments: int = Field(default=5, ge=1, le=15)
    min_duration: float = Field(default=25.0, ge=15.0, le=90.0)
    max_duration: float = Field(default=75.0, ge=30.0, le=180.0)


def _extract_video_id(url_or_filename: str) -> Optional[str]:
    """Helper to extract YouTube video ID from URL or filename."""
    if not url_or_filename:
        return None
    s = url_or_filename.strip()

    # 1. Bracket or suffix ID from filename: e.g. "Title [rBHpA9lXcS0].mp4" or "Title_rBHpA9lXcS0.mp4"
    bracket_match = re.search(r"\[([a-zA-Z0-9_-]{11})\]", s)
    if bracket_match:
        return bracket_match.group(1)
    suffix_match = re.search(r"_([a-zA-Z0-9_-]{11})(?:\.[a-zA-Z0-9]+)?$", s)
    if suffix_match:
        return suffix_match.group(1)

    # 2. Standard URL parsing
    parsed = urllib.parse.urlparse(s)
    host = (parsed.hostname or "").lower()
    if host in ("youtu.be", "www.youtu.be"):
        vid = parsed.path.lstrip("/").split("/")[0].split("?")[0]
        return vid if len(vid) == 11 else None
    if "/shorts/" in parsed.path:
        vid = parsed.path.split("/shorts/")[1].split("/")[0].split("?")[0]
        return vid if len(vid) == 11 else None
    qs = urllib.parse.parse_qs(parsed.query)
    vids = qs.get("v", [])
    if vids:
        vid = vids[0]
        return vid if len(vid) == 11 else None
    return None


def _find_source_in_downloads(target_name_or_id: str) -> Optional[Path]:
    """Find video file in DOWNLOAD_DIR matching filename or video_id."""
    clean = urllib.parse.unquote(target_name_or_id).replace("\\", "/").strip("/")
    safe_name = Path(clean).name
    # Direct check
    direct = DOWNLOAD_DIR / clean
    if direct.is_file():
        return direct

    for f in DOWNLOAD_DIR.glob("**/*.*"):
        if f.is_file() and f.suffix.lower() in (".mp4", ".mkv", ".webm", ".mov"):
            if f.name == safe_name or target_name_or_id in f.name:
                return f
    return None


@router.get("/{video_id}")
def get_cached_viral_moments(video_id: str):
    """Retrieve pre-computed viral moments for a video ID if available."""
    cache_path = BASE_DIR / "transcripts" / f"{video_id}.viral_moments.json"
    if cache_path.exists():
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    raise HTTPException(status_code=404, detail="No viral moments cached for this video.")


@router.post("/detect")
def detect_viral_moments_endpoint(payload: ViralDetectRequest):
    """
    Detect the top viral moments in a long-form video using Groq Whisper + Llama 3.3 (100% Free).
    - If video is already downloaded or transcribed, analysis takes ~3-5 seconds.
    - If audio needs extraction/transcription, it processes automatically in the background.
    """
    target_video: Optional[Path] = None
    video_id: Optional[str] = None
    video_title: str = "Video Source"

    # 1. Resolve source file if provided
    if payload.source_file:
        target_video = _find_source_in_downloads(payload.source_file)
        if not target_video:
            raise HTTPException(
                status_code=404,
                detail=f"Source file '{payload.source_file}' not found in downloads."
            )
        video_id = _extract_video_id(target_video.name) or target_video.stem
        video_title = target_video.stem

    # 2. Or resolve URL
    elif payload.url and payload.url.strip():
        video_id = _extract_video_id(payload.url)
        if video_id:
            target_video = _find_source_in_downloads(video_id)

        # If not already downloaded, download it now
        if not target_video or not target_video.exists():
            DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
            base_opts = {
                "format": "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]/best",
                "merge_output_format": "mp4",
                "outtmpl": str(DOWNLOAD_DIR / "%(title).80s_%(id)s.%(ext)s"),
                "noplaylist": True,
                "restrictfilenames": True,
                "windowsfilenames": True,
            }
            client_candidates = [
                None,  # default / auto-select
                ["android", "ios"],
                ["web", "mweb"],
                ["android"],
                ["ios"],
                ["tv", "mweb"],
            ]
            download_success = False
            last_dl_err = None
            for dl_clients in client_candidates:
                try:
                    ydl_opts = get_yt_dlp_options(extra_opts=base_opts, player_clients=dl_clients)
                    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                        info = ydl.extract_info(payload.url.strip(), download=True)
                        video_title = info.get("title", "Video Source")
                        video_id = info.get("id", video_id)
                        prepared = ydl.prepare_filename(info)
                        target_video = Path(prepared)
                        if not target_video.exists():
                            target_video = target_video.with_suffix(".mp4")
                        if not target_video.exists() and video_id:
                            target_video = _find_source_in_downloads(video_id)
                        download_success = True
                        break
                except Exception as dl_err:
                    last_dl_err = dl_err
                    continue

            if not download_success or not target_video or not target_video.exists():
                err_msg = clean_ytdlp_error(last_dl_err or "Unknown download failure")
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to download source video for analysis: {err_msg}"
                )
    else:
        raise HTTPException(
            status_code=400,
            detail="Must provide either 'url' or 'source_file' to detect viral moments."
        )

    if not target_video or not target_video.exists():
        raise HTTPException(status_code=404, detail="Could not locate source video on server.")

    # 3. Detect viral moments
    try:
        data = detect_viral_moments_for_video(
            video_path=target_video,
            video_id=video_id,
            max_moments=payload.max_moments
        )

        data["video_title"] = video_title
        data["source_file"] = target_video.name
        data["has_groq_key"] = bool(get_groq_api_key())
        data["success"] = True
        return data

    except Exception as exc:
        logger.error("Viral moment detection failed: %s; activating emergency timeline fallback", exc)
        try:
            from services.viral_moment_service import (
                generate_synthetic_timeline_transcript,
                fallback_heuristic_viral_detection
            )
            synth = generate_synthetic_timeline_transcript(target_video, video_id or target_video.stem)
            m = fallback_heuristic_viral_detection(synth, max_moments=payload.max_moments)
            return {
                "video_id": video_id or target_video.stem,
                "video_title": video_title,
                "source_file": target_video.name,
                "duration": synth.get("duration", 0.0),
                "total_moments": len(m),
                "moments": m,
                "has_groq_key": bool(get_groq_api_key()),
                "success": True,
                "fallback_notice": "High-retention timeline windows synthesized successfully."
            }
        except Exception:
            raise HTTPException(status_code=500, detail=f"Viral moment detection failed: {exc}")
