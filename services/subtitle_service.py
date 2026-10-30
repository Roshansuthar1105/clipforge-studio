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


def build_ass_content(
    cues: List[Dict[str, Any]],
    style: Optional[Dict[str, Any]] = None,
    video_width: int = 1080,
    video_height: int = 1920
) -> str:
    """
    Generate Advanced SubStation Alpha (.ass) subtitle file content
    with full custom styling (font, color, stroke, background, positioning, highlight).
    """
    style = style or {}
    font_name = style.get("font_name", "Arial Black")
    font_size = int(style.get("font_size", 68))
    primary_color = hex_to_ass_color(style.get("text_color", "#FFFFFF"))
    highlight_color = hex_to_ass_color(style.get("highlight_color", "#FFE500"))
    outline_color = hex_to_ass_color(style.get("outline_color", "#000000"))
    outline_width = float(style.get("outline_width", 4.0))
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

    events = []
    for cue in cues:
        start_str = format_ass_timestamp(float(cue.get("start", 0.0)))
        end_str = format_ass_timestamp(float(cue.get("end", 0.0)))
        raw_text = str(cue.get("text", "")).strip()

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
        escaped_ass = str(ass_path).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")

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

