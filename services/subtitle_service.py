"""
services/subtitle_service.py — Subtitle Styling, ASS Generation & FFmpeg Video Burner
Supports custom font family, colors, outline, text transform (UPPERCASE), and vertical positioning.
"""

from __future__ import annotations

import os
import re
import logging
import subprocess
from pathlib import Path
from typing import Optional, Any, Dict, List

logger = logging.getLogger("clipforge.subtitles")

APP_DIR = Path(__file__).resolve().parent.parent
BASE_DIR = Path(os.getenv("DATA_DIR", str(APP_DIR / "data"))).resolve()
CLIPS_DIR = BASE_DIR / "clips"


def hex_to_ass_color(hex_str: str, alpha: int = 0) -> str:
    """Convert standard #RRGGBB to ASS &HAABBGGRR& format."""
    hex_str = hex_str.strip().lstrip("#")
    if len(hex_str) == 6:
        r, g, b = hex_str[0:2], hex_str[2:4], hex_str[4:6]
        return f"&H{alpha:02X}{b}{g}{r}&"
    return f"&H{alpha:02X}FFFFFF&"


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


def build_ass_content(
    cues: List[Dict[str, Any]],
    style: Optional[Dict[str, Any]] = None,
    video_width: int = 1080,
    video_height: int = 1920
) -> str:
    """
    Generate Advanced SubStation Alpha (.ass) subtitle file content
    with full custom styling (font, color, stroke, background, positioning).
    """
    style = style or {}
    font_name = style.get("font_name", "Arial Black")
    font_size = int(style.get("font_size", 68))
    primary_color = hex_to_ass_color(style.get("text_color", "#FFFFFF"))
    outline_color = hex_to_ass_color(style.get("outline_color", "#000000"))
    outline_width = float(style.get("outline_width", 4.0))
    shadow_depth = float(style.get("shadow_depth", 1.5))
    text_transform = style.get("text_transform", "uppercase")
    box_style = style.get("box_style", "none")  # none, box, pill

    # Position alignment in ASS:
    # 2 = Bottom Center, 5 = Middle Center, 8 = Top Center
    pos_preset = style.get("position_preset", "bottom")
    if pos_preset == "top":
        alignment = 8
        margin_v = int(style.get("margin_v", 180))
    elif pos_preset == "middle":
        alignment = 5
        margin_v = int(style.get("margin_v", 0))
    else:  # bottom default
        alignment = 2
        margin_v = int(style.get("margin_v", 220))

    # Border style: 1 = outline + drop shadow, 3 = opaque box
    border_style = 3 if box_style in ("box", "pill") else 1
    back_color = hex_to_ass_color(style.get("box_color", "#000000"), alpha=120)

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

    events = []
    for cue in cues:
        start_str = format_ass_timestamp(float(cue.get("start", 0.0)))
        end_str = format_ass_timestamp(float(cue.get("end", 0.0)))
        raw_text = str(cue.get("text", "")).strip()

        if text_transform == "uppercase":
            raw_text = raw_text.upper()
        elif text_transform == "title":
            raw_text = raw_text.title()

        # Clean newlines for ASS
        clean_text = raw_text.replace("\n", " ").replace("\\N", " ")
        events.append(f"Dialogue: 0,{start_str},{end_str},Default,,0,0,0,,{clean_text}")

    return ass_header + "\n".join(events) + "\n"


def build_srt_content(cues: List[Dict[str, Any]], text_transform: str = "none") -> str:
    """Generate standard SRT subtitle text."""
    lines = []
    for idx, cue in enumerate(cues, start=1):
        start = format_srt_timestamp(float(cue.get("start", 0.0)))
        end = format_srt_timestamp(float(cue.get("end", 0.0)))
        text = str(cue.get("text", "")).strip()
        if text_transform == "uppercase":
            text = text.upper()
        elif text_transform == "title":
            text = text.title()
        lines.append(f"{idx}\n{start} --> {end}\n{text}\n")
    return "\n".join(lines)


def burn_subtitles_to_clip(
    input_video: Path,
    output_video: Path,
    cues: List[Dict[str, Any]],
    style: Optional[Dict[str, Any]] = None
) -> Path:
    """
    Burn custom styled ASS subtitles into video using FFmpeg.
    """
    if not input_video.exists():
        raise FileNotFoundError(f"Input video not found: {input_video}")

    ass_path = input_video.with_suffix(".temp.ass")
    try:
        ass_content = build_ass_content(cues, style=style)
        with open(ass_path, "w", encoding="utf-8") as f:
            f.write(ass_content)

        # Escape path for FFmpeg filter syntax
        escaped_ass = str(ass_path).replace("\\", "/").replace(":", "\\:")

        cmd = [
            "ffmpeg", "-y",
            "-hide_banner",
            "-loglevel", "error",
            "-i", str(input_video),
            "-vf", f"ass='{escaped_ass}'",
            "-c:v", "libx264",
            "-crf", "20",
            "-preset", "fast",
            "-c:a", "copy",
            str(output_video)
        ]

        logger.info("Burning subtitles into %s...", output_video.name)
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if res.returncode != 0:
            logger.error("FFmpeg burning error: %s", res.stderr)
            raise RuntimeError(f"FFmpeg subtitle burning failed: {res.stderr.strip()}")

        return output_video

    finally:
        if ass_path.exists():
            try:
                ass_path.unlink(missing_ok=True)
            except Exception:
                pass

