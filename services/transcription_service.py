"""
services/transcription_service.py — Video Transcription & Sliced Subtitle Engine
Using Groq Cloud Whisper API (whisper-large-v3) with persistent storage and zero-cost clip mapping.
"""

from __future__ import annotations

import os
import re
import json
import logging
import subprocess
import urllib.parse
from pathlib import Path
from typing import Optional, Any, Dict, List

import db
from config import get_settings

logger = logging.getLogger("clipforge.transcription")

APP_DIR = Path(__file__).resolve().parent.parent
BASE_DIR = Path(os.getenv("DATA_DIR", str(APP_DIR / "data"))).resolve()
TRANSCRIPTS_DIR = BASE_DIR / "transcripts"
CLIPS_DIR = BASE_DIR / "clips"
TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
CLIPS_DIR.mkdir(parents=True, exist_ok=True)


def get_groq_api_key() -> str:
    """Retrieve Groq API key from settings or environment."""
    key = os.getenv("GROQ_API_KEY", "").strip()
    if not key:
        settings = get_settings()
        key = getattr(settings, "groq_api_key", "").strip()
    return key


def synthesize_word_timestamps(text: str, start: float, end: float) -> List[Dict[str, Any]]:
    """
    Synthesize word-level timestamps proportionally by character length
    when Whisper word timestamps are missing or text was manually edited.
    Guarantees millisecond timestamps for each individual word.
    """
    if not text:
        return []
    clean_text = text.replace("\n", " ").replace("\\N", " ").strip()
    # Strip brackets/asterisks for timing calculation
    clean_words = [w for w in clean_text.split() if w]
    if not clean_words:
        return []

    start = max(0.0, float(start))
    end = max(start + 0.1, float(end))
    duration = end - start

    # Weight proportional to length of word (min 2 chars)
    weights = [max(2, len(re.sub(r'[^A-Za-z0-9]', '', w) or w)) for w in clean_words]
    total_weight = sum(weights) or len(clean_words)

    result: List[Dict[str, Any]] = []
    cur_time = start
    for idx, (w, weight) in enumerate(zip(clean_words, weights)):
        w_dur = max(0.08, duration * (weight / total_weight))
        w_start = round(cur_time, 2)
        if idx == len(clean_words) - 1:
            w_end = round(end, 2)
        else:
            w_end = round(min(end, cur_time + w_dur), 2)
        result.append({
            "word": w,
            "start": w_start,
            "end": max(round(w_start + 0.05, 2), w_end)
        })
        cur_time += w_dur

    return result


def create_voice_synced_word_chunks(
    cues_or_words: List[Dict[str, Any]],
    max_words: int = 3,
    min_words: int = 1
) -> List[Dict[str, Any]]:
    """
    Chunk word-level timestamps into 2-4 word visual bites (CapCut / Alex Hormozi style)
    with precise speech synchronization and natural boundary pauses.
    - max_words: Max words per screen (e.g. 2, 3, 4). Set to <= 0 for full sentence/traditional.
    """
    if not cues_or_words:
        return []

    # If full sentence mode requested (max_words <= 0), preserve cues but ensure words exist
    if max_words <= 0:
        full_cues: List[Dict[str, Any]] = []
        for idx, cue in enumerate(cues_or_words):
            c = dict(cue)
            c["id"] = idx
            if not c.get("words"):
                c["words"] = synthesize_word_timestamps(
                    c.get("text", ""),
                    float(c.get("start", 0.0)),
                    float(c.get("end", 0.0))
                )
            full_cues.append(c)
        return full_cues

    # Extract flat list of word-timestamp objects
    all_words: List[Dict[str, Any]] = []
    if cues_or_words and "word" in cues_or_words[0] and "start" in cues_or_words[0]:
        for w in cues_or_words:
            all_words.append({
                "word": str(w.get("word", "")).strip(),
                "start": round(float(w.get("start", 0.0)), 2),
                "end": round(float(w.get("end", 0.0)), 2),
            })
    else:
        for cue in cues_or_words:
            c_words = cue.get("words")
            c_text = str(cue.get("text", "")).strip()
            c_start = float(cue.get("start", 0.0))
            c_end = float(cue.get("end", 0.0))

            if not c_words or len(c_words) == 0:
                c_words = synthesize_word_timestamps(c_text, c_start, c_end)

            for w in c_words:
                w_str = str(w.get("word", "")).strip()
                if w_str:
                    all_words.append({
                        "word": w_str,
                        "start": round(float(w.get("start", c_start)), 2),
                        "end": round(float(w.get("end", c_end)), 2),
                    })

    all_words = [w for w in all_words if w.get("word")]
    if not all_words:
        return []

    chunks: List[Dict[str, Any]] = []
    current_chunk: List[Dict[str, Any]] = []

    def _finalize_chunk(chunk_words: List[Dict[str, Any]], next_word: Optional[Dict[str, Any]] = None):
        if not chunk_words:
            return
        st = chunk_words[0]["start"]
        en = chunk_words[-1]["end"]

        # Natural boundary extension: if gap to next word is tiny (<0.35s), extend end to next word
        # so there is zero black screen / subtitle flicker between word bites
        if next_word is not None:
            gap = next_word["start"] - en
            if 0.0 <= gap < 0.35:
                en = next_word["start"]

        chunk_text = " ".join(item["word"].strip() for item in chunk_words)
        chunks.append({
            "id": len(chunks),
            "start": round(st, 2),
            "end": round(max(st + 0.1, en), 2),
            "text": chunk_text,
            "words": [dict(w) for w in chunk_words]
        })

    for i, word in enumerate(all_words):
        current_chunk.append(word)
        next_w = all_words[i + 1] if i + 1 < len(all_words) else None

        should_break = False
        if len(current_chunk) >= max_words:
            should_break = True
        elif word["word"].rstrip().endswith((".", "!", "?", "—", ":")):
            should_break = True
        elif next_w is not None and (next_w["start"] - word["end"] >= 0.40):
            # Speaker took a natural breath or pause
            should_break = True

        if should_break:
            _finalize_chunk(current_chunk, next_w)
            current_chunk = []

    if current_chunk:
        _finalize_chunk(current_chunk, None)

    return chunks


def extract_audio_for_transcription(video_path: Path, output_audio: Path) -> Path:
    """
    Extract ultra-compact 32kbps 16kHz mono MP3 from video.
    Keeps a 1-hour video under 14MB, well below Groq's 25MB limit.
    """
    cmd = [
        "ffmpeg", "-y",
        "-hide_banner",
        "-loglevel", "error",
        "-i", str(video_path),
        "-vn",
        "-ar", "16000",
        "-ac", "1",
        "-b:a", "32k",
        str(output_audio)
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
    return output_audio


def transcribe_video_with_groq(video_path: Path, video_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Transcribe a full video using Groq Cloud whisper-large-v3.
    Caches results to disk and MongoDB so the video is never transcribed twice.
    """
    if not video_id:
        video_id = video_path.stem

    # Check if already transcribed
    cached = get_stored_transcript(video_id)
    if cached and cached.get("segments"):
        logger.info("Found cached transcript for video_id: %s", video_id)
        return cached

    api_key = get_groq_api_key()
    if not api_key:
        raise ValueError(
            "GROQ_API_KEY is not set. Please add GROQ_API_KEY to your .env file to enable transcription."
        )

    from groq import Groq
    client = Groq(api_key=api_key)

    temp_audio = TRANSCRIPTS_DIR / f"{video_id}_temp.mp3"
    try:
        logger.info("Extracting audio from %s for transcription...", video_path.name)
        extract_audio_for_transcription(video_path, temp_audio)

        logger.info("Calling Groq Whisper API for %s...", video_path.name)
        with open(temp_audio, "rb") as f:
            transcription = client.audio.transcriptions.create(
                file=(temp_audio.name, f.read()),
                model="whisper-large-v3",
                response_format="verbose_json",
                timestamp_granularities=["segment", "word"],
            )

        # Parse segments and words
        segments_raw = getattr(transcription, "segments", []) or []
        top_words_raw = getattr(transcription, "words", []) or []
        parsed_top_words = []
        for tw in top_words_raw:
            tw_dict = tw if isinstance(tw, dict) else (tw.model_dump() if hasattr(tw, "model_dump") else tw)
            parsed_top_words.append({
                "word": str(tw_dict.get("word", "")).strip(),
                "start": round(float(tw_dict.get("start", 0.0)), 2),
                "end": round(float(tw_dict.get("end", 0.0)), 2),
            })

        parsed_segments: List[Dict[str, Any]] = []
        for idx, seg in enumerate(segments_raw):
            seg_dict = seg if isinstance(seg, dict) else (seg.model_dump() if hasattr(seg, "model_dump") else seg)
            start = round(float(seg_dict.get("start", 0.0)), 2)
            end = round(float(seg_dict.get("end", 0.0)), 2)
            text = str(seg_dict.get("text", "")).strip()

            words_raw = seg_dict.get("words", []) or []
            parsed_words = []
            for w in words_raw:
                w_dict = w if isinstance(w, dict) else (w.model_dump() if hasattr(w, "model_dump") else w)
                parsed_words.append({
                    "word": str(w_dict.get("word", "")).strip(),
                    "start": round(float(w_dict.get("start", 0.0)), 2),
                    "end": round(float(w_dict.get("end", 0.0)), 2),
                })

            # If segment words were not nested, match from top-level words
            if not parsed_words and parsed_top_words:
                matched = [
                    w for w in parsed_top_words
                    if (w["start"] >= start - 0.08 and w["start"] <= end + 0.08)
                ]
                if matched:
                    parsed_words = matched

            # If still missing, synthesize timestamps so word tracking never fails
            if not parsed_words and text:
                parsed_words = synthesize_word_timestamps(text, start, end)

            parsed_segments.append({
                "id": idx,
                "start": start,
                "end": end,
                "text": text,
                "words": parsed_words,
            })

        transcript_data = {
            "video_id": video_id,
            "source_file": video_path.name,
            "language": getattr(transcription, "language", "en"),
            "duration": getattr(transcription, "duration", 0.0),
            "full_text": getattr(transcription, "text", ""),
            "segments": parsed_segments,
        }

        # Save to disk and database
        save_transcript(video_id, transcript_data)
        return transcript_data

    finally:
        if temp_audio.exists():
            try:
                temp_audio.unlink(missing_ok=True)
            except Exception:
                pass


def translate_video_to_english_with_groq(video_path: Path, video_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Translate full video audio directly into English using Groq whisper-large-v3 translations API.
    Guarantees 100% English transcript with ZERO Hindi Devanagari characters.
    """
    if not video_id:
        video_id = video_path.stem

    en_video_id = f"{video_id}_en"
    cached = get_stored_transcript(en_video_id)
    if cached and cached.get("segments"):
        logger.info("Found cached English transcript for video_id: %s", en_video_id)
        return cached

    api_key = get_groq_api_key()
    if not api_key:
        raise ValueError("GROQ_API_KEY is not set.")

    from groq import Groq
    client = Groq(api_key=api_key)

    temp_audio = TRANSCRIPTS_DIR / f"{video_id}_temp_en.mp3"
    try:
        logger.info("Extracting audio from %s for English translation...", video_path.name)
        extract_audio_for_transcription(video_path, temp_audio)

        logger.info("Calling Groq Whisper Translations API for %s...", video_path.name)
        with open(temp_audio, "rb") as f:
            translation = client.audio.translations.create(
                file=(temp_audio.name, f.read()),
                model="whisper-large-v3",
                response_format="verbose_json",
            )

        segments_raw = getattr(translation, "segments", []) or []
        parsed_segments: List[Dict[str, Any]] = []
        for idx, seg in enumerate(segments_raw):
            seg_dict = seg if isinstance(seg, dict) else (seg.model_dump() if hasattr(seg, "model_dump") else seg)
            start = round(float(seg_dict.get("start", 0.0)), 2)
            end = round(float(seg_dict.get("end", 0.0)), 2)
            text = str(seg_dict.get("text", "")).strip()

            parsed_segments.append({
                "id": idx,
                "start": start,
                "end": end,
                "text": text,
                "words": [],
            })

        transcript_data = {
            "video_id": en_video_id,
            "source_file": video_path.name,
            "language": "en",
            "duration": getattr(translation, "duration", 0.0),
            "full_text": getattr(translation, "text", ""),
            "segments": parsed_segments,
        }

        save_transcript(en_video_id, transcript_data)
        return transcript_data

    finally:
        if temp_audio.exists():
            try:
                temp_audio.unlink(missing_ok=True)
            except Exception:
                pass


def translate_clip_to_english_with_groq(clip_path: Path) -> List[Dict[str, Any]]:
    """Translate a single clip's audio directly into pure English cues using Groq Whisper."""
    api_key = get_groq_api_key()
    if not api_key:
        raise ValueError("GROQ_API_KEY is not set.")

    from groq import Groq
    client = Groq(api_key=api_key)

    temp_audio = clip_path.with_name(f"{clip_path.stem}_temp_en.mp3")
    try:
        extract_audio_for_transcription(clip_path, temp_audio)
        with open(temp_audio, "rb") as f:
            translation = client.audio.translations.create(
                file=(temp_audio.name, f.read()),
                model="whisper-large-v3",
                response_format="verbose_json"
            )

        segments_raw = getattr(translation, "segments", []) or []
        parsed_cues = []
        for idx, seg in enumerate(segments_raw):
            seg_dict = seg if isinstance(seg, dict) else (seg.model_dump() if hasattr(seg, "model_dump") else seg)
            start = round(float(seg_dict.get("start", 0.0)), 2)
            end = round(float(seg_dict.get("end", 0.0)), 2)
            text = str(seg_dict.get("text", "")).strip()
            parsed_cues.append({
                "id": idx,
                "start": start,
                "end": end,
                "text": text,
                "words": []
            })
        return parsed_cues

    finally:
        if temp_audio.exists():
            try:
                temp_audio.unlink(missing_ok=True)
            except Exception:
                pass


def has_devanagari_characters(text: str) -> bool:
    """Return True if text contains any Hindi/Devanagari characters (Unicode range U+0900 to U+097F)."""
    if not text:
        return False
    return bool(re.search(r'[\u0900-\u097F]', text))


def convert_text_to_hinglish_batch(texts: List[str], batch_size: int = 20) -> List[str]:
    """
    Transliterate Hindi text written in Devanagari into Hinglish (English Latin alphabet) using Groq.
    Preserves original English words and phrasing without translating meaning to English words.
    Guarantees 0 Devanagari characters in output.
    """
    if not texts:
        return []

    # If no Devanagari characters in any line, return immediately
    if not any(has_devanagari_characters(t) for t in texts):
        return texts

    api_key = get_groq_api_key()
    if not api_key:
        logger.warning("GROQ_API_KEY is not set for Hinglish conversion.")
        return texts

    from groq import Groq
    client = Groq(api_key=api_key)

    system_prompt = (
        "You are a strict Hinglish transliteration engine.\n"
        "Your task is to convert Hindi text written in Devanagari script into Hinglish (Romanized Hindi using the English Latin alphabet).\n\n"
        "RULES:\n"
        "1. Preserve existing English words as-is with their original spelling (e.g. 'started', 'realizing', 'considerate', 'trauma trigger', 'make sure', 'community').\n"
        "2. Convert all Hindi / Devanagari words into everyday standard Hinglish (e.g. 'लड़कियां' -> 'ladkiyan', 'बहुत' -> 'bahut', 'दोस्त' -> 'dost', 'हैं' -> 'hain', 'हो जाए' -> 'ho jaye').\n"
        "3. DO NOT translate the meaning into English. The spoken Hindi words MUST remain Hindi words, just written in English Latin letters.\n"
        "4. Output MUST contain ZERO Devanagari characters (only standard English A-Z, numbers, and basic punctuation).\n"
        "5. Return ONLY a valid JSON array of strings, with exactly one output string corresponding to each input string in the exact same order."
    )

    results: List[str] = []
    for i in range(0, len(texts), batch_size):
        chunk = texts[i:i + batch_size]
        # If this entire chunk has no Devanagari, pass it through directly
        if not any(has_devanagari_characters(t) for t in chunk):
            results.extend(chunk)
            continue

        try:
            user_msg = "Convert this JSON array of subtitle lines to Hinglish:\n" + json.dumps(chunk, ensure_ascii=False)
            res = client.chat.completions.create(
                model="qwen/qwen3.8-27b",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg}
                ],
                temperature=0.0,
                max_tokens=1500
            )

            raw = res.choices[0].message.content.strip()
            if raw.startswith("```"):
                raw = re.sub(r'^```(?:json)?\s*', '', raw)
                raw = re.sub(r'\s*```$', '', raw)

            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                for val in parsed.values():
                    if isinstance(val, list):
                        parsed = val
                        break

            if isinstance(parsed, list) and len(parsed) == len(chunk):
                results.extend([str(item).strip() for item in parsed])
            else:
                logger.warning("Hinglish transliteration count mismatch (expected %d, got %s)", len(chunk), len(parsed) if isinstance(parsed, list) else "not-list")
                results.extend([str(x) for x in parsed[:len(chunk)]] if isinstance(parsed, list) else chunk)
        except Exception as exc:
            logger.error("Hinglish transliteration failed for chunk %d: %s", i, exc)
            results.extend(chunk)

    return results


def convert_cues_to_hinglish(cues: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Convert cues list with Hindi Devanagari text into Hinglish (English alphabet)."""
    if not cues:
        return []

    texts = [c.get("text", "") for c in cues]
    hinglish_texts = convert_text_to_hinglish_batch(texts)

    converted_cues = []
    for cue, hing_text in zip(cues, hinglish_texts):
        c_copy = dict(cue)
        c_copy["text"] = hing_text
        converted_cues.append(c_copy)
    return converted_cues


def convert_transcript_to_hinglish(transcript: Dict[str, Any], video_id: Optional[str] = None) -> Dict[str, Any]:
    """Convert an entire transcript to Hinglish and cache on disk."""
    segments = transcript.get("segments", [])
    if not segments:
        return transcript

    texts = [s.get("text", "") for s in segments]
    hing_texts = convert_text_to_hinglish_batch(texts)

    new_segments = []
    for s, h_text in zip(segments, hing_texts):
        s_copy = dict(s)
        s_copy["text"] = h_text
        new_segments.append(s_copy)

    new_transcript = dict(transcript)
    new_transcript["segments"] = new_segments
    new_transcript["language"] = "hinglish"
    new_transcript["full_text"] = " ".join([t for t in hing_texts if t])

    vid = video_id or transcript.get("video_id")
    if vid:
        save_transcript(f"{vid}_hinglish", new_transcript)

    return new_transcript


def save_transcript(video_id: str, data: Dict[str, Any]) -> None:
    """Save transcript data to JSON file on disk and MongoDB."""
    json_path = TRANSCRIPTS_DIR / f"{video_id}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    try:
        db.db_save_transcript(video_id, data)
    except Exception as exc:
        logger.warning("Failed saving transcript to DB (%s); disk cached.", exc)


def get_stored_transcript(video_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve transcript from disk or DB."""
    json_path = TRANSCRIPTS_DIR / f"{video_id}.json"
    if json_path.exists():
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as exc:
            logger.warning("Could not read transcript file %s: %s", json_path, exc)

    # Check for embedded YouTube ID e.g. [rBHpA9lXcS0] or _rBHpA9lXcS0
    yt_match = re.search(r"\[([a-zA-Z0-9_-]{11})\]", str(video_id)) or re.search(r"_([a-zA-Z0-9_-]{11})$", str(video_id))
    if yt_match:
        alt_path = TRANSCRIPTS_DIR / f"{yt_match.group(1)}.json"
        if alt_path.exists():
            try:
                with open(alt_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass

    try:
        db_doc = db.db_get_transcript(video_id)
        if db_doc:
            return db_doc
        if yt_match:
            alt_doc = db.db_get_transcript(yt_match.group(1))
            if alt_doc:
                return alt_doc
    except Exception:
        pass

    return None


def slice_transcript_for_clip(
    transcript: Dict[str, Any],
    clip_start: float,
    clip_end: float
) -> List[Dict[str, Any]]:
    """
    Slice the parent transcript to match a specific clip's start & end time.
    Re-zeros timestamps relative to 00:00 of the clip.
    """
    raw_segments = transcript.get("segments", [])
    clip_duration = round(clip_end - clip_start, 2)
    sliced_cues: List[Dict[str, Any]] = []

    for seg in raw_segments:
        s_start = float(seg["start"])
        s_end = float(seg["end"])

        # Check if segment overlaps with the clip range
        if s_end > clip_start and s_start < clip_end:
            rel_start = max(0.0, round(s_start - clip_start, 2))
            rel_end = min(clip_duration, round(s_end - clip_start, 2))

            # Filter and re-zero word timestamps
            rel_words = []
            for w in seg.get("words", []):
                w_start = float(w["start"])
                w_end = float(w["end"])
                if w_end > clip_start and w_start < clip_end:
                    rel_words.append({
                        "word": w["word"],
                        "start": max(0.0, round(w_start - clip_start, 2)),
                        "end": min(clip_duration, round(w_end - clip_start, 2)),
                    })

            if not rel_words and seg.get("text"):
                rel_words = synthesize_word_timestamps(seg["text"], rel_start, rel_end)

            sliced_cues.append({
                "id": len(sliced_cues),
                "start": rel_start,
                "end": rel_end,
                "text": seg["text"],
                "words": rel_words,
            })

    return sliced_cues


def _find_clip_path(clip_name: str) -> Optional[Path]:
    """Helper to locate a clip file anywhere under CLIPS_DIR."""
    unquoted = urllib.parse.unquote(clip_name).replace("\\", "/").strip("/")
    direct = CLIPS_DIR / unquoted
    if direct.is_file():
        return direct
    safe_name = Path(unquoted).name
    for p in CLIPS_DIR.rglob("*"):
        if p.is_file() and (p.name == safe_name or p.name == clip_name):
            return p
    return None


def get_clip_subtitles(clip_name: str) -> Dict[str, Any]:
    """
    Get subtitle cues for a specific clip:
    1. First checks if custom edited cues were already saved for this clip.
    2. Otherwise checks clip metadata for source_video_id, clip_start, clip_end,
       and slices from parent transcript.
    """
    clip_file = _find_clip_path(clip_name)
    custom_path = None
    if clip_file:
        custom_path = clip_file.with_name(f"{clip_file.name}.subtitles.json")
        if not custom_path.exists():
            custom_path = clip_file.with_name(f"{clip_file.stem}.subtitles.json")
    if not custom_path or not custom_path.exists():
        custom_path = CLIPS_DIR / f"{Path(clip_name).name}.subtitles.json"
    if not custom_path.exists():
        custom_path = CLIPS_DIR / f"{Path(clip_name).stem}.subtitles.json"
    if not custom_path.exists():
        safe_name = Path(clip_name).name
        safe_stem = Path(clip_name).stem
        for p in CLIPS_DIR.rglob("*.subtitles.json"):
            if p.name in (f"{safe_name}.subtitles.json", f"{safe_stem}.subtitles.json"):
                custom_path = p
                break

    if custom_path and custom_path.exists():
        try:
            with open(custom_path, "r", encoding="utf-8") as f:
                saved = json.load(f)
                cues = saved.get("cues", [])
                for c in cues:
                    if not c.get("words") and c.get("text"):
                        c["words"] = synthesize_word_timestamps(
                            c["text"], float(c.get("start", 0)), float(c.get("end", 0))
                        )
                styles = saved.get("styles", {})
                if "highlight_mode" not in styles:
                    styles["highlight_mode"] = "active_word"
                if "words_per_screen" not in styles:
                    styles["words_per_screen"] = 3
                saved["cues"] = cues
                saved["styles"] = styles
                return saved
        except Exception:
            pass

    # Look up metadata
    meta = None
    meta_path = None
    if clip_file:
        meta_path = clip_file.with_name(f"{clip_file.name}.meta.json")
        if not meta_path.exists():
            meta_path = clip_file.with_name(f"{clip_file.stem}.meta.json")
    if not meta_path or not meta_path.exists():
        meta_path = CLIPS_DIR / f"{Path(clip_name).name}.meta.json"
    if not meta_path.exists():
        meta_path = CLIPS_DIR / f"{Path(clip_name).stem}.meta.json"
    if not meta_path.exists():
        safe_name = Path(clip_name).name
        safe_stem = Path(clip_name).stem
        for p in CLIPS_DIR.rglob("*.meta.json"):
            if p.name in (f"{safe_name}.meta.json", f"{safe_stem}.meta.json"):
                meta_path = p
                break

    if meta_path and meta_path.exists():
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
        except Exception:
            pass

    if not meta:
        meta = db.db_get_clip_metadata(Path(clip_name).name)

    if not meta:
        return {"cues": [], "styles": {}, "source_video_id": None}

    DOWNLOAD_DIR = BASE_DIR / "downloads"
    source_video_id = meta.get("source_video_id") if meta else None
    clip_start = float(meta.get("clip_start", 0.0)) if meta else 0.0
    clip_end = float(meta.get("clip_end", 0.0)) if meta else 0.0

    transcript = get_stored_transcript(source_video_id) if source_video_id else None

    # If transcript is missing, try auto-transcribing parent video from downloads
    if not transcript and source_video_id and DOWNLOAD_DIR.exists():
        found_source = None
        for f in DOWNLOAD_DIR.glob("**/*.*"):
            if f.suffix.lower() in (".mp4", ".mkv", ".webm", ".mov"):
                if source_video_id in f.name:
                    found_source = f
                    break
        if found_source and get_groq_api_key():
            try:
                logger.info("Auto-transcribing source video %s for clip %s", found_source.name, clip_name)
                transcript = transcribe_video_with_groq(found_source, video_id=source_video_id)
            except Exception as exc:
                logger.warning("Auto-transcribe of source video failed: %s", exc)

    # If still no transcript, transcribe the clip directly as standalone fallback
    if not clip_file or not clip_file.exists():
        clip_file = _find_clip_path(clip_name)

    if not transcript and clip_file and clip_file.exists() and get_groq_api_key():
        try:
            logger.info("Transcribing clip %s directly...", clip_name)
            clip_transcript = transcribe_video_with_groq(clip_file, video_id=clip_file.stem)
            raw_cues = clip_transcript.get("segments", [])
            cues = create_voice_synced_word_chunks(raw_cues, max_words=3)
            styles = (meta or {}).get("styles", {})
            styles.setdefault("highlight_mode", "active_word")
            styles.setdefault("words_per_screen", 3)
            return {
                "cues": cues,
                "styles": styles,
                "source_video_id": clip_file.stem,
                "clip_start": 0.0,
                "clip_end": round(float(clip_transcript.get("duration", 0.0)), 2),
            }
        except Exception as exc:
            logger.warning("Direct clip transcription failed: %s", exc)

    if not transcript:
        styles = (meta or {}).get("styles", {})
        styles.setdefault("highlight_mode", "active_word")
        styles.setdefault("words_per_screen", 3)
        return {
            "cues": [],
            "styles": styles,
            "source_video_id": source_video_id,
            "has_groq_key": bool(get_groq_api_key())
        }

    raw_cues = slice_transcript_for_clip(transcript, clip_start, clip_end)
    cues = create_voice_synced_word_chunks(raw_cues, max_words=3)
    styles = (meta or {}).get("styles", {})
    styles.setdefault("highlight_mode", "active_word")
    styles.setdefault("words_per_screen", 3)

    return {
        "cues": cues,
        "styles": styles,
        "source_video_id": source_video_id,
        "clip_start": clip_start,
        "clip_end": clip_end,
        "has_groq_key": bool(get_groq_api_key())
    }


def save_clip_subtitles(clip_name: str, data: Dict[str, Any]) -> None:
    """Save user-edited subtitle cues & style settings for a clip."""
    clip_file = _find_clip_path(clip_name)
    if clip_file:
        custom_path = clip_file.with_name(f"{clip_file.name}.subtitles.json")
    else:
        custom_path = CLIPS_DIR / f"{Path(clip_name).name}.subtitles.json"
    custom_path.parent.mkdir(parents=True, exist_ok=True)
    with open(custom_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
