"""
routers/subtitles_router.py — FastAPI endpoints for video transcription,
clip subtitle retrieval, live editing, and FFmpeg video burning.
"""

from __future__ import annotations

import os
import urllib.parse
from pathlib import Path
from typing import Optional, Any, Dict, List
from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import Response, FileResponse
from pydantic import BaseModel, Field

import db
from services.transcription_service import (
    transcribe_video_with_groq,
    get_stored_transcript,
    get_clip_subtitles,
    save_clip_subtitles,
    slice_transcript_for_clip,
    CLIPS_DIR,
    BASE_DIR,
)
from services.subtitle_service import (
    burn_subtitles_to_clip,
    build_srt_content,
    build_ass_content,
)

router = APIRouter(prefix="/api", tags=["subtitles"])
DOWNLOAD_DIR = BASE_DIR / "downloads"


class SubtitleSaveRequest(BaseModel):
    cues: List[Dict[str, Any]] = Field(default_factory=list)
    styles: Dict[str, Any] = Field(default_factory=dict)


class SubtitleBurnRequest(BaseModel):
    cues: List[Dict[str, Any]] = Field(default_factory=list)
    styles: Dict[str, Any] = Field(default_factory=dict)
    replace_original: bool = False


# ------------------------------------------------------------------ #
# Transcripts Endpoints                                              #
# ------------------------------------------------------------------ #

@router.get("/transcripts/{video_id}")
def get_video_transcript(video_id: str):
    """Retrieve stored transcript for a video."""
    data = get_stored_transcript(video_id)
    if not data:
        raise HTTPException(status_code=404, detail="Transcript not found for this video.")
    return data


@router.post("/videos/{video_id}/transcribe")
def transcribe_video_endpoint(video_id: str):
    """
    Transcribe a downloaded source video using Groq Whisper.
    Finds video in data/downloads/ matching the video_id.
    """
    # Find matching file in downloads
    target_video = None
    for f in DOWNLOAD_DIR.glob("**/*.*"):
        if f.suffix.lower() in (".mp4", ".mkv", ".webm", ".mov"):
            if video_id in f.name:
                target_video = f
                break

    if not target_video:
        raise HTTPException(
            status_code=404,
            detail=f"Video file matching '{video_id}' not found in downloads."
        )

    try:
        transcript = transcribe_video_with_groq(target_video, video_id=video_id)
        return {
            "success": True,
            "video_id": video_id,
            "language": transcript.get("language"),
            "segments_count": len(transcript.get("segments", [])),
            "duration": transcript.get("duration"),
            "full_text": transcript.get("full_text"),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}")


# ------------------------------------------------------------------ #
# Clip Subtitle Endpoints                                            #
# ------------------------------------------------------------------ #

@router.get("/clips/{clip_name:path}/subtitles")
def get_subtitles_for_clip(clip_name: str):
    """Get sliced subtitle cues & styles for a specific clip."""
    unquoted = urllib.parse.unquote(clip_name)
    subtitles = get_clip_subtitles(unquoted)
    return subtitles


@router.post("/clips/{clip_name:path}/subtitles/save")
def save_subtitles_for_clip(clip_name: str, payload: SubtitleSaveRequest):
    """Save user-edited subtitle cues and styling for a clip."""
    unquoted = urllib.parse.unquote(clip_name)
    save_clip_subtitles(unquoted, {
        "cues": payload.cues,
        "styles": payload.styles
    })
    return {"success": True, "message": "Subtitles saved successfully."}


@router.post("/clips/{clip_name:path}/subtitles/burn")
def burn_subtitles_for_clip_endpoint(clip_name: str, payload: SubtitleBurnRequest):
    """
    Burn subtitles with custom styles into the video clip.
    Creates a new subtitled file or overwrites original based on replace_original.
    """
    unquoted = urllib.parse.unquote(clip_name)
    input_clip = CLIPS_DIR / unquoted
    if not input_clip.exists():
        # Search recursively
        found = list(CLIPS_DIR.glob(f"**/{unquoted}"))
        if found:
            input_clip = found[0]
        else:
            raise HTTPException(status_code=404, detail=f"Clip '{unquoted}' not found.")

    if not payload.cues:
        raise HTTPException(status_code=400, detail="Cannot burn empty subtitle cues.")

    # Save latest edits
    save_clip_subtitles(unquoted, {
        "cues": payload.cues,
        "styles": payload.styles
    })

    # Output file
    if payload.replace_original:
        output_clip = input_clip.with_name(f"{input_clip.stem}_temp_burn.mp4")
    else:
        # e.g., clip_part1_subtitled.mp4
        clean_stem = input_clip.stem.replace("_subtitled", "")
        output_clip = input_clip.with_name(f"{clean_stem}_subtitled.mp4")

    try:
        burn_subtitles_to_clip(
            input_video=input_clip,
            output_video=output_clip,
            cues=payload.cues,
            style=payload.styles
        )

        if payload.replace_original:
            # Overwrite original
            input_clip.unlink(missing_ok=True)
            output_clip.rename(input_clip)
            final_name = input_clip.name
        else:
            final_name = output_clip.name

        encoded_name = urllib.parse.quote(final_name)
        return {
            "success": True,
            "filename": final_name,
            "url": f"/media/clips/{encoded_name}",
            "message": "Subtitles burned successfully."
        }

    except Exception as exc:
        if output_clip.exists():
            try:
                output_clip.unlink(missing_ok=True)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=f"Failed to burn subtitles: {exc}")


@router.get("/clips/{clip_name:path}/subtitles/download")
def download_subtitles_for_clip(clip_name: str, format: str = "srt"):
    """Download .srt or .ass subtitle file for a clip."""
    unquoted = urllib.parse.unquote(clip_name)
    subtitles = get_clip_subtitles(unquoted)
    cues = subtitles.get("cues", [])
    styles = subtitles.get("styles", {})

    if format.lower() == "ass":
        content = build_ass_content(cues, style=styles)
        media_type = "text/x-ssa"
        ext = "ass"
    else:
        content = build_srt_content(cues, text_transform=styles.get("text_transform", "none"))
        media_type = "text/plain"
        ext = "srt"

    clean_stem = Path(unquoted).stem
    headers = {"Content-Disposition": f'attachment; filename="{clean_stem}.{ext}"'}
    return Response(content=content, media_type=media_type, headers=headers)

