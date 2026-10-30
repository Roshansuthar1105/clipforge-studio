"""
services/viral_moment_service.py — AI Viral Moment & Hook Detection Engine (Opus Clip Style)
Uses 100% free tools & APIs:
- Groq Cloud Whisper API for millisecond-precision audio transcription
- Groq Cloud Llama 3.3 70B / Qwen 2.5 (Free Tier, 128k context) for viral hook & story analysis
- Smart heuristic fallback when offline or without API key
"""

from __future__ import annotations

import os
import re
import json
import logging
from pathlib import Path
from typing import Optional, Any, Dict, List

from services.transcription_service import (
    get_groq_api_key,
    get_stored_transcript,
    transcribe_video_with_groq,
    BASE_DIR,
)

logger = logging.getLogger("clipforge.viral_moments")


VIRAL_DETECTION_SYSTEM_PROMPT = """You are an elite viral short-form video producer and editor for Opus Clip, CapCut, and Alex Hormozi.
Your mission is to analyze a timestamped video transcript and identify the absolute most viral, high-retention moments (30 to 65 seconds each) that will blow up on TikTok, YouTube Shorts, and Instagram Reels.

VIRAL CRITERIA:
1. The Hook (First 3-5s): Must start with an irresistible hook — an unexpected contrarian statement, a provocative question, a shocking statistic, or a strong curiosity gap.
2. Standalone Cohesion: The moment MUST make complete sense on its own. It must have a clear beginning, supportive context, and a strong conclusion or punchline. Never cut in the middle of a sentence or thought.
3. Information Density: Fast-paced, high insight, drama, humor, or emotional punch. No boring filler or logistical preamble.
4. Duration: Ideal clip length is 30 to 60 seconds (minimum 25s, maximum 75s).
5. Timestamp Accuracy: start_time and end_time MUST strictly align with the transcript timestamps in seconds.

OUTPUT FORMAT:
Return ONLY a valid JSON object matching this exact schema:
{
  "moments": [
    {
      "headline": "Short viral click-worthy title (max 7 words)",
      "virality_score": 96,
      "hook": "The opening 1-2 hook sentences of this clip",
      "reason": "1-sentence reason why this specific moment will achieve high retention",
      "start_time": 142.5,
      "end_time": 195.0,
      "duration": 52.5,
      "category": "Contrarian | Story | Advice | Mindset | Humor"
    }
  ]
}
"""


def format_transcript_for_llm(transcript_data: Dict[str, Any], max_words: int = 14000) -> str:
    """Format segments into clean [MM:SS] timestamped script for the LLM."""
    segments = transcript_data.get("segments", [])
    if not segments:
        return ""

    lines = []
    word_count = 0

    for seg in segments:
        st = float(seg.get("start", 0.0))
        en = float(seg.get("end", 0.0))
        text = str(seg.get("text", "")).strip()
        if not text:
            continue

        mins = int(st // 60)
        secs = int(st % 60)
        time_tag = f"[{mins:02d}:{secs:02d} ({st:.1f}s)]"
        lines.append(f"{time_tag} {text}")

        word_count += len(text.split())
        if word_count > max_words:
            lines.append("... [transcript truncated for context length]")
            break

    return "\n".join(lines)


def detect_viral_moments_with_ai(
    transcript_data: Dict[str, Any],
    max_moments: int = 5,
    min_duration: float = 25.0,
    max_duration: float = 75.0
) -> List[Dict[str, Any]]:
    """
    Call Groq Cloud Llama 3.3 70B (Free Tier) to discover viral moments from the transcript.
    Falls back gracefully to heuristic scoring if API key is missing or call fails.
    """
    api_key = get_groq_api_key()
    if not api_key:
        logger.info("GROQ_API_KEY not set. Using smart heuristic viral detection.")
        return fallback_heuristic_viral_detection(transcript_data, max_moments=max_moments)

    formatted_transcript = format_transcript_for_llm(transcript_data)
    if not formatted_transcript:
        return []

    from groq import Groq
    client = Groq(api_key=api_key)

    user_prompt = (
        f"Please analyze this timestamped video transcript and identify the top {max_moments} viral short-form moments "
        f"(duration between {int(min_duration)}s and {int(max_duration)}s each).\n\n"
        f"TRANSCRIPT:\n{formatted_transcript}\n\n"
        f"Remember to return ONLY the JSON object with the 'moments' array."
    )

    # Preferred models on Groq: qwen/qwen3.8-27b (fast & reliable JSON), llama-3.1-8b-instant, then llama-3.3-70b-versatile
    models_to_try = [
        "qwen/qwen3.8-27b",
        "llama-3.1-8b-instant",
        "llama-3.3-70b-versatile"
    ]

    last_error = None
    for model_name in models_to_try:
        try:
            logger.info("Analyzing transcript for viral moments using %s...", model_name)
            response = client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": VIRAL_DETECTION_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.2,
                max_tokens=2048,
                response_format={"type": "json_object"} if "llama-3.3" in model_name or "qwen" in model_name else None
            )

            raw_content = response.choices[0].message.content.strip()
            # Clean possible markdown wrapping
            if raw_content.startswith("```"):
                raw_content = re.sub(r"^```(?:json)?\s*", "", raw_content)
                raw_content = re.sub(r"\s*```$", "", raw_content)

            parsed = json.loads(raw_content)
            moments_raw = parsed.get("moments", [])
            if not isinstance(moments_raw, list):
                # Check for alternative key
                for v in parsed.values():
                    if isinstance(v, list):
                        moments_raw = v
                        break

            validated_moments: List[Dict[str, Any]] = []
            for idx, m in enumerate(moments_raw):
                if not isinstance(m, dict):
                    continue

                st = float(m.get("start_time", 0.0))
                en = float(m.get("end_time", st + 45.0))
                dur = round(en - st, 1)

                # Keep duration within reasonable reel boundaries
                if dur < 15.0 or dur > 120.0:
                    dur = min(max_duration, max(min_duration, dur))
                    en = st + dur

                score = int(m.get("virality_score", 85))
                score = max(70, min(99, score))

                headline = str(m.get("headline", f"Viral Moment #{idx + 1}")).strip()
                hook = str(m.get("hook", "")).strip()
                reason = str(m.get("reason", "Strong curiosity hook with clear payoff.")).strip()
                category = str(m.get("category", "Advice")).strip()

                mins_st, secs_st = int(st // 60), int(st % 60)
                mins_en, secs_en = int(en // 60), int(en % 60)

                validated_moments.append({
                    "id": idx + 1,
                    "headline": headline,
                    "virality_score": score,
                    "hook": hook,
                    "reason": reason,
                    "category": category,
                    "start_time": round(st, 2),
                    "end_time": round(en, 2),
                    "duration": dur,
                    "timestamp_display": f"{mins_st:02d}:{secs_st:02d} - {mins_en:02d}:{secs_en:02d} ({int(dur)}s)",
                })

            if validated_moments:
                # Sort by highest virality score first
                validated_moments.sort(key=lambda x: x["virality_score"], reverse=True)
                logger.info("Successfully discovered %d viral moments via %s", len(validated_moments), model_name)
                return validated_moments[:max_moments]

        except Exception as exc:
            logger.warning("Groq viral detection failed with model %s: %s", model_name, exc)
            last_error = exc

    logger.warning("AI viral moment detection fallback to heuristic engine: %s", last_error)
    return fallback_heuristic_viral_detection(transcript_data, max_moments=max_moments)


def fallback_heuristic_viral_detection(
    transcript_data: Dict[str, Any],
    max_moments: int = 5,
    target_duration: float = 45.0
) -> List[Dict[str, Any]]:
    """
    100% offline rule-based viral moment scorer.
    Scans for high-interest psychological keywords, questions, pacing, and emotional triggers.
    """
    segments = transcript_data.get("segments", [])
    if not segments:
        return []

    CURIOSITY_WORDS = {
        "why", "how", "what", "secret", "never", "always", "mistake", "money",
        "million", "billion", "truth", "crazy", "insane", "stop", "biggest",
        "worst", "best", "nobody", "everyone", "warning", "realize", "change",
        "hack", "trick", "fail", "win", "danger", "shocking"
    }

    candidates = []
    total_segs = len(segments)

    # Sliding window across segments to find 35s - 55s windows
    for i in range(total_segs):
        seg_start = float(segments[i].get("start", 0.0))
        seg_text_list = []
        seg_end = seg_start

        for j in range(i, total_segs):
            s_text = str(segments[j].get("text", "")).strip()
            seg_text_list.append(s_text)
            seg_end = float(segments[j].get("end", seg_start))
            dur = seg_end - seg_start

            if dur >= 30.0:
                full_text = " ".join(seg_text_list)
                lower_text = full_text.lower()
                words = lower_text.split()

                # Calculate virality score (75 to 97)
                score = 75

                # First segment hook words
                first_seg_words = set(re.findall(r"\w+", seg_text_list[0].lower()))
                hook_hits = len(first_seg_words.intersection(CURIOSITY_WORDS))
                score += min(12, hook_hits * 4)

                # Question mark in hook
                if "?" in seg_text_list[0]:
                    score += 5

                # Exclamations
                exclamations = full_text.count("!")
                score += min(4, exclamations * 2)

                # Ideal duration bonus (38s to 52s)
                if 38.0 <= dur <= 52.0:
                    score += 4

                score = min(97, score)

                # Generate headline from hook
                tokens = re.sub(r"[^\w\s]", "", seg_text_list[0]).split()
                headline = " ".join(tokens[:6]).title()
                if not headline:
                    headline = f"Key Insight at {int(seg_start)}s"

                mins_st, secs_st = int(seg_start // 60), int(seg_start % 60)
                mins_en, secs_en = int(seg_end // 60), int(seg_end % 60)

                candidates.append({
                    "headline": headline,
                    "virality_score": score,
                    "hook": seg_text_list[0],
                    "reason": "High curiosity opening and strong vocal momentum.",
                    "category": "Insight",
                    "start_time": round(seg_start, 2),
                    "end_time": round(seg_end, 2),
                    "duration": round(dur, 1),
                    "timestamp_display": f"{mins_st:02d}:{secs_st:02d} - {mins_en:02d}:{secs_en:02d} ({int(dur)}s)",
                })
                break

    # Deduplicate overlapping candidates
    candidates.sort(key=lambda x: x["virality_score"], reverse=True)
    selected: List[Dict[str, Any]] = []

    for cand in candidates:
        overlap = False
        for sel in selected:
            # If two moments overlap by more than 15s, skip
            if not (cand["end_time"] <= sel["start_time"] + 15 or cand["start_time"] >= sel["end_time"] - 15):
                overlap = True
                break
        if not overlap:
            cand["id"] = len(selected) + 1
            selected.append(cand)
            if len(selected) >= max_moments:
                break

    return selected


def detect_viral_moments_for_video(
    video_path: Path,
    video_id: Optional[str] = None,
    max_moments: int = 5
) -> Dict[str, Any]:
    """
    Main entry point:
    1. Checks if transcript exists or transcribes source video via Groq Whisper.
    2. Runs AI viral moment detector.
    3. Caches moments to <video_id>.viral_moments.json.
    """
    vid = video_id or video_path.stem
    # Also extract YouTube 11-char ID if embedded in filename (e.g. [rBHpA9lXcS0])
    yt_match = re.search(r"\[([a-zA-Z0-9_-]{11})\]", str(vid)) or re.search(r"_([a-zA-Z0-9_-]{11})$", str(vid))
    alt_vid = yt_match.group(1) if yt_match else None

    cache_path = BASE_DIR / "transcripts" / f"{vid}.viral_moments.json"
    alt_cache_path = (BASE_DIR / "transcripts" / f"{alt_vid}.viral_moments.json") if alt_vid else None

    # Check disk cache (both vid and alt_vid)
    for cp in (cache_path, alt_cache_path):
        if cp and cp.exists():
            try:
                with open(cp, "r", encoding="utf-8") as f:
                    cached = json.load(f)
                    if cached.get("moments"):
                        logger.info("Found cached viral moments for %s", vid)
                        return cached
            except Exception:
                pass

    # Retrieve or generate transcript (checks both vid and alt_vid)
    transcript = get_stored_transcript(vid)
    if not transcript and alt_vid:
        transcript = get_stored_transcript(alt_vid)
    if not transcript:
        logger.info("Auto-transcribing %s for viral moments...", video_path.name)
        transcript = transcribe_video_with_groq(video_path, video_id=alt_vid or vid)

    if not transcript or not transcript.get("segments"):
        raise ValueError("Could not extract speech transcript for viral moment detection.")

    moments = detect_viral_moments_with_ai(transcript, max_moments=max_moments)

    result = {
        "video_id": vid,
        "source_file": video_path.name,
        "duration": transcript.get("duration", 0.0),
        "total_moments": len(moments),
        "moments": moments
    }

    # Save cache
    try:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
    except Exception as exc:
        logger.warning("Could not cache viral moments: %s", exc)

    return result
