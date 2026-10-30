"""
routers/subtitles_router.py — FastAPI endpoints for video transcription,
clip subtitle retrieval, live editing, single clip burning, and group batch mounting.
"""

from __future__ import annotations

import os
import re
import time
import json
import uuid
import shutil
import logging
import datetime
import threading
import subprocess
import urllib.parse
from pathlib import Path
from typing import Optional, Any, Dict, List
from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import Response, FileResponse
from pydantic import BaseModel, Field

import db
from services.transcription_service import (
    transcribe_video_with_groq,
    translate_video_to_english_with_groq,
    translate_clip_to_english_with_groq,
    convert_cues_to_hinglish,
    convert_transcript_to_hinglish,
    has_devanagari_characters,
    get_stored_transcript,
    get_clip_subtitles,
    save_clip_subtitles,
    slice_transcript_for_clip,
    create_voice_synced_word_chunks,
    _find_clip_path,
    get_groq_api_key,
    CLIPS_DIR,
    BASE_DIR,
)
from services.subtitle_service import (
    burn_subtitles_to_clip,
    build_srt_content,
    build_ass_content,
)

logger = logging.getLogger("clipforge.subtitles_router")
router = APIRouter(prefix="/api", tags=["subtitles"])
DOWNLOAD_DIR = BASE_DIR / "downloads"
SUBTITLE_JOBS_FILE = BASE_DIR / "subtitle_jobs.json"

_subtitle_jobs: Dict[str, Dict[str, Any]] = {}
_sub_lock = threading.Lock()


def _save_subtitle_job(job_doc: Dict[str, Any]) -> None:
    """Save subtitle job in-memory and persist to disk."""
    job_id = job_doc.get("job_id")
    if not job_id:
        return
    with _sub_lock:
        _subtitle_jobs[job_id] = job_doc
        try:
            from storage import read_json, write_json
            all_jobs = read_json(SUBTITLE_JOBS_FILE, {})
            all_jobs[job_id] = job_doc
            write_json(SUBTITLE_JOBS_FILE, all_jobs)
        except Exception:
            pass


def _get_subtitle_job(job_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve subtitle job from in-memory cache or disk."""
    with _sub_lock:
        if job_id in _subtitle_jobs:
            return _subtitle_jobs[job_id]
    try:
        from storage import read_json
        all_jobs = read_json(SUBTITLE_JOBS_FILE, {})
        job = all_jobs.get(job_id)
        if job:
            with _sub_lock:
                _subtitle_jobs[job_id] = job
            return job
    except Exception:
        pass
    return None


# ------------------------------------------------------------------ #
# Helper Utilities                                                   #
# ------------------------------------------------------------------ #

def apply_text_transform(text: str, transform: str) -> str:
    """Apply styling transform to subtitle text (uppercase, title, none)."""
    if not text:
        return ""
    if transform == "uppercase":
        return text.upper()
    elif transform == "title":
        return re.sub(r"[A-Za-z]+('[A-Za-z]+)?", lambda mo: mo.group(0).capitalize(), text)
    return text


def clean_caption_text(raw: str) -> str:
    """Strip bracket/asterisk highlight markers from caption text for social post descriptions."""
    if not raw:
        return ""
    cleaned = re.sub(r"\[([^\]]+)\]", r"\1", raw)
    cleaned = re.sub(r"\*([^\*]+)\*", r"\1", cleaned)
    return cleaned.strip()


def safe_replace_file(src: Path, dst: Path, max_attempts: int = 6) -> None:
    """Safely replace dst with src on Windows, handling filesystem locks and retries."""
    src_p = Path(src).resolve()
    dst_p = Path(dst).resolve()

    if not src_p.exists():
        raise FileNotFoundError(f"Source file {src_p} does not exist for replacement")

    last_err = None
    for attempt in range(max_attempts):
        try:
            os.replace(str(src_p), str(dst_p))
            return
        except (PermissionError, OSError) as exc:
            last_err = exc
            try:
                if dst_p.exists():
                    dst_p.unlink(missing_ok=True)
                shutil.move(str(src_p), str(dst_p))
                return
            except Exception as e:
                last_err = e
            time.sleep(0.35)

    if last_err:
        raise last_err


def cleanup_subtitled_duplicates(clip_path: Path) -> None:
    """Clean up any leftover '_subtitled.mp4' duplicate if original was replaced."""
    try:
        clean_stem = clip_path.stem.replace("_subtitled", "")
        dup_file = clip_path.with_name(f"{clean_stem}_subtitled.mp4")
        if dup_file.exists() and dup_file.resolve() != clip_path.resolve():
            dup_file.unlink(missing_ok=True)
        dup_thumb = clip_path.with_name(f"{clean_stem}_subtitled.thumb.jpg")
        if dup_thumb.exists():
            dup_thumb.unlink(missing_ok=True)
    except Exception as exc:
        logger.debug("Duplicate cleanup non-critical error: %s", exc)


def refresh_clip_thumbnail(clip_path: Path) -> None:
    """Regenerate 9:16 thumbnail with newly burned subtitles."""
    try:
        thumb = clip_path.with_name(f"{clip_path.stem}.thumb.jpg")
        if thumb.exists():
            thumb.unlink(missing_ok=True)
        cmd = [
            "ffmpeg", "-y", "-ss", "00:00:01", "-i", str(clip_path),
            "-vframes", "1",
            "-vf", "scale=180:320:force_original_aspect_ratio=decrease,pad=180:320:(ow-iw)/2:(oh-ih)/2:black",
            "-q:v", "3", str(thumb)
        ]
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=12)
        if not thumb.exists() or thumb.stat().st_size == 0:
            cmd_fallback = [
                "ffmpeg", "-y", "-ss", "00:00:00", "-i", str(clip_path),
                "-vframes", "1",
                "-vf", "scale=180:320:force_original_aspect_ratio=decrease,pad=180:320:(ow-iw)/2:(oh-ih)/2:black",
                "-q:v", "3", str(thumb)
            ]
            subprocess.run(cmd_fallback, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=12)
    except Exception as exc:
        logger.warning("Could not refresh thumbnail for %s: %s", clip_path.name, exc)


def update_clip_metadata_caption(clip_path: Path, full_caption: str, styles: Optional[Dict[str, Any]] = None) -> None:
    """Update clip metadata JSON with full caption/description for publish and previews."""
    try:
        meta_path = clip_path.with_name(f"{clip_path.name}.meta.json")
        if not meta_path.exists():
            meta_path = clip_path.with_name(f"{clip_path.stem}.meta.json")

        meta = {}
        if meta_path.exists():
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
            except Exception:
                meta = {}

        clean_cap = clean_caption_text(full_caption)
        meta["caption"] = clean_cap
        meta["description"] = clean_cap
        meta["has_subtitles"] = True
        if styles:
            meta["styles"] = styles

        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)

        if db.is_db_connected():
            try:
                db.db_save_clip_metadata(clip_path.name, meta)
            except Exception:
                pass
    except Exception as exc:
        logger.warning("Could not update clip metadata caption for %s: %s", clip_path.name, exc)


# ------------------------------------------------------------------ #
# Request Schemas                                                    #
# ------------------------------------------------------------------ #

class SubtitleSaveRequest(BaseModel):
    cues: Optional[List[Dict[str, Any]]] = Field(default_factory=list)
    styles: Optional[Dict[str, Any]] = Field(default_factory=dict)


class SubtitleAutoSyncRequest(BaseModel):
    max_words: int = Field(default=3, description="Words per screen: 2, 3, 4, or 0 (full sentence)")
    highlight_mode: str = Field(default="active_word", description="active_word, static, or disabled")
    words_per_screen: Optional[int] = 3
    mode: Optional[str] = None  # hinglish, english, or None
    force_retranscribe: Optional[bool] = False


class SubtitleBurnRequest(BaseModel):
    cues: Optional[List[Dict[str, Any]]] = Field(default_factory=list)
    styles: Optional[Dict[str, Any]] = Field(default_factory=dict)
    replace_original: bool = True


class GroupSubtitleBurnRequest(BaseModel):
    styles: Optional[Dict[str, Any]] = Field(default_factory=dict)
    replace_original: bool = True
    english_only: bool = False
    hinglish: bool = True


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
    styles = payload.styles or {}
    styles.setdefault("highlight_mode", "active_word")
    styles.setdefault("words_per_screen", 3)
    text_transform = styles.get("text_transform", "none")

    # Automatically convert any Hindi Devanagari text to Hinglish by default
    if payload.cues and any(has_devanagari_characters(c.get("text", "")) for c in payload.cues):
        logger.info("Devanagari detected in save request for %s; auto-converting to Hinglish", unquoted)
        payload.cues = convert_cues_to_hinglish(payload.cues)

    # Apply preview text transform so saved cues reflect what user configured
    if payload.cues and text_transform != "none":
        for cue in payload.cues:
            raw_text = cue.get("text", "")
            if raw_text:
                cue["text"] = apply_text_transform(raw_text, text_transform)

    save_clip_subtitles(unquoted, {
        "cues": payload.cues or [],
        "styles": styles
    })

    # Also update clip metadata caption
    input_clip = _find_clip_path(unquoted)
    if input_clip:
        full_caption = " ".join([c.get("text", "").strip() for c in payload.cues if c.get("text", "").strip()])
        update_clip_metadata_caption(input_clip, full_caption, styles)

    return {"success": True, "message": "Subtitles saved successfully."}


@router.post("/clips/{clip_name:path}/subtitles/auto-sync")
def auto_sync_clip_subtitles_endpoint(clip_name: str, payload: SubtitleAutoSyncRequest):
    """
    Generate or re-chunk voice-synced word timings on demand.
    Slices words into 2-4 word visual bites (CapCut / Alex Hormozi style)
    with millisecond accuracy for active spoken word tracking.
    """
    unquoted = urllib.parse.unquote(clip_name).replace("\\", "/").strip("/")
    input_clip = CLIPS_DIR / unquoted
    if not input_clip.exists() or not input_clip.is_file():
        found = _find_clip_path(unquoted)
        if found and found.is_file():
            input_clip = found
        else:
            raise HTTPException(status_code=404, detail=f"Clip '{unquoted}' not found.")

    max_w = payload.max_words if payload.max_words is not None else (payload.words_per_screen or 3)
    hl_mode = payload.highlight_mode or "active_word"

    # 1. Fetch current clip subtitles or parent transcript
    sub_data = get_clip_subtitles(unquoted)
    cues = sub_data.get("cues") or []
    styles = sub_data.get("styles") or {}

    # If force_retranscribe or if no cues exist, transcribe directly with Groq Whisper for 100% voice sync
    force_retranscribe = bool(getattr(payload, "force_retranscribe", False))
    if (force_retranscribe or not cues) and input_clip.exists() and get_groq_api_key():
        try:
            logger.info("Transcribing clip %s directly for precision voice sync...", input_clip.name)
            clip_transcript = transcribe_video_with_groq(input_clip, video_id=input_clip.stem)
            raw_cues = clip_transcript.get("segments", [])
            if raw_cues:
                cues = raw_cues
                if any(has_devanagari_characters(c.get("text", "")) for c in cues) or str(clip_transcript.get("language", "")).lower() in ("hi", "hindi", "urdu"):
                    cues = convert_cues_to_hinglish(cues)
        except Exception as exc:
            logger.warning("Voice sync direct transcribe failed: %s", exc)

    if not cues:
        raise HTTPException(
            status_code=400,
            detail="No speech cues found to auto-sync. Transcribe the video first or add cues in One-by-One tab."
        )

    # 2. Transliterate to Hinglish if requested and Devanagari detected
    if payload.mode == "hinglish" and any(has_devanagari_characters(c.get("text", "")) for c in cues):
        try:
            cues = convert_cues_to_hinglish(cues)
        except Exception as exc:
            logger.warning("Hinglish conversion in auto-sync failed: %s", exc)

    # 3. Chunk into voice-synced 2-4 word bites
    chunked_cues = create_voice_synced_word_chunks(cues, max_words=max_w)

    # 4. Update styles
    styles["highlight_mode"] = hl_mode
    styles["words_per_screen"] = max_w
    text_transform = styles.get("text_transform", "uppercase")
    if text_transform != "none":
        for cue in chunked_cues:
            if cue.get("text"):
                cue["text"] = apply_text_transform(cue["text"], text_transform)

    # 5. Persist to disk and update metadata caption
    save_clip_subtitles(unquoted, {
        "cues": chunked_cues,
        "styles": styles
    })

    full_caption = " ".join([c.get("text", "").strip() for c in chunked_cues if c.get("text", "").strip()])
    update_clip_metadata_caption(input_clip, full_caption, styles)

    mode_label = f"{max_w}-word bite" if max_w > 0 else "full sentence"
    return {
        "success": True,
        "cues": chunked_cues,
        "styles": styles,
        "caption": full_caption,
        "max_words": max_w,
        "highlight_mode": hl_mode,
        "message": f"Successfully chunked speech into {len(chunked_cues)} voice-synced {mode_label}s."
    }


@router.post("/clips/{clip_name:path}/subtitles/translate")
def translate_clip_subtitles_endpoint(clip_name: str, mode: str = "hinglish"):
    """
    Convert or translate clip speech into 100% English alphabet transcript.
    - mode="hinglish" (default): Spoken Hindi words written in English Latin alphabet (Romanized Hindi).
      Zero Devanagari characters. Retains the authentic spoken reel words & phrases.
    - mode="english": Translates meaning into pure English words using Groq Whisper.
    """
    unquoted = urllib.parse.unquote(clip_name).replace("\\", "/").strip("/")
    input_clip = CLIPS_DIR / unquoted
    if not input_clip.exists() or not input_clip.is_file():
        found = _find_clip_path(unquoted)
        if found and found.is_file():
            input_clip = found
        else:
            raise HTTPException(status_code=404, detail=f"Clip '{unquoted}' not found.")

    if not get_groq_api_key():
        raise HTTPException(status_code=400, detail="GROQ_API_KEY is not configured in .env.")

    meta_path = input_clip.with_name(f"{input_clip.name}.meta.json")
    if not meta_path.exists():
        meta_path = input_clip.with_name(f"{input_clip.stem}.meta.json")

    meta = {}
    if meta_path.exists():
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
        except Exception:
            pass

    source_video_id = meta.get("source_video_id")
    clip_start = float(meta.get("clip_start", 0.0))
    clip_end = float(meta.get("clip_end", 0.0))

    cues = []

    if mode == "hinglish":
        # Check if parent transcript exists
        if source_video_id and clip_end > clip_start:
            hinglish_trans = get_stored_transcript(f"{source_video_id}_hinglish")
            if hinglish_trans:
                cues = slice_transcript_for_clip(hinglish_trans, clip_start, clip_end)
            else:
                orig_trans = get_stored_transcript(source_video_id)
                if orig_trans:
                    cues = slice_transcript_for_clip(orig_trans, clip_start, clip_end)

        # If not obtained from parent transcript, load existing subtitles or transcribe clip
        if not cues:
            existing = get_clip_subtitles(unquoted)
            cues = existing.get("cues") or []

        if not cues and get_groq_api_key():
            try:
                clip_transcript = transcribe_video_with_groq(input_clip, video_id=input_clip.stem)
                cues = clip_transcript.get("segments", [])
            except Exception as exc:
                logger.warning("Direct clip transcription failed: %s", exc)

        if not cues:
            raise HTTPException(status_code=400, detail="No speech cues found to convert to Hinglish.")

        # Convert cues to Hinglish (English Latin alphabet) if any Devanagari detected
        if any(has_devanagari_characters(c.get("text", "")) for c in cues):
            try:
                cues = convert_cues_to_hinglish(cues)
            except Exception as exc:
                raise HTTPException(status_code=500, detail=f"Failed to convert speech to Hinglish: {exc}")

    else:
        # mode == "english" (Pure English translation)
        if source_video_id and clip_end > clip_start:
            found_source = None
            for f in DOWNLOAD_DIR.glob("**/*.*"):
                if f.suffix.lower() in (".mp4", ".mkv", ".webm", ".mov"):
                    if source_video_id in f.name:
                        found_source = f
                        break
            if found_source:
                try:
                    en_transcript = translate_video_to_english_with_groq(found_source, video_id=source_video_id)
                    cues = slice_transcript_for_clip(en_transcript, clip_start, clip_end)
                except Exception as exc:
                    logger.warning("Parent video translation failed, falling back to direct clip translation: %s", exc)

        if not cues:
            try:
                cues = translate_clip_to_english_with_groq(input_clip)
            except Exception as exc:
                raise HTTPException(status_code=500, detail=f"Failed to translate clip to English: {exc}")

    # Load existing styles
    existing = get_clip_subtitles(unquoted)
    styles = existing.get("styles") or meta.get("styles") or {}
    text_transform = styles.get("text_transform", "uppercase")

    # Apply transform
    for cue in cues:
        if cue.get("text"):
            cue["text"] = apply_text_transform(cue["text"], text_transform)

    # Save to .subtitles.json
    save_clip_subtitles(unquoted, {"cues": cues, "styles": styles})

    # Save to .meta.json
    full_caption = " ".join([c.get("text", "").strip() for c in cues if c.get("text", "").strip()])
    update_clip_metadata_caption(input_clip, full_caption, styles)

    mode_label = "Hinglish (English Latin alphabet)" if mode == "hinglish" else "English translation"
    return {
        "success": True,
        "cues": cues,
        "styles": styles,
        "caption": full_caption,
        "mode": mode,
        "message": f"Successfully converted speech to {mode_label} ({len(cues)} cues). Zero Devanagari script."
    }


@router.post("/clips/{clip_name:path}/subtitles/hinglish")
def hinglish_clip_subtitles_endpoint(clip_name: str):
    """
    Dedicated endpoint to convert clip speech into Hinglish (Hindi written in English alphabets).
    Guarantees zero Hindi Devanagari characters in subtitles.
    """
    return translate_clip_subtitles_endpoint(clip_name, mode="hinglish")


@router.post("/clips/{clip_name:path}/subtitles/burn")
def burn_subtitles_for_clip_endpoint(clip_name: str, payload: SubtitleBurnRequest):
    """
    Burn subtitles with custom styles into the video clip.
    Saves the text as shown in preview for the captions section,
    and replaces the existing clip with the current configurations.
    """
    unquoted = urllib.parse.unquote(clip_name).replace("\\", "/").strip("/")
    input_clip = CLIPS_DIR / unquoted
    if not input_clip.exists() or not input_clip.is_file():
        found = _find_clip_path(unquoted)
        if found and found.is_file():
            input_clip = found
        else:
            raise HTTPException(status_code=404, detail=f"Clip '{unquoted}' not found.")

    if not payload.cues:
        raise HTTPException(status_code=400, detail="Cannot burn empty subtitle cues.")

    styles = payload.styles or {}
    styles.setdefault("highlight_mode", "active_word")
    styles.setdefault("words_per_screen", 3)
    text_transform = styles.get("text_transform", "none")

    # Automatically convert any Hindi Devanagari cues to Hinglish before burning
    if any(has_devanagari_characters(c.get("text", "")) for c in payload.cues):
        logger.info("Devanagari detected in burn request for %s; auto-converting to Hinglish", unquoted)
        payload.cues = convert_cues_to_hinglish(payload.cues)

    # 1. Apply preview text transform to all cues so the saved captions match the preview
    for cue in payload.cues:
        raw_text = cue.get("text", "")
        if raw_text:
            cue["text"] = apply_text_transform(raw_text, text_transform)

    # 2. Save latest edits with transformed cue text
    save_clip_subtitles(unquoted, {
        "cues": payload.cues or [],
        "styles": styles
    })

    # 3. Save full caption to clip metadata for captions section & publishing
    full_caption = " ".join([c.get("text", "").strip() for c in payload.cues if c.get("text", "").strip()])
    update_clip_metadata_caption(input_clip, full_caption, styles)

    # Output file
    if payload.replace_original:
        output_clip = input_clip.with_name(f"{input_clip.stem}_temp_burn.mp4")
    else:
        clean_stem = input_clip.stem.replace("_subtitled", "")
        output_clip = input_clip.with_name(f"{clean_stem}_subtitled.mp4")

    try:
        burn_subtitles_to_clip(
            input_video=input_clip,
            output_video=output_clip,
            cues=payload.cues or [],
            style=styles
        )

        if payload.replace_original:
            # Safely replace original clip with burned video on Windows
            safe_replace_file(output_clip, input_clip)
            cleanup_subtitled_duplicates(input_clip)
            refresh_clip_thumbnail(input_clip)
            final_name = input_clip.name
        else:
            refresh_clip_thumbnail(output_clip)
            final_name = output_clip.name

        encoded_name = urllib.parse.quote(final_name)
        return {
            "success": True,
            "filename": final_name,
            "url": f"/media/clips/{encoded_name}",
            "caption": full_caption,
            "message": "Subtitles burned and clip saved with current configurations."
        }

    except Exception as exc:
        if output_clip.exists():
            try:
                output_clip.unlink(missing_ok=True)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=f"Failed to burn subtitles: {exc}")


# ------------------------------------------------------------------ #
# Group Subtitle Mounting Endpoints                                  #
# ------------------------------------------------------------------ #

def _process_group_subtitle_job(
    job_id: str,
    target_folder: Path,
    clips: List[Path],
    styles: Dict[str, Any],
    replace_original: bool,
    english_only: bool = False,
    hinglish: bool = True
) -> None:
    """Background worker to mount subtitles to each clip in the group and save reels."""
    total = len(clips)
    processed = 0
    results = []
    text_transform = styles.get("text_transform", "uppercase")

    # If english_only is requested, ensure parent video English transcript is pre-generated once
    if english_only and clips:
        first_clip = clips[0]
        meta_p = first_clip.with_name(f"{first_clip.name}.meta.json")
        if not meta_p.exists():
            meta_p = first_clip.with_name(f"{first_clip.stem}.meta.json")
        meta_first = {}
        if meta_p.exists():
            try:
                with open(meta_p, "r", encoding="utf-8") as fm:
                    meta_first = json.load(fm)
            except Exception:
                pass
        src_id = meta_first.get("source_video_id")
        if src_id and not get_stored_transcript(f"{src_id}_en") and DOWNLOAD_DIR.exists():
            for f in DOWNLOAD_DIR.glob("**/*.*"):
                if f.suffix.lower() in (".mp4", ".mkv", ".webm", ".mov") and src_id in f.name:
                    try:
                        logger.info("Pre-translating parent video %s to English for group...", f.name)
                        translate_video_to_english_with_groq(f, video_id=src_id)
                    except Exception as exc:
                        logger.warning("Could not pre-translate parent video: %s", exc)
                    break

    for idx, clip_file in enumerate(clips):
        rel_clip_path = str(clip_file.relative_to(CLIPS_DIR)).replace("\\", "/")
        current_job = _get_subtitle_job(job_id)
        if current_job:
            current_job["current_clip"] = clip_file.name
            current_job["progress"] = int((idx / total) * 100)
            current_job["message"] = f"Mounting subtitles to reel {idx + 1} of {total}: {clip_file.name}..."
            _save_subtitle_job(current_job)

        try:
            # 1. Retrieve or slice subtitles (English only or Hinglish if requested)
            cues = []
            sub_data = get_clip_subtitles(rel_clip_path)

            meta_p = clip_file.with_name(f"{clip_file.name}.meta.json")
            if not meta_p.exists():
                meta_p = clip_file.with_name(f"{clip_file.stem}.meta.json")
            meta_item = {}
            if meta_p.exists():
                try:
                    with open(meta_p, "r", encoding="utf-8") as fm:
                        meta_item = json.load(fm)
                except Exception:
                    pass
            src_id = meta_item.get("source_video_id")
            c_start = float(meta_item.get("clip_start", 0.0))
            c_end = float(meta_item.get("clip_end", 0.0))

            if english_only:
                en_trans = get_stored_transcript(f"{src_id}_en") if src_id else None
                if en_trans and c_end > c_start:
                    cues = slice_transcript_for_clip(en_trans, c_start, c_end)
                if not cues:
                    try:
                        cues = translate_clip_to_english_with_groq(clip_file)
                    except Exception as t_err:
                        logger.warning("English translation failed for %s: %s", clip_file.name, t_err)

            elif hinglish:
                h_trans = get_stored_transcript(f"{src_id}_hinglish") if src_id else None
                if h_trans and c_end > c_start:
                    cues = slice_transcript_for_clip(h_trans, c_start, c_end)
                elif src_id and c_end > c_start:
                    orig_t = get_stored_transcript(src_id)
                    if orig_t:
                        cues = slice_transcript_for_clip(orig_t, c_start, c_end)

            if not cues:
                cues = sub_data.get("cues", [])

            # Fallback to direct clip transcription if needed
            if not cues and get_groq_api_key():
                try:
                    logger.info("Auto-transcribing clip %s for group mount...", clip_file.name)
                    direct_t = transcribe_video_with_groq(clip_file, clip_file.stem)
                    cues = direct_t.get("segments", [])
                except Exception as t_err:
                    logger.warning("Could not auto-transcribe %s: %s", clip_file.name, t_err)

            if not cues:
                logger.warning("No subtitle cues found for %s; skipping.", clip_file.name)
                results.append({"clip": clip_file.name, "status": "skipped", "reason": "No speech cues found"})
                continue

            # Guarantee zero Devanagari characters: auto-convert Hindi speech to Hinglish by default
            if not english_only and (hinglish or any(has_devanagari_characters(c.get("text", "")) for c in cues)):
                try:
                    cues = convert_cues_to_hinglish(cues)
                except Exception as h_err:
                    logger.warning("Hinglish cue conversion failed for %s: %s", clip_file.name, h_err)

            # 2. Merge styles and apply preview text transform
            merged_styles = {**(sub_data.get("styles") or {}), **styles}
            merged_hl = merged_styles.get("highlight_mode", "active_word")
            if merged_hl in ("active_word", "voice_synced"):
                max_w = int(merged_styles.get("words_per_screen", 3))
                cues = create_voice_synced_word_chunks(cues, max_words=max_w)

            for cue in cues:
                raw_text = cue.get("text", "")
                if raw_text:
                    cue["text"] = apply_text_transform(raw_text, text_transform)

            # 3. Save subtitle cues
            save_clip_subtitles(rel_clip_path, {"cues": cues, "styles": merged_styles})

            # 4. Save metadata caption/description
            full_caption = " ".join([c.get("text", "").strip() for c in cues if c.get("text", "").strip()])
            update_clip_metadata_caption(clip_file, full_caption, merged_styles)

            # 5. Burn subtitles to video
            temp_output = clip_file.with_name(f"{clip_file.stem}_temp_burn.mp4")
            burn_subtitles_to_clip(
                input_video=clip_file,
                output_video=temp_output,
                cues=cues,
                style=merged_styles
            )

            # 6. Replace original file or keep subtitled file
            if replace_original:
                safe_replace_file(temp_output, clip_file)
                cleanup_subtitled_duplicates(clip_file)
                refresh_clip_thumbnail(clip_file)
            else:
                refresh_clip_thumbnail(temp_output)

            processed += 1
            results.append({"clip": clip_file.name, "status": "success"})

        except Exception as exc:
            logger.error("Error mounting subtitles to %s: %s", clip_file.name, exc)
            results.append({"clip": clip_file.name, "status": "error", "error": str(exc)})

        current_job = _get_subtitle_job(job_id)
        if current_job:
            current_job["processed_clips"] = processed
            current_job["progress"] = int(((idx + 1) / total) * 100)
            current_job["results"] = results
            _save_subtitle_job(current_job)

    current_job = _get_subtitle_job(job_id)
    if current_job:
        current_job["status"] = "completed"
        current_job["progress"] = 100
        current_job["message"] = (
            f"Successfully mounted subtitles to {processed} of {total} reels in '{target_folder.name}'!"
        )
        _save_subtitle_job(current_job)


@router.post("/groups/{folder_path:path}/subtitles/burn")
def burn_subtitles_for_group_endpoint(folder_path: str, payload: GroupSubtitleBurnRequest):
    """
    Mount subtitles to each clip in a group/folder with the current configurations,
    and save those reels (replacing the existing clips).
    Runs as a tracked background job.
    """
    unquoted = urllib.parse.unquote(folder_path).replace("\\", "/").strip("/")
    target_folder = CLIPS_DIR / unquoted
    if not target_folder.exists() or not target_folder.is_dir():
        # Search by folder name
        safe_name = Path(unquoted).name
        for p in CLIPS_DIR.rglob("*"):
            if p.is_dir() and (p.name == safe_name or str(p.relative_to(CLIPS_DIR)).replace("\\", "/") == unquoted):
                target_folder = p
                break

    if not target_folder.exists() or not target_folder.is_dir():
        raise HTTPException(status_code=404, detail=f"Group folder '{unquoted}' not found.")

    # Find all clips in folder
    all_files = [
        f for f in target_folder.glob("*.mp4")
        if not f.name.endswith("_temp_burn.mp4")
        and not (f.name.endswith("_subtitled.mp4") and f.with_name(f"{f.stem.replace('_subtitled', '')}.mp4").exists())
    ]

    def _sort_key(p: Path):
        m = re.search(r"part_(\d+)", p.stem, re.IGNORECASE)
        return int(m.group(1)) if m else p.name

    clips = sorted(all_files, key=_sort_key)
    if not clips:
        raise HTTPException(status_code=400, detail=f"No video clips found in '{target_folder.name}'.")

    job_id = uuid.uuid4().hex
    job_doc = {
        "job_id": job_id,
        "folder_path": unquoted,
        "folder_name": target_folder.name,
        "status": "processing",
        "progress": 0,
        "total_clips": len(clips),
        "processed_clips": 0,
        "current_clip": clips[0].name,
        "message": f"Starting subtitles mount for {len(clips)} reels in '{target_folder.name}'...",
        "results": [],
        "error": None,
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    _save_subtitle_job(job_doc)

    # Launch background thread
    t = threading.Thread(
        target=_process_group_subtitle_job,
        args=(job_id, target_folder, clips, payload.styles or {}, payload.replace_original, payload.english_only, payload.hinglish),
        daemon=True
    )
    t.start()

    return {
        "success": True,
        "job_id": job_id,
        "folder_name": target_folder.name,
        "total_clips": len(clips),
        "message": f"Started mounting subtitles to {len(clips)} clips in '{target_folder.name}'."
    }


@router.get("/subtitle-jobs/{job_id}")
def get_subtitle_job_status(job_id: str):
    """Get live progress status of a group subtitle burning job."""
    job = _get_subtitle_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Subtitle job not found.")
    return job


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
