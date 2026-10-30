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

        raw_lang = getattr(transcription, "language", "en")
        detected_lang = str(raw_lang).lower() if raw_lang else "en"
        has_devanagari = any(has_devanagari_characters(s.get("text", "")) for s in parsed_segments)

        transcript_data = {
            "video_id": video_id,
            "source_file": video_path.name,
            "language": "hi" if (detected_lang in ("hi", "hindi", "urdu") or has_devanagari) else detected_lang,
            "duration": getattr(transcription, "duration", 0.0),
            "full_text": getattr(transcription, "text", ""),
            "segments": parsed_segments,
        }

        # 1. Hindi audio -> by default save & get Hinglish subtitles
        if detected_lang in ("hi", "hindi", "urdu") or has_devanagari:
            logger.info("Detected Hindi audio in %s; auto-converting transcript to Hinglish by default", video_id)
            save_transcript(f"{video_id}_raw", transcript_data)
            transcript_data = convert_transcript_to_hinglish(transcript_data, video_id=video_id)
            return transcript_data

        # 2. Foreign language (neither Hindi nor English) -> by default use English translation
        elif detected_lang not in ("en", "english"):
            logger.info("Detected foreign language '%s' in %s; translating to English by default", detected_lang, video_id)
            save_transcript(f"{video_id}_raw", transcript_data)
            try:
                en_trans = translate_video_to_english_with_groq(video_path, video_id=video_id)
                if en_trans and en_trans.get("segments"):
                    save_transcript(video_id, en_trans)
                    return en_trans
            except Exception as tr_err:
                logger.warning("Auto-translation to English failed for %s (%s); keeping base transcript: %s", video_id, detected_lang, tr_err)

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


def convert_text_to_hinglish_batch(texts: List[str], batch_size: int = 25) -> List[str]:
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
        "2. Convert all Hindi / Devanagari words into everyday standard Hinglish (e.g. 'लड़कियां' -> 'ladkiyan', 'बहुत' -> 'bahut', 'दोस्त' -> 'dost', 'हैं' -> 'hain', 'हो जाए' -> 'ho jaye', 'खुश हूँ' -> 'khush hoon').\n"
        "3. DO NOT translate the meaning into English. The spoken Hindi words MUST remain Hindi words, just written in English Latin letters.\n"
        "4. Output MUST contain ZERO Devanagari characters (only standard English A-Z, numbers, and basic punctuation).\n"
        "5. Return ONLY a valid JSON array of strings, with exactly one output string corresponding to each input string in the exact same order."
    )

    models_to_try = [
        "qwen/qwen3.8-27b",
        "openai/gpt-oss-120b",
        "openai/gpt-oss-20b",
        "llama-3.1-8b-instant",
        "llama-3.3-70b-versatile"
    ]

    results: List[str] = []
    for i in range(0, len(texts), batch_size):
        chunk = texts[i:i + batch_size]
        # If this entire chunk has no Devanagari, pass it through directly
        if not any(has_devanagari_characters(t) for t in chunk):
            results.extend(chunk)
            continue

        chunk_success = False
        user_msg = "Convert this JSON array of subtitle lines to Hinglish:\n" + json.dumps(chunk, ensure_ascii=False)

        for model_name in models_to_try:
            try:
                res = client.chat.completions.create(
                    model=model_name,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_msg}
                    ],
                    temperature=0.0,
                    max_tokens=2048
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
                    # Clean any accidental lingering Devanagari characters
                    cleaned_items = [str(item).strip() for item in parsed]
                    results.extend(cleaned_items)
                    chunk_success = True
                    break
                else:
                    logger.warning("Hinglish transliteration count mismatch via %s (expected %d, got %s)",
                                   model_name, len(chunk), len(parsed) if isinstance(parsed, list) else "not-list")
                    if isinstance(parsed, list) and len(parsed) >= len(chunk):
                        results.extend([str(x).strip() for x in parsed[:len(chunk)]])
                        chunk_success = True
                        break
            except Exception as exc:
                logger.warning("Hinglish transliteration model %s failed for chunk %d: %s", model_name, i, exc)
                continue

        if not chunk_success:
            logger.error("All Hinglish models failed for chunk %d; retaining original lines", i)
            results.extend(chunk)

    return results


def convert_cues_to_hinglish(cues: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Convert cues list with Hindi Devanagari text into Hinglish (English alphabet).
    Regenerates voice-synced word timestamps with Hinglish words so active word
    illumination and subtitle burns contain zero Devanagari glyphs.
    """
    if not cues:
        return []

    texts = [c.get("text", "") for c in cues]
    hinglish_texts = convert_text_to_hinglish_batch(texts)

    converted_cues = []
    for cue, hing_text in zip(cues, hinglish_texts):
        c_copy = dict(cue)
        c_copy["text"] = hing_text
        c_start = float(cue.get("start", 0.0))
        c_end = float(cue.get("end", c_start + 1.0))
        # Re-synthesize word timestamps for new Hinglish words so ASS active-word
        # illumination and frontend preview use Hinglish words without Devanagari!
        c_copy["words"] = synthesize_word_timestamps(hing_text, c_start, c_end)
        converted_cues.append(c_copy)
    return converted_cues


def convert_transcript_to_hinglish(transcript: Dict[str, Any], video_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Convert an entire transcript to Hinglish, regenerate segment word timestamps,
    and cache on disk and MongoDB.
    """
    segments = transcript.get("segments", [])
    if not segments:
        return transcript

    texts = [s.get("text", "") for s in segments]
    hing_texts = convert_text_to_hinglish_batch(texts)

    new_segments = []
    for s, h_text in zip(segments, hing_texts):
        s_copy = dict(s)
        s_copy["text"] = h_text
        seg_st = float(s.get("start", 0.0))
        seg_en = float(s.get("end", seg_st + 1.0))
        s_copy["words"] = synthesize_word_timestamps(h_text, seg_st, seg_en)
        new_segments.append(s_copy)

    new_transcript = dict(transcript)
    new_transcript["segments"] = new_segments
    new_transcript["language"] = "hinglish"
    new_transcript["full_text"] = " ".join([t for t in hing_texts if t])

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

            # 1. Hindi audio -> by default save & get Hinglish subtitles
            if any(has_devanagari_characters(c.get("text", "")) for c in cues) or str(clip_transcript.get("language", "")).lower() in ("hi", "hindi", "urdu"):
                cues = convert_cues_to_hinglish(cues)
            # 2. Foreign language (neither Hindi nor English) -> by default use English translation
            elif str(clip_transcript.get("language", "")).lower() not in ("en", "english"):
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
