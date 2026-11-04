"""
services/subtitle_service.py — Subtitle Styling, ASS Generation & FFmpeg Video Burner
Supports custom font family, colors, outline, text transform (UPPERCASE), and vertical positioning.
"""

from __future__ import annotations

import os
import re
import time
import logging
import threading
import subprocess
from pathlib import Path
from typing import Optional, Any, Dict, List, Callable

from services.transcription_service import synthesize_word_timestamps

logger = logging.getLogger("clipforge.subtitles")

APP_DIR = Path(__file__).resolve().parent.parent
BASE_DIR = Path(os.getenv("DATA_DIR", str(APP_DIR / "data"))).resolve()
CLIPS_DIR = BASE_DIR / "clips"


def hex_to_ass_color(hex_str: str, alpha: int = 0) -> str:
    """Convert standard #RRGGBB or #RGB to ASS &HAABBGGRR& format."""
    hex_str = str(hex_str).strip().lstrip("#")
    if len(hex_str) == 3:
        hex_str = "".join([c * 2 for c in hex_str])
    if len(hex_str) == 6:
        r, g, b = hex_str[0:2], hex_str[2:4], hex_str[4:6]
        return f"&H{alpha:02X}{b}{g}{r}&"
    return f"&H{alpha:02X}FFFFFF&"


def process_highlight_markup(
    text: str,
    highlight_color_ass: str,
    primary_color_ass: str,
    text_transform: str = "none",
    highlight_words: Optional[List[str]] = None,
    cue_highlighted: bool = False,
) -> str:
    """
    Process subtitle text for highlighting:
    - If cue_highlighted is True, wraps the entire text in highlight_color.
    - Replaces [word] or *word* markup with ASS inline color tags.
    - Highlights specific words in highlight_words list.
    - Applies text_transform (uppercase / title / none).
    """
    if not text:
        return ""

    if text_transform == "uppercase":
        text = text.upper()
    elif text_transform == "title":
        text = re.sub(r"[A-Za-z]+('[A-Za-z]+)?", lambda mo: mo.group(0).capitalize(), text)

    if cue_highlighted:
        clean = text.replace("[", "").replace("]", "").replace("*", "")
        return f"{{\\c{highlight_color_ass}}}{clean}{{\\c{primary_color_ass}}}"

    # Handle highlight_words if provided
    if highlight_words:
        for hw in highlight_words:
            if not hw:
                continue
            hw_target = hw.upper() if text_transform == "uppercase" else hw
            pattern = re.compile(rf"\b({re.escape(hw_target)})\b", re.IGNORECASE)
            text = pattern.sub(f"[{hw_target}]", text)

    # Process bracket markup [highlighted text] and asterisk markup *highlighted text*
    def _rep_bracket(match):
        inner = match.group(1).strip()
        return f"{{\\c{highlight_color_ass}}}{inner}{{\\c{primary_color_ass}}}"

    text = re.sub(r"\[([^\]]+)\]", _rep_bracket, text)
    text = re.sub(r"\*([^\*]+)\*", _rep_bracket, text)

    return text


def format_ass_timestamp(seconds: float) -> str:
    """Format seconds to ASS timestamp format: H:MM:SS.cs (centiseconds)."""
    if seconds < 0:
        seconds = 0.0
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    centis = int(round((seconds - int(seconds)) * 100))
    if centis >= 100:
        centis = 99
    return f"{hours}:{minutes:02d}:{secs:02d}.{centis:02d}"


def format_srt_timestamp(seconds: float) -> str:
    """Format seconds to SRT timestamp format: HH:MM:SS,mmm."""
    if seconds < 0:
        seconds = 0.0
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int(round((seconds - int(seconds)) * 1000))
    if millis >= 1000:
        millis = 999
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def _generate_ass_header(
    style: Optional[Dict[str, Any]] = None,
    video_width: int = 1080,
    video_height: int = 1920
) -> tuple[str, str, str, str]:
    """Helper to generate standard ASS header and return colors and text_transform."""
    style = style or {}
    font_name = style.get("font_name", "Arial Black")
    font_size = int(style.get("font_size", 48))
    primary_color = hex_to_ass_color(style.get("text_color", "#FFFFFF"))
    highlight_color = hex_to_ass_color(style.get("highlight_color", "#FFE500"))
    outline_color = hex_to_ass_color(style.get("outline_color", "#000000"))
    outline_width = float(style.get("outline_width", 0.5))
    shadow_depth = float(style.get("shadow_depth", 1.5))
    text_transform = style.get("text_transform", "uppercase")
    box_style = style.get("box_style", "none")  # none, box, pill, banner
    box_opacity = float(style.get("box_opacity", 0.65))

    # Border style: 1 = outline + drop shadow, 3 = opaque box
    border_style = 3 if box_style in ("box", "pill", "banner") else 1
    box_alpha = int(round(max(0.0, min(1.0, 1.0 - box_opacity)) * 255))
    back_color = hex_to_ass_color(style.get("box_color", "#000000"), alpha=box_alpha)

    # Position alignment in ASS:
    # 1=B-Left, 2=B-Center, 3=B-Right, 4=M-Left, 5=M-Center, 6=M-Right, 7=T-Left, 8=T-Center, 9=T-Right
    pos_preset = style.get("position_preset", "bottom")
    align_h = style.get("align_h", "center").lower()
    position_percent = style.get("position_percent")

    if position_percent is not None:
        try:
            pct = float(position_percent)
            if pct <= 35:
                base_align = 8
                margin_v = int(video_height * (pct / 100.0))
            elif pct >= 65:
                base_align = 2
                margin_v = int(video_height * (1.0 - (pct / 100.0)))
            else:
                base_align = 5
                margin_v = 0
        except Exception:
            base_align = 2
            margin_v = int(style.get("margin_v", 220))
    elif pos_preset == "top":
        base_align = 8
        margin_v = int(style.get("margin_v", 180))
    elif pos_preset == "middle":
        base_align = 5
        margin_v = int(style.get("margin_v", 0))
    else:  # bottom default
        base_align = 2
        margin_v = int(style.get("margin_v", 220))

    if align_h == "left":
        alignment = base_align - 1
    elif align_h == "right":
        alignment = base_align + 1
    else:
        alignment = base_align

    ass_header = f"""[Script Info]
Title: ClipForge Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: {video_width}
PlayResY: {video_height}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font_name},{font_size},{primary_color},&H000000FF&,{outline_color},{back_color},-1,0,0,0,100,100,1,0,{border_style},{outline_width},{shadow_depth},{alignment},60,60,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    return ass_header, primary_color, highlight_color, text_transform


def build_overlay_styles_and_events(
    overlays: Optional[List[Dict[str, Any]]],
    video_width: int = 1080,
    video_height: int = 1920
) -> tuple[List[str], List[str]]:
    """
    Generate ASS style declarations and dialogue events for custom text overlays.
    Returns (style_lines, dialogue_event_lines).
    """
    if not overlays:
        return [], []

    styles: List[str] = []
    events: List[str] = []

    for idx, ov in enumerate(overlays, start=1):
        raw_text = str(ov.get("text") or "").strip()
        if not raw_text:
            continue

        style_name = f"TextOverlay_{idx}"
        font_name = ov.get("font_family") or ov.get("font_name") or "Arial Black"
        font_size = int(ov.get("font_size", 54))
        text_color = hex_to_ass_color(ov.get("text_color", "#FFFFFF"))
        outline_color = hex_to_ass_color(ov.get("outline_color", "#000000"))
        outline_width = float(ov.get("outline_width", 4.0))
        box_style = ov.get("box_style", "box")
        box_opacity = float(ov.get("box_opacity", 0.65))
        box_alpha = int(round(max(0.0, min(1.0, 1.0 - box_opacity)) * 255))
        back_color = hex_to_ass_color(ov.get("box_color", "#000000"), alpha=box_alpha)
        border_style = 3 if box_style in ("box", "banner") else 1

        pos_pct = float(ov.get("position_y_pct", 15))
        align_h = str(ov.get("alignment", "center")).lower()

        if pos_pct <= 45:
            base_align = 8
            margin_v = int(video_height * (pos_pct / 100.0))
        elif pos_pct >= 65:
            base_align = 2
            margin_v = int(video_height * (1.0 - (pos_pct / 100.0)))
        else:
            base_align = 5
            margin_v = 0

        if align_h == "left":
            align_code = base_align - 1
        elif align_h == "right":
            align_code = base_align + 1
        else:
            align_code = base_align

        # Style definition
        styles.append(
            f"Style: {style_name},{font_name},{font_size},{text_color},&H000000FF&,{outline_color},{back_color},-1,0,0,0,100,100,1,0,{border_style},{outline_width},0,{align_code},60,60,{margin_v},1"
        )

        # Timing
        apply_to_whole = bool(ov.get("apply_to_whole", False))
        start_sec = 0.0 if apply_to_whole else max(0.0, float(ov.get("start_time", 0.0)))
        end_sec = 99999.0 if apply_to_whole else max(start_sec + 0.1, float(ov.get("end_time", 99999.0)))

        # Text transform
        text_transform = ov.get("text_transform", "none")
        if text_transform == "uppercase":
            disp_text = raw_text.upper()
        else:
            disp_text = raw_text

        disp_text = disp_text.replace("\n", "\\N")
        events.append(
            f"Dialogue: 2,{format_ass_timestamp(start_sec)},{format_ass_timestamp(end_sec)},{style_name},,0,0,0,,{disp_text}"
        )

    return styles, events


def build_active_word_ass_content(
    cues: List[Dict[str, Any]],
    style: Optional[Dict[str, Any]] = None,
    video_width: int = 1080,
    video_height: int = 1920,
    overlays: Optional[List[Dict[str, Any]]] = None
) -> str:
    """
    Generate Advanced SubStation Alpha (.ass) subtitle file content with micro-dialogue events
    for voice-synced word-by-word active spoken word tracking (CapCut / Alex Hormozi style).
    - As each word is spoken, it illuminates in highlight_color (e.g. #FFE500 yellow).
    - Inactive / already said words remain in clean primary_color (e.g. #FFFFFF white).
    - Zero horizontal or vertical text jitter; line boundaries remain 100% stable.
    - Also attaches any custom text overlays on a higher layer.
    """
    ass_header, primary_color, highlight_color, text_transform = _generate_ass_header(
        style, video_width, video_height
    )

    extra_styles, extra_events = build_overlay_styles_and_events(overlays, video_width, video_height)
    if extra_styles:
        # Inject styles into header before [Events]
        parts = ass_header.split("[Events]")
        ass_header = parts[0] + "\n".join(extra_styles) + "\n\n[Events]" + parts[1]

    events: List[str] = []
    for cue in cues:
        cue_start = float(cue.get("start", 0.0))
        cue_end = float(cue.get("end", 0.0))
        raw_text = str(cue.get("text", "")).strip()
        if not raw_text or cue_end <= cue_start:
            continue

        # Clean any legacy markup brackets for word tracking
        clean_text = raw_text.replace("[", "").replace("]", "").replace("*", "")
        tokens = [t for t in clean_text.split() if t]
        if not tokens:
            continue

        # Retrieve or synthesize word timestamps
        words = cue.get("words") or []
        if not words or len(words) != len(tokens):
            words = synthesize_word_timestamps(clean_text, cue_start, cue_end)

        if not words:
            continue

        # Format each word token according to text_transform
        transformed_tokens: List[str] = []
        for idx, w in enumerate(words):
            raw_w = str(w.get("word", "")).replace("[", "").replace("]", "").replace("*", "").strip()
            if not raw_w and idx < len(tokens):
                raw_w = tokens[idx]
            if text_transform == "uppercase":
                transformed_tokens.append(raw_w.upper())
            elif text_transform == "title":
                transformed_tokens.append(re.sub(r"[A-Za-z]+('[A-Za-z]+)?", lambda mo: mo.group(0).capitalize(), raw_w))
            else:
                transformed_tokens.append(raw_w)

        num_words = len(words)
        first_word_start = float(words[0].get("start", cue_start))

        # 1. If there is a silence gap before the first word, display full line in primary_color
        if cue_start < first_word_start - 0.05:
            full_base = " ".join(transformed_tokens)
            events.append(
                f"Dialogue: 0,{format_ass_timestamp(cue_start)},{format_ass_timestamp(first_word_start)},Default,,0,0,0,,{full_base}"
            )

        # 2. Emit a micro-event for each active spoken word
        for i in range(num_words):
            w_cur = words[i]
            w_start = float(w_cur.get("start", cue_start))
            w_end = float(w_cur.get("end", cue_end))

            ev_start = max(cue_start, w_start)
            if i + 1 < num_words:
                next_start = float(words[i + 1].get("start", w_end))
                # Next word's start defines boundary to prevent unhighlighted gap
                ev_end = max(ev_start + 0.05, next_start)
            else:
                # Last word stays illuminated until cue_end
                ev_end = max(ev_start + 0.05, cue_end, w_end)

            if ev_end <= ev_start:
                continue

            # Build line text: active word wrapped in highlight color tag, rest in primary color
            line_parts = []
            for j in range(num_words):
                w_str = transformed_tokens[j]
                if j == i:
                    line_parts.append(f"{{\\c{highlight_color}}}{w_str}{{\\c{primary_color}}}")
                else:
                    line_parts.append(w_str)

            line_str = " ".join(line_parts).replace("\n", " ").replace("\\N", " ")
            events.append(
                f"Dialogue: 0,{format_ass_timestamp(ev_start)},{format_ass_timestamp(ev_end)},Default,,0,0,0,,{line_str}"
            )

    # Append overlay events on top
    if extra_events:
        events.extend(extra_events)

    return ass_header + "\n".join(events) + "\n"


def build_ass_content(
    cues: List[Dict[str, Any]],
    style: Optional[Dict[str, Any]] = None,
    video_width: int = 1080,
    video_height: int = 1920,
    overlays: Optional[List[Dict[str, Any]]] = None
) -> str:
    """
    Generate Advanced SubStation Alpha (.ass) subtitle file content
    with full custom styling. Supports active word micro-events, static line highlighting,
    or plain subtitles based on style['highlight_mode'], and custom text overlays.
    """
    style = style or {}
    highlight_mode = style.get("highlight_mode", "active_word")

    # If active word tracking is requested (CapCut / Hormozi style)
    if highlight_mode in ("active_word", "voice_synced"):
        return build_active_word_ass_content(
            cues, style=style, video_width=video_width, video_height=video_height, overlays=overlays
        )

    # Standard static ASS generation
    ass_header, primary_color, highlight_color, text_transform = _generate_ass_header(
        style, video_width, video_height
    )

    extra_styles, extra_events = build_overlay_styles_and_events(overlays, video_width, video_height)
    if extra_styles:
        parts = ass_header.split("[Events]")
        ass_header = parts[0] + "\n".join(extra_styles) + "\n\n[Events]" + parts[1]

    events = []
    for cue in cues:
        start_str = format_ass_timestamp(float(cue.get("start", 0.0)))
        end_str = format_ass_timestamp(float(cue.get("end", 0.0)))
        raw_text = str(cue.get("text", "")).strip()

        if highlight_mode == "disabled":
            # Strip highlight brackets for clean plain subtitles
            clean_text = raw_text.replace("[", "").replace("]", "").replace("*", "")
            if text_transform == "uppercase":
                clean_text = clean_text.upper()
            elif text_transform == "title":
                clean_text = re.sub(r"[A-Za-z]+('[A-Za-z]+)?", lambda mo: mo.group(0).capitalize(), clean_text)
        else:
            clean_text = process_highlight_markup(
                raw_text,
                highlight_color_ass=highlight_color,
                primary_color_ass=primary_color,
                text_transform=text_transform,
                highlight_words=cue.get("highlight_words"),
                cue_highlighted=bool(cue.get("highlighted")),
            )

        clean_text = clean_text.replace("\n", " ").replace("\\N", " ")
        events.append(f"Dialogue: 0,{start_str},{end_str},Default,,0,0,0,,{clean_text}")

    if extra_events:
        events.extend(extra_events)

    return ass_header + "\n".join(events) + "\n"


def build_srt_content(cues: List[Dict[str, Any]], text_transform: str = "none") -> str:
    """Generate standard SRT subtitle text, stripping inline markup for plain SRT."""
    lines = []
    for idx, cue in enumerate(cues, start=1):
        start = format_srt_timestamp(float(cue.get("start", 0.0)))
        end = format_srt_timestamp(float(cue.get("end", 0.0)))
        text = str(cue.get("text", "")).strip()
        # Clean highlight markup brackets for plain SRT
        text = re.sub(r"\[([^\]]+)\]", r"\1", text)
        text = re.sub(r"\*([^\*]+)\*", r"\1", text)
        if text_transform == "uppercase":
            text = text.upper()
        elif text_transform == "title":
            text = text.title()
        lines.append(f"{idx}\n{start} --> {end}\n{text}\n")
    return "\n".join(lines)


def probe_video_duration(video_path: Path) -> float:
    """Get video duration in seconds using ffprobe."""
    try:
        cmd = [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(video_path),
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        return float(res.stdout.strip())
    except Exception:
        return 0.0


def burn_subtitles_to_clip(
    input_video: Path,
    output_video: Path,
    cues: List[Dict[str, Any]],
    style: Optional[Dict[str, Any]] = None,
    overlays: Optional[List[Dict[str, Any]]] = None,
    progress_callback: Optional[Callable[[float, float], None]] = None,
) -> Path:
    """
    Burn custom styled ASS subtitles and text overlays into video using FFmpeg.
    Supports real-time frame/second progress callbacks.
    """
    if not input_video.exists():
        raise FileNotFoundError(f"Input video not found: {input_video}")

    total_duration = probe_video_duration(input_video)

    ass_path = input_video.with_suffix(".temp.ass")
    try:
        ass_content = build_ass_content(cues, style=style, overlays=overlays)
        with open(ass_path, "w", encoding="utf-8") as f:
            f.write(ass_content)

        # Escape path for FFmpeg filter syntax
        escaped_ass = str(ass_path).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")

        cmd = [
            "ffmpeg", "-y",
            "-hide_banner",
            "-nostats",
            "-loglevel", "error",
            "-progress", "pipe:1",
            "-i", str(input_video),
            "-vf", f"ass='{escaped_ass}'",
            "-c:v", "libx264",
            "-crf", "20",
            "-preset", "fast",
            "-c:a", "copy",
            str(output_video)
        ]

        logger.info("Burning subtitles into %s...", output_video.name)
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            errors="replace",
        )

        stderr_lines = []

        def _drain_stderr():
            try:
                for l in proc.stderr:
                    stderr_lines.append(l)
            except Exception:
                pass

        t_err = threading.Thread(target=_drain_stderr, daemon=True)
        t_err.start()

        last_update = 0.0

        while True:
            line = proc.stdout.readline()
            if not line:
                if proc.poll() is not None:
                    break
                time.sleep(0.01)
                continue

            line = line.strip()
            if line.startswith("out_time_us="):
                try:
                    us = int(line.split("=")[1])
                    secs = us / 1_000_000.0
                    now = time.time()
                    if progress_callback and (now - last_update >= 0.25 or (total_duration > 0 and secs >= total_duration)):
                        last_update = now
                        progress_callback(secs, total_duration)
                except Exception:
                    pass
            elif line == "progress=end":
                if progress_callback and total_duration > 0:
                    progress_callback(total_duration, total_duration)
                break

        try:
            proc.wait(timeout=5)
        except Exception:
            pass
        t_err.join(timeout=1)

        if proc.returncode != 0:
            err_msg = "".join(stderr_lines).strip()
            logger.error("FFmpeg burning error: %s", err_msg)
            raise RuntimeError(f"FFmpeg subtitle burning failed: {err_msg}")

        return output_video

    finally:
        if ass_path.exists():
            try:
                ass_path.unlink(missing_ok=True)
            except Exception:
                pass

