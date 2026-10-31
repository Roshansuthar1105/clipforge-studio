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


def _safe_float(val: Any, default: float = 0.0) -> float:
    """Safely convert any value to float without throwing TypeError or ValueError."""
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def synthesize_word_timestamps(text: str, start: Any, end: Any) -> List[Dict[str, Any]]:
    """
    Synthesize word-level timestamps proportionally by character length
    when Whisper word timestamps are missing or text was manually edited.
    Guarantees millisecond timestamps for each individual word.
    """
    if not text:
        return []
    clean_text = str(text).replace("\n", " ").replace("\\N", " ").strip()
    # Strip brackets/asterisks for timing calculation
    clean_words = [w for w in clean_text.split() if w]
    if not clean_words:
        return []

    start_f = _safe_float(start, 0.0)
    end_f = _safe_float(end, start_f + 1.0)
    if end_f <= start_f:
        end_f = start_f + 1.0
    duration = end_f - start_f

    # Weight proportional to length of word (min 2 chars)
    weights = [max(2, len(re.sub(r'[^A-Za-z0-9]', '', w) or w)) for w in clean_words]
    total_weight = sum(weights) or len(clean_words)

    result: List[Dict[str, Any]] = []
    cur_time = start_f
    for idx, (w, weight) in enumerate(zip(clean_words, weights)):
        w_dur = max(0.08, duration * (weight / total_weight))
        w_start = round(cur_time, 2)
        if idx == len(clean_words) - 1:
            w_end = round(end_f, 2)
        else:
            w_end = round(min(end_f, cur_time + w_dur), 2)
        result.append({
            "word": w,
            "start": w_start,
            "end": max(round(w_start + 0.05, 2), w_end)
        })
        cur_time += w_dur

    return result


HALLUCINATION_PATTERNS = [
    r"\b(?:do[\s,]+)+not\s+translate\b",
    r"\bdo\s+not\s+translate\b",
    r"\btranslate\s+hindi\b",
    r"\bhindi\s+into\s+english\b",
    r"\bhindi\s+and\s+hinglish\b",
    r"\btranscribe\s+hindi\b",
    r"\btranscribe\s+in\s+hindi\b",
]


def clean_hallucinated_text(text: str) -> str:
    """
    Remove Whisper prompt hallucination / leakage phrases from text.
    Returns cleaned text, or empty string if text consisted entirely of hallucinations.
    """
    if not text:
        return ""
    t = str(text)
    t = re.sub(r"(?i)\b(?:do[\s,]+)+not\s+translate(?:\s+hindi)?(?:\s+(?:into|in)\s+english|\s+and\s+hinglish)?\.?", "", t)
    t = re.sub(r"(?i)\bdo\s+not\s+translate(?:\s+hindi)?(?:\s+(?:into|in)\s+english|\s+and\s+hinglish)?\.?", "", t)
    t = re.sub(r"(?i)\btranslate\s+hindi(?:\s+(?:into|in)\s+english|\s+and\s+hinglish)?\.?", "", t)
    t = re.sub(r"(?i)\bhindi\s+and\s+hinglish\.?", "", t)
    t = re.sub(r"(?i)\bhindi\s+into\s+english\.?", "", t)
    t = re.sub(r"(?i)\btranscribe\s+hindi(?:\s+speech)?(?:\s+as\s+spoken)?\.?", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def is_hallucinated_prompt_segment(text: str) -> bool:
    """
    Check if a transcript segment or subtitle cue contains Whisper prompt hallucination / system prompt leakage.
    E.g., 'DO NOT TRANSLATE', 'HINDI AND HINGLISH', 'Do Do Do not translate...'.
    """
    if not text:
        return False
    clean = re.sub(r"[^\w\s]", "", str(text)).strip().lower()
    clean = re.sub(r"\s+", " ", clean)
    if not clean:
        return False

    for p in HALLUCINATION_PATTERNS:
        if re.search(p, clean):
            return True

    # If cleaning removes everything or leaves only punctuation
    cleaned_t = clean_hallucinated_text(text)
    if not cleaned_t:
        return True

    return False


def sanitize_word_list(words: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Remove hallucinated word sequences (e.g. ['Do', 'not', 'translate', 'Hindi', 'into', 'English'])
    from a list of word timestamp dictionaries.
    """
    if not words:
        return []

    blacklisted_phrases = [
        ["do", "not", "translate"],
        ["do", "do", "not", "translate"],
        ["do", "do", "do", "not", "translate"],
        ["not", "translate", "hindi"],
        ["translate", "hindi", "into", "english"],
        ["translate", "hindi", "and", "hinglish"],
        ["translate", "hindi"],
        ["hindi", "into", "english"],
        ["hindi", "and", "hinglish"],
        ["transcribe", "hindi"],
        ["transcribe", "in", "hindi"],
    ]

    n = len(words)
    skip_indices = set()
    for phrase in blacklisted_phrases:
        p_len = len(phrase)
        for start_idx in range(n - p_len + 1):
            window = [re.sub(r"[^\w]", "", str(words[start_idx + k].get("word", "")).lower()) for k in range(p_len)]
            if window == phrase:
                for k in range(p_len):
                    skip_indices.add(start_idx + k)

    return [w for idx, w in enumerate(words) if idx not in skip_indices]


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

    # Strip and clean any hallucinated prompt segments before chunking
    cleaned_incoming: List[Dict[str, Any]] = []
    for c in cues_or_words:
        raw_t = str(c.get("text") or c.get("word") or "").strip()
        cl_t = clean_hallucinated_text(raw_t)
        if cl_t and not is_hallucinated_prompt_segment(raw_t):
            c_copy = dict(c)
            if "text" in c_copy:
                c_copy["text"] = cl_t
            if "words" in c_copy and isinstance(c_copy["words"], list):
                c_copy["words"] = sanitize_word_list(c_copy["words"])
            cleaned_incoming.append(c_copy)
    cues_or_words = cleaned_incoming
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
            c["words"] = sanitize_word_list(c.get("words", []))
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

    # Sanitize hallucinated word sequences from word stream
    all_words = sanitize_word_list(all_words)
    all_words = [
        w for w in all_words
        if w.get("word") and not is_hallucinated_prompt_segment(w.get("word", ""))
    ]
    if not all_words:
        return []

    chunks: List[Dict[str, Any]] = []
    current_chunk: List[Dict[str, Any]] = []

    def _finalize_chunk(chunk_words: List[Dict[str, Any]], next_word: Optional[Dict[str, Any]] = None):
        if not chunk_words:
            return
        chunk_text = " ".join(item["word"].strip() for item in chunk_words).strip()
        if is_hallucinated_prompt_segment(chunk_text) or not clean_hallucinated_text(chunk_text):
            return

        st = chunk_words[0]["start"]
        en = chunk_words[-1]["end"]

        # Natural boundary extension: if gap to next word is tiny (<0.35s), extend end to next word
        # so there is zero black screen / subtitle flicker between word bites
        if next_word is not None:
            gap = next_word["start"] - en
            if 0.0 <= gap < 0.35:
                en = next_word["start"]

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
    Extract ultra-compact 24kbps-32kbps 16kHz mono MP3 from video.
    Keeps a 1-hour video under 11MB, well below Groq's 25MB limit.
    """
    cmd = [
        "ffmpeg", "-y",
        "-hide_banner",
        "-loglevel", "error",
        "-i", str(video_path),
        "-vn",
        "-ar", "16000",
        "-ac", "1",
        "-b:a", "24k",
        str(output_audio)
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
    if output_audio.exists() and output_audio.stat().st_size > 23 * 1024 * 1024:
        # Re-compress at 16k mono for extra-long videos (e.g. 2-3 hours)
        cmd_small = [
            "ffmpeg", "-y",
            "-hide_banner",
            "-loglevel", "error",
            "-i", str(video_path),
            "-vn",
            "-ar", "16000",
            "-ac", "1",
            "-b:a", "16k",
            str(output_audio)
        ]
        subprocess.run(cmd_small, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
    return output_audio


def transcribe_video_with_groq(
    video_path: Path,
    video_id: Optional[str] = None,
    force_retranscribe: bool = False,
    language: Optional[str] = "hi"
) -> Dict[str, Any]:
    """
    Transcribe a full video using Groq Cloud whisper-large-v3-turbo / whisper-large-v3.
    Defaults to language='hi' for accurate Hindi speech transcription without English translation.
    Caches results to disk and MongoDB so the video is never transcribed twice.
    """
    if not video_id:
        video_id = video_path.stem

    # Check if already transcribed (unless force_retranscribe is requested)
    if not force_retranscribe:
        cached = get_stored_transcript(video_id)
        if cached and cached.get("segments"):
            # If cached transcript contains hallucinated prompts, invalidate and re-transcribe
            has_hallucination = any(is_hallucinated_prompt_segment(s.get("text", "")) for s in cached.get("segments", []))
            if not has_hallucination:
                logger.info("Found cached transcript for video_id: %s", video_id)
                return cached
            else:
                logger.info("Cached transcript for %s has prompt hallucinations; re-transcribing...", video_id)

    api_key = get_groq_api_key()
    if not api_key:
        raise ValueError(
            "GROQ_API_KEY is not set. Please add GROQ_API_KEY to your .env file to enable transcription."
        )

    from groq import Groq
    # Give a generous 300s timeout with retries to prevent connection timeouts on long videos
    client = Groq(api_key=api_key, timeout=300.0, max_retries=3)

    temp_audio = TRANSCRIPTS_DIR / f"{video_id}_temp.mp3"
    try:
        logger.info("Extracting audio from %s for transcription...", video_path.name)
        extract_audio_for_transcription(video_path, temp_audio)

        audio_bytes = temp_audio.read_bytes()
        transcription = None
        whisper_models = ["whisper-large-v3-turbo", "whisper-large-v3"]
        last_whisper_err = None
        for wm in whisper_models:
            try:
                logger.info("Calling Groq Whisper (%s, lang=%s) for %s...", wm, language, video_path.name)
                trans_kwargs = {
                    "file": (temp_audio.name, audio_bytes),
                    "model": wm,
                    "response_format": "verbose_json",
                    "timestamp_granularities": ["segment", "word"],
                }
                if language and language.lower() != "auto":
                    trans_kwargs["language"] = language

                transcription = client.audio.transcriptions.create(**trans_kwargs)
                if transcription:
                    logger.info("Groq transcription succeeded via %s for %s", wm, video_path.name)
                    break
            except Exception as w_err:
                logger.warning("Groq Whisper model %s failed for %s: %s", wm, video_path.name, w_err)
                last_whisper_err = w_err

        if not transcription:
            raise last_whisper_err or RuntimeError(f"Groq Whisper transcription failed for {video_path.name}")

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
        parsed_top_words = sanitize_word_list(parsed_top_words)

        parsed_segments: List[Dict[str, Any]] = []
        for seg in segments_raw:
            seg_dict = seg if isinstance(seg, dict) else (seg.model_dump() if hasattr(seg, "model_dump") else seg)
            raw_text = str(seg_dict.get("text", "")).strip()
            clean_t = clean_hallucinated_text(raw_text)
            if is_hallucinated_prompt_segment(raw_text) or not clean_t:
                continue

            start = round(float(seg_dict.get("start", 0.0)), 2)
            end = round(float(seg_dict.get("end", 0.0)), 2)

            words_raw = seg_dict.get("words", []) or []
            parsed_words = []
            for w in words_raw:
                w_dict = w if isinstance(w, dict) else (w.model_dump() if hasattr(w, "model_dump") else w)
                parsed_words.append({
                    "word": str(w_dict.get("word", "")).strip(),
                    "start": round(float(w_dict.get("start", 0.0)), 2),
                    "end": round(float(w_dict.get("end", 0.0)), 2),
                })
            parsed_words = sanitize_word_list(parsed_words)

            # If segment words were not nested, match from top-level words
            if not parsed_words and parsed_top_words:
                matched = [
                    w for w in parsed_top_words
                    if (w["start"] >= start - 0.08 and w["start"] <= end + 0.08)
                ]
                if matched:
                    parsed_words = sanitize_word_list(matched)

            # If still missing, synthesize timestamps so word tracking never fails
            if not parsed_words and clean_t:
                parsed_words = synthesize_word_timestamps(clean_t, start, end)

            parsed_segments.append({
                "id": len(parsed_segments),
                "start": start,
                "end": end,
                "text": clean_t,
                "words": parsed_words,
            })

        for idx, s in enumerate(parsed_segments):
            s["id"] = idx

        raw_lang = getattr(transcription, "language", "en")
        detected_lang = str(raw_lang).lower() if raw_lang else "en"
        has_devanagari = any(has_devanagari_characters(s.get("text", "")) for s in parsed_segments)
        is_indic = (detected_lang in ("hi", "hindi", "urdu", "pa", "punjabi", "mr", "marathi", "gu", "gujarati", "bn", "bengali", "ne", "nepali", "sa", "sanskrit") or has_devanagari)

        raw_full = getattr(transcription, "text", "")
        clean_full = clean_hallucinated_text(raw_full)

        transcript_data = {
            "video_id": video_id,
            "source_file": video_path.name,
            "language": "hi" if is_indic else detected_lang,
            "duration": getattr(transcription, "duration", 0.0),
            "full_text": clean_full,
            "segments": parsed_segments,
        }

        # ALWAYS save base transcript immediately to disk and DB first
        # This guarantees transcripts are never lost if subsequent transliteration or translation steps fail/timeout
        save_transcript(video_id, transcript_data)
        save_transcript(f"{video_id}_raw", transcript_data)

        # 1. Hindi / Indic audio -> convert to Hinglish using 1-to-1 word-preserving transliteration
        if is_indic:
            logger.info("Detected Hindi / Indic audio in video %s (%d segments); converting to 1:1 Hinglish", video_id, len(parsed_segments))
            try:
                hinglish_data = convert_transcript_to_hinglish(transcript_data, video_id=video_id)
                if hinglish_data and hinglish_data.get("segments"):
                    return hinglish_data
            except Exception as h_err:
                logger.warning("Auto-conversion to Hinglish failed for %s: %s; retaining base transcript", video_id, h_err)
            return transcript_data

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
    client = Groq(api_key=api_key, timeout=45.0, max_retries=1)

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
    client = Groq(api_key=api_key, timeout=45.0, max_retries=1)

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
    return bool(re.search(r'[\u0900-\u097F]', str(text)))


# ------------------------------------------------------------------ #
# 1-to-1 Word-Preserving Hinglish Transliteration Engine              #
# Guarantees authentic [a-z] Romanized Hindi, 0 Devanagari script,    #
# and preserves 100% exact Whisper millisecond word audio timestamps. #
# ------------------------------------------------------------------ #

HINGLISH_WORD_CACHE_FILE = BASE_DIR / "hinglish_word_cache.json"

DEFAULT_COMMON_HINGLISH_WORDS: Dict[str, str] = {
    "है": "hai", "हैं": "hain", "था": "tha", "थी": "thi", "थे": "the",
    "तो": "to", "नहीं": "nahi", "ना": "na", "हाँ": "haan", "हां": "haan",
    "मैं": "main", "तू": "tu", "तुम": "tum", "तुम्हें": "tumhein",
    "तुम्हारी": "tumhari", "तुम्हारा": "tumhara", "तुमने": "tumne",
    "आप": "aap", "आपका": "aapka", "आपकी": "aapki", "आपने": "aapne",
    "हम": "hum", "हमारा": "humara", "हमारी": "humari", "हमने": "humne",
    "ये": "ye", "यह": "yeh", "वो": "woh", "वह": "woh",
    "क्या": "kya", "क्यों": "kyun", "कैसे": "kaise", "कब": "kab",
    "कहाँ": "kahan", "कहां": "kahan", "कौन": "kaun", "किस": "kis",
    "किसे": "kise", "किसका": "kiska", "अगर": "agar", "मगर": "magar",
    "लेकिन": "lekin", "पर": "par", "और": "aur", "भी": "bhi", "या": "ya",
    "जैसे": "jaise", "वैसे": "waise", "बहुत": "bahut", "ज्यादा": "zyada",
    "कम": "kam", "थोड़ा": "thoda", "थोड़ी": "thodi", "कुछ": "kuch",
    "सब": "sab", "सारे": "saare", "कोई": "koi", "हर": "har",
    "एक": "ek", "दो": "do", "तीन": "teen", "चार": "chaar",
    "पाँच": "paanch", "पांच": "paanch", "छह": "chhah", "सात": "saat",
    "आठ": "aath", "नौ": "nau", "दस": "dus",
    "भाई": "bhai", "यार": "yaar", "दोस्त": "dost", "बेटा": "beta",
    "पापा": "papa", "मम्मी": "mummy", "लड़का": "ladka", "लड़की": "ladki",
    "लड़के": "ladke", "लड़कियां": "ladkiyan", "लोग": "log",
    "बात": "baat", "बातें": "baatein", "काम": "kaam", "नाम": "naam",
    "टाइम": "time", "दिन": "din", "रात": "raat", "साल": "saal",
    "घर": "ghar", "पैसा": "paisa", "पैसे": "paise", "गाड़ी": "gaadi",
    "जगह": "jagah", "करना": "karna", "कर": "kar", "करते": "karte",
    "करता": "karta", "करती": "karti", "किया": "kiya", "किये": "kiye",
    "कि": "ki", "की": "ki", "के": "ke", "का": "ka", "को": "ko",
    "से": "se", "में": "mein", "पे": "pe", "हो": "ho", "होगा": "hoga",
    "होगी": "hogi", "होंगे": "honge", "होता": "hota", "होती": "hoti",
    "होते": "hote", "हुआ": "hua", "हुई": "hui", "हुए": "hue",
    "रहा": "raha", "रही": "rahi", "रहे": "rahe", "बोल": "bol",
    "बोला": "bola", "बोली": "boli", "बोले": "bole", "बोलना": "bolna",
    "कहा": "kaha", "कहते": "kahte", "कहना": "kahna",
    "देख": "dekh", "देखा": "dekha", "देखी": "dekhi", "देखे": "dekhe",
    "देखना": "dekhna", "सुन": "sun", "सुना": "suna", "सुनी": "suni",
    "सुनना": "sunna", "जा": "ja", "जाना": "jaana", "जाता": "jaata",
    "जाती": "jaati", "जाते": "jaate", "गया": "gaya", "गयी": "gayi",
    "गए": "gaye", "आ": "aa", "आना": "aana", "आता": "aata",
    "आती": "aati", "आते": "aate", "आया": "aaya", "आयी": "aayi",
    "आए": "aaye", "दे": "de", "देना": "dena", "दिया": "diya",
    "दिए": "diye", "दी": "di", "ले": "le", "लेना": "lena",
    "लिया": "liya", "लिए": "liye", "ली": "li",
    "समझ": "samajh", "समझा": "samjha", "याद": "yaad",
    "सोच": "soch", "सोचा": "socha", "मालूम": "maaloom", "पता": "pata",
    "सही": "sahi", "गलत": "galat", "अच्छा": "accha", "अच्छी": "acchi",
    "अच्छे": "acche", "बुरा": "bura", "बड़ा": "bada", "बड़ी": "badi",
    "बड़े": "bade", "छोटा": "chhota", "छोटी": "chhoti", "छोटे": "chhote",
    "नया": "naya", "नई": "nayi", "पुराना": "purana",
    "पहला": "pehla", "पहली": "pehli", "पहले": "pehle", "बाद": "baad",
    "अभी": "abhi", "तब": "tab", "अब": "ab",
    "यहाँ": "yahan", "यहां": "yahan", "वहाँ": "wahan", "वहां": "wahan",
    "अंदर": "andar", "बाहर": "baahar", "ऊपर": "upar", "नीचे": "neeche",
    "साथ": "saath", "पास": "paas", "दूर": "door",
    "हूँ": "hoon", "हूं": "hoon", "बैठ": "baith", "बैठा": "baitha",
    "बैठी": "baithi", "बैठे": "baithe", "पड़ा": "pada", "पड़ी": "padi",
    "पड़े": "pade", "रहेंगे": "rahenge", "बताता": "batata",
    "बताती": "batati", "बताते": "batate", "वीडियो": "video",
    "मुझे": "mujhe", "तुझे": "tujhe", "उसे": "use", "उन्हें": "unhein",
    "इनको": "inko", "उनको": "unko", "किसने": "kisne", "उसने": "usne",
    "शायद": "shayad", "ज़रूर": "zaroor", "जरूर": "zaroor", "सिर्फ": "sirf",
    "खास": "khaas", "वजह": "wajah", "तरह": "tarah", "वक्त": "waqt"
}

_memory_word_cache: Dict[str, str] = dict(DEFAULT_COMMON_HINGLISH_WORDS)
_cache_loaded = False


def _load_hinglish_word_cache() -> Dict[str, str]:
    """Load persistent Hinglish word dictionary from disk."""
    global _memory_word_cache, _cache_loaded
    if not _cache_loaded:
        if HINGLISH_WORD_CACHE_FILE.exists():
            try:
                with open(HINGLISH_WORD_CACHE_FILE, "r", encoding="utf-8") as f:
                    disk_cache = json.load(f)
                    if isinstance(disk_cache, dict):
                        _memory_word_cache.update(disk_cache)
            except Exception as e:
                logger.warning("Could not load hinglish word cache: %s", e)
        _cache_loaded = True
    return _memory_word_cache


def _save_hinglish_word_cache(new_entries: Dict[str, str]) -> None:
    """Save newly learned word mappings atomically to disk."""
    if not new_entries:
        return
    _load_hinglish_word_cache()
    _memory_word_cache.update(new_entries)
    try:
        tmp = HINGLISH_WORD_CACHE_FILE.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(_memory_word_cache, f, ensure_ascii=False, indent=2)
        tmp.replace(HINGLISH_WORD_CACHE_FILE)
    except Exception as e:
        logger.warning("Could not persist hinglish word cache: %s", e)


# Deterministic phonetic converter (offline / zero-latency fallback)
_VOWELS = {
    'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri',
    'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'अं': 'an', 'अः': 'ah'
}
_MATRAS = {
    'ा': 'a', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri',
    'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ं': 'n', 'ँ': 'n', 'ः': 'h'
}
_CONSONANTS = {
    'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
    'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
    'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
    'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
    'प': 'p', 'फ': 'f', 'ब': 'b', 'भ': 'bh', 'म': 'm',
    'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v',
    'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
    'ड़': 'd', 'ढ़': 'dh', 'फ़': 'f', 'ज़': 'z', 'क़': 'q', 'ख़': 'kh', 'ग़': 'g'
}


def rule_based_hindi_to_hinglish(word: str) -> str:
    """
    Deterministic rule-based Hindi Devanagari to Roman Hinglish transliterator.
    Handles matras, conjuncts, and Hindi schwa deletion with 0ms latency.
    """
    if not word or not re.search(r'[\u0900-\u097F]', word):
        return word

    res = []
    n = len(word)
    i = 0
    while i < n:
        c = word[i]
        nxt = word[i+1] if i+1 < n else ''
        if c + nxt in _CONSONANTS:
            base = _CONSONANTS[c + nxt]
            i += 2
            nxt = word[i] if i < n else ''
            if nxt == '्':
                res.append(base)
                i += 1
            elif nxt in _MATRAS:
                res.append(base + _MATRAS[nxt])
                i += 1
            elif i >= n:
                res.append(base)
            else:
                res.append(base + 'a')
        elif c in _CONSONANTS:
            base = _CONSONANTS[c]
            i += 1
            nxt = word[i] if i < n else ''
            if nxt == '्':
                res.append(base)
                i += 1
            elif nxt in _MATRAS:
                res.append(base + _MATRAS[nxt])
                i += 1
            elif i >= n:
                res.append(base)
            else:
                res.append(base + 'a')
        elif c in _VOWELS:
            res.append(_VOWELS[c])
            i += 1
        elif c in _MATRAS:
            res.append(_MATRAS[c])
            i += 1
        elif c == '्':
            i += 1
        else:
            res.append(c)
            i += 1

    return ''.join(res)


def transliterate_hindi_words_1to1(unique_words: List[str]) -> Dict[str, str]:
    """
    Transliterate a list of unique Hindi Devanagari words into colloquial Hinglish.
    Checks memory/disk cache first. For any uncached words, queries Groq chat model
    (or falls back to deterministic rule-based transliteration).
    Guarantees 1:1 word mapping and zero Devanagari characters in output.
    """
    if not unique_words:
        return {}

    cache = _load_hinglish_word_cache()
    result_map: Dict[str, str] = {}
    missing_words: List[str] = []

    for w in unique_words:
        w_clean = re.sub(r'[^\u0900-\u097F]', '', str(w)).strip()
        if not w_clean:
            continue
        if w_clean in cache:
            result_map[w_clean] = cache[w_clean]
        else:
            missing_words.append(w_clean)

    missing_words = list(dict.fromkeys(missing_words))  # deduplicate
    if not missing_words:
        return result_map

    new_mappings: Dict[str, str] = {}
    api_key = get_groq_api_key()

    if api_key:
        try:
            from groq import Groq
            client = Groq(api_key=api_key, timeout=30.0, max_retries=1)
            prompt = (
                "You are a strict Hindi-to-Hinglish 1-to-1 word transliterator.\n"
                "Convert each Hindi Devanagari word into its common, everyday Romanized Hinglish [a-z] spelling (as used on Indian Instagram Reels / YouTube Shorts).\n\n"
                "RULES:\n"
                "1. DO NOT translate meaning into English words. Spoken Hindi words MUST remain Hindi words (e.g. 'अगर' -> 'agar', 'नहीं' -> 'nahi', 'वीडियो' -> 'video', 'लड़कियां' -> 'ladkiyan').\n"
                "2. Return ONLY a valid JSON object mapping each Hindi word directly to its lowercase Hinglish string.\n"
                "3. Output MUST contain ZERO Devanagari characters (only standard English a-z)."
            )

            models_to_try = ["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"]
            for model_name in models_to_try:
                try:
                    res = client.chat.completions.create(
                        model=model_name,
                        messages=[
                            {"role": "system", "content": prompt},
                            {"role": "user", "content": json.dumps(missing_words, ensure_ascii=False)}
                        ],
                        temperature=0.0,
                        max_tokens=800,
                    )
                    raw = (res.choices[0].message.content or "").strip()
                    if raw.startswith("```"):
                        raw = re.sub(r'^```(?:json)?\s*', '', raw)
                        raw = re.sub(r'\s*```$', '', raw)
                    parsed = json.loads(raw)
                    if isinstance(parsed, dict):
                        for k, v in parsed.items():
                            k_clean = str(k).strip()
                            v_clean = str(v).strip().lower()
                            # Ensure output contains no Devanagari
                            if not has_devanagari_characters(v_clean) and v_clean:
                                new_mappings[k_clean] = v_clean
                        if new_mappings:
                            break
                except Exception as m_err:
                    logger.warning("Groq Hinglish word transliteration (%s) failed: %s", model_name, m_err)
                    continue
        except Exception as groq_err:
            logger.warning("Groq client setup for Hinglish transliteration failed: %s", groq_err)

    # For any words that still failed or were missed, use the rule-based fallback
    for mw in missing_words:
        if mw not in new_mappings:
            new_mappings[mw] = rule_based_hindi_to_hinglish(mw)

    if new_mappings:
        _save_hinglish_word_cache(new_mappings)
        result_map.update(new_mappings)

    return result_map


def transliterate_text_preserving_punctuation(text: str, word_map: Dict[str, str]) -> str:
    """
    Replace all Devanagari words in text with their Hinglish equivalent from word_map.
    Preserves all surrounding English words, punctuation, spaces, and formatting intact.
    """
    if not text or not re.search(r'[\u0900-\u097F]', text):
        return text

    def _replace_match(match):
        hindi_word = match.group(0)
        return word_map.get(hindi_word, rule_based_hindi_to_hinglish(hindi_word))

    return re.sub(r'[\u0900-\u097F]+', _replace_match, str(text))


def convert_words_to_hinglish_1to1(
    words: List[Dict[str, Any]],
    word_map: Optional[Dict[str, str]] = None
) -> List[Dict[str, Any]]:
    """
    Transliterate word-level timestamps in-place from Hindi Devanagari to Hinglish [a-z].
    STRICTLY preserves Whisper's exact 'start' and 'end' audio timestamps for each word.
    """
    if not words:
        return []

    if word_map is None:
        # Collect unique Devanagari words from the word stream
        unique_devanagari: List[str] = []
        for w in words:
            raw_w = str(w.get("word", "")).strip()
            found = re.findall(r'[\u0900-\u097F]+', raw_w)
            unique_devanagari.extend(found)
        word_map = transliterate_hindi_words_1to1(unique_devanagari)

    converted_words: List[Dict[str, Any]] = []
    for w in words:
        w_copy = dict(w)
        orig_word = str(w_copy.get("word", "")).strip()
        w_copy["word"] = transliterate_text_preserving_punctuation(orig_word, word_map)
        converted_words.append(w_copy)

    return converted_words


def convert_cues_to_hinglish(cues: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Convert cues list containing Hindi Devanagari text into clean [a-z] Hinglish.
    1. Collects unique Devanagari vocabulary across all cues.
    2. Transliterates words 1:1.
    3. Replaces words in-place while keeping 100% of Whisper's millisecond timestamps.
    4. Guarantees ZERO Devanagari characters and perfect voice-synchronized subtitle burns.
    """
    if not cues:
        return []

    cues = [c for c in cues if not is_hallucinated_prompt_segment(c.get("text") or "")]
    if not cues:
        return []

    # Collect all unique Devanagari words across all cues and word tokens
    unique_hindi: List[str] = []
    for c in cues:
        raw_text = str(c.get("text", "")).strip()
        unique_hindi.extend(re.findall(r'[\u0900-\u097F]+', raw_text))
        for w in c.get("words", []) or []:
            w_text = str(w.get("word", "")).strip()
            unique_hindi.extend(re.findall(r'[\u0900-\u097F]+', w_text))

    if not unique_hindi:
        return cues

    word_map = transliterate_hindi_words_1to1(unique_hindi)

    converted_cues: List[Dict[str, Any]] = []
    for cue in cues:
        c_copy = dict(cue)
        raw_words = c_copy.get("words") or []

        if raw_words:
            # 1:1 transliterate existing word timestamps without shifting time by even 1ms
            new_words = convert_words_to_hinglish_1to1(raw_words, word_map)
            c_copy["words"] = new_words
            c_copy["text"] = " ".join([w["word"] for w in new_words if w.get("word")]).strip()
        else:
            # Transliterate cue text and synthesize if words were missing
            hing_text = transliterate_text_preserving_punctuation(c_copy.get("text", ""), word_map)
            c_copy["text"] = hing_text
            c_st = _safe_float(c_copy.get("start"), 0.0)
            c_en = _safe_float(c_copy.get("end"), c_st + 1.0)
            c_copy["words"] = synthesize_word_timestamps(hing_text, c_st, c_en)

        converted_cues.append(c_copy)

    return converted_cues


def convert_transcript_to_hinglish(transcript: Dict[str, Any], video_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Convert an entire transcript to 1-to-1 Hinglish, preserving all segments,
    precise word timestamps, and full audio synchronization.
    """
    segments = transcript.get("segments", [])
    if not segments:
        return transcript

    new_segments = convert_cues_to_hinglish(segments)

    new_transcript = dict(transcript)
    new_transcript["segments"] = new_segments
    new_transcript["language"] = "hinglish"
    new_transcript["full_text"] = " ".join([s.get("text", "") for s in new_segments if s.get("text")])

    vid = video_id or transcript.get("video_id")
    if vid:
        save_transcript(f"{vid}_hinglish", new_transcript)
        save_transcript(vid, new_transcript)

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
    """
    Retrieve transcript from disk or DB.
    Checks all candidate variations: exact id, _hinglish, _raw, and embedded YouTube IDs.
    """
    if not video_id:
        return None

    clean_vid = str(video_id).strip()
    candidates = [clean_vid, f"{clean_vid}_hinglish", f"{clean_vid}_raw"]

    # Extract YouTube 11-char ID if embedded in video_id
    yt_match = re.search(r"\[([a-zA-Z0-9_-]{11})\]", clean_vid) or re.search(r"_([a-zA-Z0-9_-]{11})$", clean_vid)
    if yt_match:
        yt_id = yt_match.group(1)
        candidates.extend([yt_id, f"{yt_id}_hinglish", f"{yt_id}_raw"])

    # 1. Search disk files in priority order
    for cand in candidates:
        json_path = TRANSCRIPTS_DIR / f"{cand}.json"
        if json_path.exists():
            try:
                with open(json_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if data and data.get("segments"):
                        return data
            except Exception as exc:
                logger.warning("Could not read transcript file %s: %s", json_path, exc)

    # 2. Search database in priority order
    for cand in candidates:
        try:
            db_doc = db.db_get_transcript(cand)
            if db_doc and db_doc.get("segments"):
                return db_doc
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
    Strictly filters out words spoken outside the clip boundaries and deduplicates words.
    """
    raw_segments = transcript.get("segments", [])
    clip_duration = round(clip_end - clip_start, 2)
    sliced_cues: List[Dict[str, Any]] = []
    seen_words = set()

    for seg in raw_segments:
        s_start = float(seg.get("start", 0.0))
        s_end = float(seg.get("end", 0.0))

        # Check if segment overlaps with the clip range
        if s_end <= clip_start or s_start >= clip_end:
            continue

        raw_words = seg.get("words", [])
        rel_words = []
        if raw_words:
            for w in raw_words:
                w_st = float(w.get("start", 0.0))
                w_en = float(w.get("end", 0.0))
                w_dur = max(0.05, w_en - w_st)

                # Overlap check with clip boundary
                if w_en <= clip_start or w_st >= clip_end:
                    continue
                # If word starts before clip cut, require at least 40% inside clip
                if w_st < clip_start and ((w_en - clip_start) / w_dur) < 0.40:
                    continue
                # If word ends after clip cut, require at least 40% inside clip
                if w_en > clip_end and ((clip_end - w_st) / w_dur) < 0.40:
                    continue

                r_st = max(0.0, round(w_st - clip_start, 2))
                r_en = min(clip_duration, round(w_en - clip_start, 2))
                w_key = (w.get("word", "").strip(), round(w_st, 1))
                if w_key in seen_words:
                    continue
                seen_words.add(w_key)
                rel_words.append({
                    "word": w.get("word", "").strip(),
                    "start": r_st,
                    "end": r_en,
                })
        elif seg.get("text"):
            r_st = max(0.0, round(s_start - clip_start, 2))
            r_en = min(clip_duration, round(s_end - clip_start, 2))
            rel_words = synthesize_word_timestamps(seg["text"], r_st, r_en)

        if rel_words:
            sliced_cues.append({
                "id": len(sliced_cues),
                "start": rel_words[0]["start"],
                "end": rel_words[-1]["end"],
                "text": " ".join(w["word"] for w in rel_words),
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
        if custom_path.stat().st_size == 0:
            logger.info("Found 0-byte subtitle file %s; cleaning up to regenerate", custom_path)
            custom_path.unlink(missing_ok=True)
            custom_path = None
        else:
            try:
                with open(custom_path, "r", encoding="utf-8") as f:
                    saved = json.load(f)
                    cues = saved.get("cues", [])

                    # Filter and clean any hallucinated prompt segments or words
                    orig_len = len(cues)
                    cleaned_cues = []
                    for c in cues:
                        raw_t = str(c.get("text", "")).strip()
                        cl_t = clean_hallucinated_text(raw_t)
                        if cl_t and not is_hallucinated_prompt_segment(raw_t):
                            c_copy = dict(c)
                            c_copy["text"] = cl_t
                            if "words" in c_copy and isinstance(c_copy["words"], list):
                                c_copy["words"] = sanitize_word_list(c_copy["words"])
                            cleaned_cues.append(c_copy)
                    cues = cleaned_cues

                    if len(cues) != orig_len:
                        logger.info("Filtered %d prompt hallucination cues from %s", orig_len - len(cues), custom_path.name)
                        for idx, c in enumerate(cues):
                            c["id"] = idx
                        saved["cues"] = cues
                        save_clip_subtitles(clip_name, saved)
                        if clip_file:
                            try:
                                full_caption = " ".join([c.get("text", "").strip() for c in cues if c.get("text", "").strip()])
                                from routers.subtitles_router import update_clip_metadata_caption
                                update_clip_metadata_caption(clip_file, full_caption, saved.get("styles", {}))
                            except Exception:
                                pass

                    # By default convert any saved Hindi Devanagari cues to Hinglish
                    if any(has_devanagari_characters(c.get("text", "")) for c in cues):
                        logger.info("Found Hindi Devanagari in saved subtitles for %s; auto-converting to Hinglish by default", clip_name)
                        cues = convert_cues_to_hinglish(cues)
                        saved["cues"] = cues
                        save_clip_subtitles(clip_name, saved)

                        if clip_file:
                            try:
                                full_caption = " ".join([c.get("text", "").strip() for c in cues if c.get("text", "").strip()])
                                from routers.subtitles_router import update_clip_metadata_caption
                                update_clip_metadata_caption(clip_file, full_caption, saved.get("styles", {}))
                            except Exception:
                                pass
                    for c in cues:
                        if not c.get("words") and c.get("text"):
                            c["words"] = synthesize_word_timestamps(
                                c["text"], float(c.get("start", 0)), float(c.get("end", 0))
                            )
                    # Auto-chunk into 2-4 word bites if cues are long full sentences
                    if cues and any(len(str(c.get("text", "")).split()) > 5 for c in cues):
                        cues = create_voice_synced_word_chunks(cues, max_words=3)
                        saved["cues"] = cues

                    styles = saved.get("styles", {})
                    styles.setdefault("highlight_mode", "active_word")
                    styles.setdefault("words_per_screen", 3)
                    styles.setdefault("font_family", "Montserrat")
                    styles.setdefault("font_size", 48)
                    styles.setdefault("primary_color", "#FFFFFF")
                    styles.setdefault("highlight_color", "#FACC15")
                    styles.setdefault("outline_color", "#000000")
                    styles.setdefault("outline_width", 0.5)
                    styles.setdefault("text_transform", "uppercase")
                    styles.setdefault("margin_v", 320)
                    saved["cues"] = cues
                    saved["styles"] = styles

                    # If cues exist and are valid, return them
                    if cues:
                        return saved
            except Exception as e_load:
                logger.warning("Could not read existing subtitle file %s: %s", custom_path, e_load)
                custom_path = None

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

    source_video_id = meta.get("source_video_id") if meta else None
    source_file_name = meta.get("source_file") if meta else ""
    clip_start = float(meta.get("clip_start", 0.0)) if meta else 0.0
    clip_end = float(meta.get("clip_end", 0.0)) if meta else 0.0

    # 1. First priority for rendered clips: direct Groq Whisper transcription produces 100% exact voice sync
    if not clip_file or not clip_file.exists():
        clip_file = _find_clip_path(clip_name)

    if clip_file and clip_file.exists() and get_groq_api_key():
        try:
            logger.info("Auto-transcribing clip %s directly for 100%% voice-audio sync...", clip_file.name)
            clip_transcript = transcribe_video_with_groq(clip_file, video_id=clip_file.stem)
            raw_cues = clip_transcript.get("segments", [])
            cues = create_voice_synced_word_chunks(raw_cues, max_words=3)

            # 1. Indic / Hindi audio -> by default save & get Hinglish subtitles
            raw_lang = str(clip_transcript.get("language", "")).lower()
            is_indic = any(has_devanagari_characters(c.get("text", "")) for c in cues) or raw_lang in (
                "hi", "hindi", "urdu", "pa", "punjabi", "mr", "marathi", "gu", "gujarati", "bn", "bengali", "ne", "nepali", "sa", "sanskrit"
            )
            if is_indic:
                cues = convert_cues_to_hinglish(cues)
            # 2. Foreign language (neither Hindi nor English) -> by default use English translation
            elif raw_lang not in ("en", "english"):
                try:
                    cues = translate_clip_to_english_with_groq(clip_file)
                    cues = create_voice_synced_word_chunks(cues, max_words=3)
                except Exception:
                    pass

            styles = (meta or {}).get("styles", {})
            styles.setdefault("highlight_mode", "active_word")
            styles.setdefault("words_per_screen", 3)
            styles.setdefault("font_family", "Montserrat")
            styles.setdefault("font_size", 48)
            styles.setdefault("primary_color", "#FFFFFF")
            styles.setdefault("highlight_color", "#FACC15")
            styles.setdefault("outline_color", "#000000")
            styles.setdefault("outline_width", 0.5)
            styles.setdefault("text_transform", "uppercase")
            styles.setdefault("margin_v", 320)

            # Persist to disk so subsequent loads are instant
            save_clip_subtitles(clip_name, {"cues": cues, "styles": styles})
            return {
                "cues": cues,
                "styles": styles,
                "source_video_id": clip_file.stem,
                "clip_start": 0.0,
                "clip_end": round(float(clip_transcript.get("duration", 0.0)), 2),
                "has_groq_key": True
            }
        except Exception as exc:
            logger.warning("Direct clip transcription failed, falling back to parent slice: %s", exc)

    # 2. Fallback: retrieve parent video transcript and slice cleanly
    transcript = None
    if source_video_id:
        transcript = get_stored_transcript(source_video_id)
    if not transcript and source_file_name:
        transcript = get_stored_transcript(Path(source_file_name).stem)

    if transcript and transcript.get("segments"):
        if meta and meta.get("has_prepended_hook") and float(meta.get("hook_duration", 0.0)) > 0:
            h_st = float(meta.get("hook_start", clip_start))
            h_dur = float(meta.get("hook_duration", 0.0))
            raw_hook = slice_transcript_for_clip(transcript, h_st, h_st + h_dur)
            hook_chunks = create_voice_synced_word_chunks(raw_hook, max_words=3)
            for hc in hook_chunks:
                hc["end"] = min(h_dur, hc["end"])

            raw_body = slice_transcript_for_clip(transcript, clip_start, clip_end)
            body_chunks = create_voice_synced_word_chunks(raw_body, max_words=3)
            for bc in body_chunks:
                bc["start"] = round(bc["start"] + h_dur, 2)
                bc["end"] = round(bc["end"] + h_dur, 2)
                for w in bc.get("words", []):
                    w["start"] = round(w["start"] + h_dur, 2)
                    w["end"] = round(w["end"] + h_dur, 2)

            cues = hook_chunks + body_chunks
            for idx, c in enumerate(cues):
                c["id"] = idx
        else:
            raw_cues = slice_transcript_for_clip(transcript, clip_start, clip_end)
            cues = create_voice_synced_word_chunks(raw_cues, max_words=3)

        # 1. Hindi audio -> by default save & get Hinglish subtitles
        if any(has_devanagari_characters(c.get("text", "")) for c in cues) or str(transcript.get("language", "")).lower() in ("hi", "hindi", "urdu"):
            cues = convert_cues_to_hinglish(cues)
        # 2. Foreign language (neither Hindi nor English) -> by default use English translation
        elif str(transcript.get("language", "")).lower() not in ("en", "english"):
            en_trans = get_stored_transcript(f"{source_video_id}_en")
            if en_trans and en_trans.get("segments"):
                raw_cues_en = slice_transcript_for_clip(en_trans, clip_start, clip_end)
                if raw_cues_en:
                    cues = create_voice_synced_word_chunks(raw_cues_en, max_words=3)

        styles = (meta or {}).get("styles", {})
        styles.setdefault("highlight_mode", "active_word")
        styles.setdefault("words_per_screen", 3)
        styles.setdefault("font_family", "Montserrat")
        styles.setdefault("font_size", 48)
        styles.setdefault("primary_color", "#FFFFFF")
        styles.setdefault("highlight_color", "#FACC15")
        styles.setdefault("outline_color", "#000000")
        styles.setdefault("outline_width", 0.5)
        styles.setdefault("text_transform", "uppercase")
        styles.setdefault("margin_v", 320)

        # Cache sliced subtitles to disk
        save_clip_subtitles(clip_name, {"cues": cues, "styles": styles})
        return {
            "cues": cues,
            "styles": styles,
            "source_video_id": source_video_id or (clip_file.stem if clip_file else "clip"),
            "clip_start": clip_start,
            "clip_end": clip_end,
            "has_groq_key": bool(get_groq_api_key())
        }

    styles = (meta or {}).get("styles", {})
    styles.setdefault("highlight_mode", "active_word")
    styles.setdefault("words_per_screen", 3)
    return {
        "cues": [],
        "styles": styles,
        "source_video_id": source_video_id or (clip_file.stem if clip_file else "clip"),
        "has_groq_key": bool(get_groq_api_key())
    }


def save_clip_subtitles(clip_name: str, data: Dict[str, Any]) -> None:
    """Save user-edited subtitle cues & style settings for a clip atomically."""
    cues = data.get("cues", [])
    if cues and any(has_devanagari_characters(c.get("text", "")) for c in cues):
        logger.info("Devanagari detected in save_clip_subtitles for %s; converting to Hinglish by default", clip_name)
        data["cues"] = convert_cues_to_hinglish(cues)

    clip_file = _find_clip_path(clip_name)
    if clip_file:
        custom_path = clip_file.with_name(f"{clip_file.name}.subtitles.json")
    else:
        custom_path = CLIPS_DIR / f"{Path(clip_name).name}.subtitles.json"
    custom_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = custom_path.with_suffix(".tmp")
    with open(temp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    temp_path.replace(custom_path)
