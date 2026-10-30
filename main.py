
import os
import re
import sys
import time
import uuid
import math
import shutil
import asyncio
import logging
import threading
import subprocess
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urlunparse, quote, unquote
import urllib.parse

import yt_dlp
from typing import Optional, Any, Callable, List, Dict
import datetime
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

# --------------------------------------------------
# LOGGING
# --------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)


# --------------------------------------------------
# PATHS AND CONFIGURATION
# --------------------------------------------------

APP_DIR = Path(__file__).resolve().parent
BASE_DIR = Path(os.getenv("DATA_DIR", str(APP_DIR / "data")).resolve()) if False else Path(
    os.getenv("DATA_DIR", str(APP_DIR / "data"))
).resolve()

DOWNLOAD_DIR = BASE_DIR / "downloads"
CLIPS_DIR = BASE_DIR / "clips"
STATIC_DIR = APP_DIR / "static"

for folder in (DOWNLOAD_DIR, CLIPS_DIR, STATIC_DIR):
    folder.mkdir(parents=True, exist_ok=True)

from fastapi import Header
import db
from routers.auth_router import router as auth_router, get_current_user_optional
from routers.accounts_router import router as accounts_router
from routers.publish_router import router as publish_router
from routers.meta_publish_router import router as meta_publish_router
from routers.subtitles_router import router as subtitles_router
from routers.viral_router import router as viral_router

app = FastAPI(title="ClipForge Studio")

logger = logging.getLogger("clipforge")

def organize_clips_into_video_folders():
    """Ensure all clips in data/clips/my_clips are organized into separate video folders."""
    my_clips_dir = CLIPS_DIR / "my_clips"
    if not my_clips_dir.exists():
        return
    try:
        for file in list(my_clips_dir.glob("*.mp4")):
            if not file.is_file():
                continue
            stem = file.stem
            match = re.split(r"(_part_\d+|- part \d+|__part\d+)", stem, flags=re.IGNORECASE)
            raw_title = match[0].strip() if len(match) > 1 else stem.strip()
            raw_title = re.sub(r"[_\-]+$", "", raw_title).strip()
            folder_name = safe_name(raw_title or "Untitled")
            target_folder = my_clips_dir / folder_name
            target_folder.mkdir(parents=True, exist_ok=True)
            target_file = target_folder / file.name
            try:
                shutil.move(str(file), str(target_file))
            except Exception:
                continue
            for comp in list(my_clips_dir.glob(f"{file.name}*")):
                if comp.is_file() and comp != file:
                    try:
                        shutil.move(str(comp), str(target_folder / comp.name))
                    except Exception:
                        pass
            for comp in list(my_clips_dir.glob(f"{file.stem}.*")):
                if comp.is_file() and comp.suffix != ".mp4":
                    try:
                        shutil.move(str(comp), str(target_folder / comp.name))
                    except Exception:
                        pass
    except Exception as exc:
        logger.warning("Auto-organizing clips encountered error: %s", exc)

@app.on_event("startup")
async def on_startup():
    # Suppress harmless Windows asyncio ConnectionResetError (WinError 10054) when client closes video streams
    if sys.platform == "win32":
        try:
            loop = asyncio.get_running_loop()
            original_handler = loop.get_exception_handler()

            def win_asyncio_exception_handler(loop, context):
                exc = context.get("exception")
                if isinstance(exc, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
                    return
                msg = str(context.get("message", ""))
                if "WinError 10054" in msg or "10054" in str(exc):
                    return
                if original_handler:
                    original_handler(loop, context)
                else:
                    loop.default_exception_handler(context)

            loop.set_exception_handler(win_asyncio_exception_handler)
        except Exception:
            pass

    organize_clips_into_video_folders()
    if db.is_db_connected():
        cleaned = db.db_cleanup_stale_jobs()
        if cleaned > 0:
            logger.info("Cleaned up %d stale job(s) from previous server run", cleaned)

app.include_router(auth_router)
app.include_router(accounts_router)
app.include_router(publish_router)
app.include_router(meta_publish_router)
app.include_router(subtitles_router)
app.include_router(viral_router)

app.mount(
    "/static",
    StaticFiles(directory=str(STATIC_DIR)),
    name="static",
)

jobs = {}
jobs_lock = threading.Lock()
job_output_dirs = {}
job_cancel_events: dict[str, threading.Event] = {}



# --------------------------------------------------
# REQUEST SETTINGS
# --------------------------------------------------

class ClipRequest(BaseModel):
    url: str = ""
    title: str = "My Video"
    video_title: str | None = None
    source_title: str | None = None
    source_file: str | None = None

    clip_length: int = Field(default=30, ge=1, le=600)
    max_clips: int = Field(default=5, ge=1, le=100)
    count: int | None = None

    start_seconds: int = Field(default=0, ge=0)
    start_time: float | None = None
    end_seconds: int | None = Field(default=None, ge=1)
    end_time: float | None = None

    download_folder: str = "downloads"
    clips_folder: str = "my_clips"

    # Optional filename for the downloaded source.
    source_name: str | None = None

    # Optional absolute output folder.
    output_path: str | None = None

    aspect_ratio: str = "9:16"
    show_title: bool = True
    show_parts: bool = True
    keep_source: bool = True

    title_y: int = 180
    part_y: int | None = None
    title_font_size: int = 48
    part_font_size: int = 34
    title_font_color: str = "white"
    part_font_color: str = "white"
    title_box_color: str = "black@0.45"
    part_box_color: str = "black@0.40"
    part_format: str = "Part {part}"

    # Alignment & Horizontal Coordinates (center, left, right)
    title_alignment: str = "center"
    part_alignment: str = "center"
    title_x: Optional[int] = None
    part_x: Optional[int] = None

    # "blur" for cinematic blurred 9:16 background, "black" for classic bars.
    background_style: str = "blur"

    # When True, generate only the first clip (fast preview / test render).
    is_preview: bool = False

    # AI Viral Moments Integration (Auto-Opus Clip)
    slicing_mode: str = "fixed"  # "fixed" or "ai_viral"
    moments: Optional[List[Dict[str, Any]]] = None

    # AI Hook Integration (Prepend 1-6s Climax / Curiosity Teaser)
    prepend_hook: bool = False
    hook_duration: float = 3.5
    hook_badge: str = "WAIT FOR IT..."

    # Subtitle Automation (Auto-burn animated word subtitles into reel)
    burn_subtitles: bool = False

    def model_post_init(self, __context):
        if self.count is not None:
            self.max_clips = self.count
        else:
            self.count = self.max_clips

        if self.start_time is not None:
            self.start_seconds = int(self.start_time)
        if self.end_time is not None:
            self.end_seconds = int(self.end_time)


# --------------------------------------------------
# UTILITIES
# --------------------------------------------------

def clean_error_message(err_msg: str) -> str:
    """Strip ANSI color codes and clean up error messages."""
    clean = re.sub(r"\x1b\[[0-9;]*[a-zA-Z]", "", err_msg)
    clean = re.sub(r"\[[0-9;]*m", "", clean)
    clean = clean.replace("ERROR: ", "").strip()
    return clean


def get_yt_dlp_options(
    extra_opts: dict | None = None,
    player_clients: list[str] | None = None,
) -> dict:
    """
    Build yt-dlp options configured to bypass YouTube bot detection checks
    using mobile player API clients (android/ios) and optional cookies.txt.
    """
    clients = player_clients or ["android", "ios", "mweb"]
    opts: dict = {
        "quiet": True,
        "no_warnings": True,
        "extractor_args": {
            "youtube": {
                "player_client": clients
            }
        },
    }

    # Enable Node.js as JavaScript runtime if installed
    node_path = shutil.which("node")
    if node_path:
        opts["js_runtimes"] = {"node": {}}

    # Automatically detect cookies.txt file
    cookie_candidates = [
        os.getenv("YTDLP_COOKIES"),
        os.getenv("COOKIES_FILE"),
        APP_DIR / "cookies.txt",
        BASE_DIR / "cookies.txt",
        Path("cookies.txt"),
    ]
    for candidate in cookie_candidates:
        if candidate:
            cand_path = Path(candidate).resolve()
            if cand_path.exists() and cand_path.is_file():
                opts["cookiefile"] = str(cand_path)
                break

    if extra_opts:
        opts.update(extra_opts)

    return opts


def safe_name(value: str) -> str:
    """Remove characters that are unsafe in Windows filenames."""
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value)
    value = re.sub(r"\s+", " ", value).strip(" .")
    return value[:100] or "video"


def clean_source_video_title(stem: str) -> str:
    """Extract a clean human-readable title from a video filename stem or title."""
    if not stem:
        return "Video"
    s = re.sub(r"\s*\[[a-zA-Z0-9_-]{11}\]", "", str(stem)).strip()
    s = re.sub(r"_[a-zA-Z0-9_-]{11}$", "", s).strip()
    s = s.replace("_", " ").strip()
    s = re.sub(r"[-_\s]+(part|viral)[-_\s]*\d*$", "", s, flags=re.IGNORECASE).strip()
    s = re.sub(r"[-_\s]+ai\s*generated$", "", s, flags=re.IGNORECASE).strip()
    return s[:80].strip() or "Video"


def resolve_ai_viral_folder_name(
    request: ClipRequest,
    source_path: Optional[Path] = None,
    info: Optional[Dict[str, Any]] = None
) -> str:
    """
    Resolve the destination folder name for AI generated viral clips:
    Format: '[video title] - ai generated'
    """
    v_title = getattr(request, "video_title", None) or getattr(request, "source_title", None)
    if not v_title and request.title:
        t = str(request.title).strip()
        if t.lower() not in ("viral highlights", "my video", "untitled", "clip", "video"):
            v_title = t
    if not v_title and info and info.get("title"):
        v_title = clean_source_video_title(info["title"])
    if not v_title and source_path:
        v_title = clean_source_video_title(source_path.stem)
    if not v_title:
        v_title = "Video"

    clean_base = clean_source_video_title(v_title)
    return f"{clean_base} - ai generated"


def extract_video_id(url: str) -> str | None:
    """
    Extract the YouTube video ID from any supported URL form:
      https://www.youtube.com/watch?v=XXXXXXXXXXX
      https://youtu.be/XXXXXXXXXXX
      https://www.youtube.com/shorts/XXXXXXXXXXX
    Returns the 11-character ID, or None if it cannot be parsed.
    """
    url = url.strip()
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()

    # youtu.be short links
    if host in ("youtu.be", "www.youtu.be"):
        vid = parsed.path.lstrip("/").split("/")[0].split("?")[0]
        return vid if len(vid) == 11 else None

    # /shorts/<id>
    if "/shorts/" in parsed.path:
        vid = parsed.path.split("/shorts/")[1].split("/")[0].split("?")[0]
        return vid if len(vid) == 11 else None

    # /watch?v=<id>
    qs = parse_qs(parsed.query)
    vids = qs.get("v", [])
    if vids:
        vid = vids[0]
        return vid if len(vid) == 11 else None

    return None


def find_file_in_dir(directory: Path, filename: str) -> Path | None:
    """Find a file by exact, relative subpath, or URL-unquoted name in directory or subdirectories."""
    if not directory.exists():
        return None
    import urllib.parse
    clean_name = urllib.parse.unquote(filename).replace("\\", "/").strip("/")
    safe_target = Path(clean_name).name
    raw_target = Path(filename).name

    # Check direct relative path from directory first
    try:
        direct_sub = directory / clean_name
        if direct_sub.is_file():
            return direct_sub
        direct_sub_raw = directory / filename.replace("\\", "/").strip("/")
        if direct_sub_raw.is_file():
            return direct_sub_raw
    except Exception:
        pass

    direct = directory / safe_target
    if direct.is_file():
        return direct
    direct_raw = directory / raw_target
    if direct_raw.is_file():
        return direct_raw

    for p in directory.rglob("*"):
        if p.is_file() and (p.name == safe_target or p.name == raw_target):
            return p
    return None


def ensure_clip_thumbnail(clip_path: Path) -> Path | None:
    """Generate and cache a 9:16 vertical JPEG thumbnail for a video clip."""
    if not clip_path.exists() or not clip_path.is_file():
        return None
    thumb_path = clip_path.with_name(f"{clip_path.stem}.thumb.jpg")
    if thumb_path.exists() and thumb_path.stat().st_size > 0:
        return thumb_path

    try:
        cmd = [
            "ffmpeg", "-y", "-ss", "00:00:01", "-i", str(clip_path),
            "-vframes", "1",
            "-vf", "scale=180:320:force_original_aspect_ratio=decrease,pad=180:320:(ow-iw)/2:(oh-ih)/2:black",
            "-q:v", "3", str(thumb_path)
        ]
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
        if not thumb_path.exists() or thumb_path.stat().st_size == 0:
            cmd_fallback = [
                "ffmpeg", "-y", "-ss", "00:00:00", "-i", str(clip_path),
                "-vframes", "1",
                "-vf", "scale=180:320:force_original_aspect_ratio=decrease,pad=180:320:(ow-iw)/2:(oh-ih)/2:black",
                "-q:v", "3", str(thumb_path)
            ]
            subprocess.run(cmd_fallback, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)

        if thumb_path.exists() and thumb_path.stat().st_size > 0:
            return thumb_path
    except Exception as e:
        logger.warning("Could not generate thumbnail for %s: %s", clip_path.name, e)
    return None


def find_cached_source(download_folder: Path, video_id: str) -> Path | None:
    """
    Search *download_folder* for a previously downloaded file whose name
    contains *[video_id]* and whose size is greater than zero.
    Returns the Path if found, else None.
    """
    pattern = rf"*\[{video_id}\]*"
    for p in download_folder.glob(f"*{video_id}*"):
        if p.is_file() and p.stat().st_size > 0 and p.suffix.lower() in (".mp4", ".mkv", ".webm"):
            return p
    return None


def check_url(url: str):
    """Accept standard YouTube video URLs only."""
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower()

    allowed_hosts = {
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtu.be",
        "www.youtu.be",
        "youtube-nocookie.com",
        "www.youtube-nocookie.com",
    }

    if parsed.scheme not in ("http", "https") or host not in allowed_hosts:
        raise HTTPException(
            status_code=400,
            detail="Please provide a valid YouTube URL.",
        )


def run_command(command: list[str], cancel_event: Optional[threading.Event] = None) -> str:
    """Run a command and return useful error output, supporting responsive cancellation."""
    try:
        proc = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            errors="replace",
        )
    except FileNotFoundError as error:
        raise RuntimeError(
            f"Required program was not found: {command[0]}. "
            "Install FFmpeg and make sure ffmpeg.exe and "
            "ffprobe.exe are available in PATH."
        ) from error

    stdout, stderr = "", ""
    while proc.poll() is None:
        if cancel_event and cancel_event.is_set():
            try:
                proc.terminate()
                proc.wait(timeout=2)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
            raise RuntimeError("Process cancelled by user")
        try:
            out, err = proc.communicate(timeout=0.2)
            stdout += out or ""
            stderr += err or ""
            break
        except subprocess.TimeoutExpired:
            pass

    if proc.returncode is None:
        proc.poll()
    if proc.returncode is not None and proc.returncode != 0:
        message = (stderr or stdout or "Command failed").strip()
        raise RuntimeError(message[-4000:])

    return (stdout or "").strip()


def run_ffmpeg_with_progress(
    command: list[str],
    total_duration: float,
    on_progress: Optional[Any] = None,
    cancel_event: Optional[threading.Event] = None,
) -> str:
    """Run FFmpeg with real-time second-by-second progress tracking and cancel support."""
    # Ensure -nostats, -loglevel error, and -progress pipe:1 are inserted before input args
    full_cmd = [command[0], "-nostats", "-loglevel", "error", "-progress", "pipe:1", *command[1:]]
    try:
        proc = subprocess.Popen(
            full_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            errors="replace",
        )
    except FileNotFoundError as error:
        raise RuntimeError(
            f"Required program was not found: {command[0]}. "
            "Install FFmpeg and make sure ffmpeg.exe and "
            "ffprobe.exe are available in PATH."
        ) from error

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
        if cancel_event and cancel_event.is_set():
            try:
                proc.terminate()
                proc.wait(timeout=2)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
            raise RuntimeError("Process cancelled by user")

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
                if on_progress and (now - last_update >= 0.25 or secs >= total_duration):
                    last_update = now
                    on_progress(secs, total_duration)
            except Exception:
                pass
        elif line == "progress=end":
            if on_progress:
                on_progress(total_duration, total_duration)
            break

    try:
        proc.wait(timeout=5)
    except Exception:
        pass
    t_err.join(timeout=1)

    if proc.returncode != 0:
        message = "".join(stderr_lines).strip() or "FFmpeg encoding failed"
        raise RuntimeError(message[-4000:])

    return ""


def probe_duration(video_path: Path) -> float:
    output = run_command([
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(video_path),
    ])

    try:
        duration = float(output)
    except ValueError as error:
        raise RuntimeError(
            f"Could not read video duration: {video_path.name}"
        ) from error

    if not math.isfinite(duration) or duration <= 0:
        raise RuntimeError("The downloaded video has an invalid duration.")

    return duration


def has_audio_stream(video_path: Path) -> bool:
    """Check if video file contains at least one audio stream."""
    try:
        output = run_command([
            "ffprobe",
            "-v", "error",
            "-select_streams", "a:0",
            "-show_entries", "stream=codec_type",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(video_path),
        ])
        return bool(output.strip())
    except Exception:
        return True


def contains_emoji(text: str) -> bool:
    """Check if the text contains any emoji or pictorial symbols."""
    for char in text:
        cp = ord(char)
        if (
            0x1F600 <= cp <= 0x1F64F  # Emoticons
            or 0x1F300 <= cp <= 0x1F5FF  # Misc Symbols and Pictographs
            or 0x1F680 <= cp <= 0x1F6FF  # Transport and Map
            or 0x1F700 <= cp <= 0x1F77F  # Alchemical Symbols
            or 0x1F780 <= cp <= 0x1F7FF  # Geometric Shapes Extended
            or 0x1F800 <= cp <= 0x1F8FF  # Supplemental Arrows-C
            or 0x1F900 <= cp <= 0x1F9FF  # Supplemental Symbols and Pictographs (🤫, 🥳, etc.)
            or 0x1FA00 <= cp <= 0x1FA6F  # Chess Symbols
            or 0x1FA70 <= cp <= 0x1FAFF  # Symbols and Pictographs Extended-A
            or 0x2600 <= cp <= 0x26FF    # Misc symbols (⚡, ☀️, ☔, etc.)
            or 0x2700 <= cp <= 0x27BF    # Dingbats (✨, ✂️, etc.)
            or 0xFE00 <= cp <= 0xFE0F    # Variation Selectors
            or 0x1F1E6 <= cp <= 0x1F1FF  # Flags / regional indicators
        ):
            return True
    return False


def contains_devanagari(text: str) -> bool:
    """Check if the text contains Hindi / Devanagari script."""
    return any(0x0900 <= ord(c) <= 0x097F for c in text)


def find_windows_font(text: str = "") -> Path:
    """
    Find the best font on Windows or Linux to render the given text without tofu boxes ([]).
    - If text contains Emojis (e.g. 'WAIT FOR IT... 🤫'): Use Segoe UI Emoji / Noto Color Emoji.
    - If text contains Hindi / Devanagari (e.g. 'खुश हूँ'): Use Mangal / Nirmala UI.
    - Otherwise: Use Arial Bold / DejaVu Sans Bold.
    """
    windir = Path(os.environ.get("WINDIR", r"C:\Windows"))
    text_str = str(text or "")

    # If text has emojis, Segoe UI Emoji has both emoji glyphs AND full English/Latin characters
    if contains_emoji(text_str):
        emoji_candidates = [
            windir / "Fonts" / "seguiemj.ttf",
            windir / "Fonts" / "seguisym.ttf",
            Path("/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf"),
            Path("/usr/share/fonts/truetype/ancient-scripts/Symbola.ttf"),
        ]
        for c in emoji_candidates:
            if c.exists():
                return c

    # If text has Hindi / Devanagari script
    if contains_devanagari(text_str):
        devanagari_candidates = [
            windir / "Fonts" / "mangalb.ttf",
            windir / "Fonts" / "mangal.ttf",
            windir / "Fonts" / "Nirmala.ttc",
            Path("/usr/share/fonts/truetype/lohit-devanagari/Lohit-Devanagari.ttf"),
            Path("/usr/share/fonts/truetype/noto/NotoSansDevanagari-Bold.ttf"),
        ]
        for c in devanagari_candidates:
            if c.exists():
                return c

    # Default bold Latin font
    candidates = [
        windir / "Fonts" / "arialbd.ttf",
        windir / "Fonts" / "arial.ttf",
        windir / "Fonts" / "segoeuib.ttf",
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]

    for candidate in candidates:
        if candidate.exists():
            return candidate

    # Fallback to Segoe UI Emoji or Arial if standard bold isn't found
    fallbacks = [
        windir / "Fonts" / "seguiemj.ttf",
        windir / "Fonts" / "arial.ttf",
    ]
    for c in fallbacks:
        if c.exists():
            return c

    raise RuntimeError(
        "No supported font was found. Install Arial, Segoe UI Emoji, or DejaVu Sans."
    )


def escape_filter_path(path: Path) -> str:
    """Escape a Windows path for FFmpeg filter syntax."""
    return str(path).replace("\\", "/").replace(":", r"\:")


def escape_drawtext(value: str) -> str:
    """Escape special characters used in FFmpeg drawtext text."""
    value = value.replace("\\", r"\\")
    value = value.replace(":", r"\:")
    value = value.replace("'", r"\'")
    value = value.replace("%", r"\%")
    value = value.replace(",", r"\,")
    value = value.replace("[", r"\[")
    value = value.replace("]", r"\]")
    return value


def update_job(job_id: str, **values):
    with jobs_lock:
        if job_id in jobs:
            # Prevent overwriting a cancelled job with completed/failed
            if jobs[job_id].get("status") == "cancelled" and values.get("status") not in (None, "cancelled"):
                return
            jobs[job_id].update(values)
            jobs[job_id]["updated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            if db.is_db_connected():
                try:
                    db.db_save_job(jobs[job_id])
                except Exception:
                    pass


# --------------------------------------------------
# VIDEO PROCESSING
# --------------------------------------------------

def process_job(job_id: str, request: ClipRequest, cancel_event: Optional[threading.Event] = None):
    source_path = None
    downloaded_by_job = False

    try:
        update_job(
            job_id,
            status="downloading",
            progress=5,
            message="Preparing folders",
        )

        download_folder = DOWNLOAD_DIR / safe_name(
            request.download_folder
        )
        download_folder.mkdir(parents=True, exist_ok=True)

        is_ai_viral = (getattr(request, "slicing_mode", "fixed") == "ai_viral") or bool(getattr(request, "moments", None))

        if request.output_path and request.output_path.strip():
            output_folder = Path(
                os.path.expandvars(
                    os.path.expanduser(request.output_path.strip())
                )
            ).resolve()
        elif is_ai_viral:
            # For AI generated clips of a video, save in '[video title] - ai generated' folder
            viral_folder_name = resolve_ai_viral_folder_name(request)
            output_folder = CLIPS_DIR / safe_name(
                request.clips_folder
            ) / safe_name(viral_folder_name)
        else:
            raw_title_clean = re.sub(r"[_\-\s]*\{part\}", "", request.title or "Untitled", flags=re.IGNORECASE).strip()
            raw_title_clean = re.sub(r"[_\-\s]+part[_\-\s]*$", "", raw_title_clean, flags=re.IGNORECASE).strip()
            video_folder_name = safe_name(raw_title_clean or "Untitled")
            output_folder = CLIPS_DIR / safe_name(
                request.clips_folder
            ) / video_folder_name

        output_folder.mkdir(parents=True, exist_ok=True)
        job_output_dirs[job_id] = output_folder

        # --------------------------------------------------
        # Derive a stable, video-unique filename or reuse existing source
        # --------------------------------------------------
        if request.source_file:
            source_path = find_file_in_dir(DOWNLOAD_DIR, request.source_file)
            if not source_path:
                raise RuntimeError(f"Source file '{Path(request.source_file).name}' not found in downloads folder.")
            update_job(
                job_id,
                progress=18,
                message=f"Using downloaded source: {source_path.name}",
            )
        else:
            video_id = extract_video_id(request.url)

            # Check if we already have this exact video on disk
            cached = find_cached_source(download_folder, video_id) if video_id else None

            if cached:
                source_path = cached
                update_job(
                    job_id,
                    progress=35,
                    message=f"Reusing cached source: {cached.name}",
                )
            else:
                # Build a filename: "<safe-title> [<video_id>]" or fall back to source_name
                if video_id:
                    # We'll let yt-dlp fill in the real title; use a placeholder outtmpl
                    # that guarantees the video_id is always in the filename.
                    outtmpl_name = f"%(title).80s [{video_id}].%(ext)s"
                else:
                    outtmpl_name = f"{safe_name(request.source_name or 'source')}.%(ext)s"

                update_job(
                    job_id,
                    progress=10,
                    message="Downloading source video",
                )

                def dl_progress_hook(d):
                    if cancel_event and cancel_event.is_set():
                        raise RuntimeError("Download cancelled by user")
                    if d.get("status") == "downloading":
                        total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                        downloaded = d.get("downloaded_bytes") or 0
                        if total > 0:
                            pct = int(10 + (downloaded / total) * 25)
                            mb_down = downloaded / (1024 * 1024)
                            mb_tot = total / (1024 * 1024)
                            pct_dl = int((downloaded / total) * 100)
                            update_job(
                                job_id,
                                progress=min(35, pct),
                                message=f"Downloading source: {mb_down:.1f}/{mb_tot:.1f} MB ({pct_dl}%)",
                            )

                base_dl_opts = {
                    "format": (
                        "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/"
                        "bestvideo[height<=1080]+bestaudio/"
                        "best[height<=1080]/best"
                    ),
                    "merge_output_format": "mp4",
                    "outtmpl": str(download_folder / outtmpl_name),
                    "noplaylist": True,
                    "restrictfilenames": True,
                    "windowsfilenames": True,
                    "progress_hooks": [dl_progress_hook],
                }

                download_success = False
                last_dl_error = None
                prepared_name = None
                client_candidates = [
                    ["android", "ios"],
                    ["android"],
                    ["ios"],
                    ["tv", "mweb"],
                    None,
                ]

                for dl_clients in client_candidates:
                    try:
                        current_opts = get_yt_dlp_options(
                            extra_opts=base_dl_opts,
                            player_clients=dl_clients,
                        )
                        with yt_dlp.YoutubeDL(current_opts) as downloader:
                            info = downloader.extract_info(
                                request.url.strip(),
                                download=True,
                            )
                            prepared_name = downloader.prepare_filename(info)
                            download_success = True
                            break
                    except Exception as dl_err:
                        last_dl_error = dl_err
                        continue

                if not download_success or not prepared_name:
                    err_msg = clean_error_message(str(last_dl_error or "Unknown download failure"))
                    if "bot" in err_msg.lower() or "sign in" in err_msg.lower():
                        err_msg = (
                            f"{err_msg} (YouTube bot check triggered. "
                            "Place a 'cookies.txt' file in the ClipForge folder or set COOKIES_FILE to authenticate.)"
                        )
                    raise RuntimeError(f"Download failed: {err_msg}")

                # yt-dlp may change the extension after merging streams.
                guessed = Path(prepared_name)
                possible_paths: list[Path] = [guessed, guessed.with_suffix(".mp4")]

                if not any(p.exists() for p in possible_paths):
                    # Fall back: scan the folder for any file containing the video ID
                    if video_id:
                        possible_paths += [
                            p for p in download_folder.glob(f"*{video_id}*") if p.is_file()
                        ]
                    possible_paths += [
                        p for p in download_folder.glob("*") if p.is_file()
                        and p.suffix.lower() in (".mp4", ".mkv", ".webm")
                    ]

                source_path = next(
                    (p for p in possible_paths if p.exists() and p.stat().st_size > 0),
                    None,
                )

                if source_path is None:
                    raise RuntimeError(
                        "Download finished, but the source video file could not be found."
                    )

                downloaded_by_job = True

        # For AI viral clips: refine output_folder using the resolved source video title
        if is_ai_viral and not (request.output_path and request.output_path.strip()):
            refined_folder_name = resolve_ai_viral_folder_name(request, source_path=source_path)
            refined_folder = CLIPS_DIR / safe_name(request.clips_folder) / safe_name(refined_folder_name)
            if refined_folder != output_folder:
                try:
                    if output_folder.exists() and not any(output_folder.iterdir()):
                        output_folder.rmdir()
                except Exception:
                    pass
                output_folder = refined_folder
                output_folder.mkdir(parents=True, exist_ok=True)
                job_output_dirs[job_id] = output_folder

        update_job(
            job_id,
            progress=18,
            message="Checking source video duration",
        )

        duration = probe_duration(source_path)

        start = min(request.start_seconds, int(duration))
        end = (
            min(request.end_seconds, int(duration))
            if request.end_seconds is not None
            else int(duration)
        )

        if end <= start:
            raise RuntimeError(
                "End time must be after start time and within "
                "the source video's duration."
            )

        available_seconds = end - start

        # Check if AI Viral Moments mode or explicit moments provided
        eff_video_id = video_id if "video_id" in locals() and video_id else (source_path.stem if source_path else "")
        active_moments = None

        if request.moments and len(request.moments) > 0:
            active_moments = request.moments
        elif getattr(request, "slicing_mode", "fixed") == "ai_viral" and source_path:
            update_job(
                job_id,
                status="processing",
                progress=36,
                message="AI detecting viral hooks & retention moments with Groq Llama 3.3...",
                files=[],
            )
            try:
                from services.viral_moment_service import detect_viral_moments_for_video
                viral_res = detect_viral_moments_for_video(
                    source_path,
                    video_id=eff_video_id,
                    max_moments=request.max_clips
                )
                active_moments = viral_res.get("moments", [])
                logger.info("Auto-detected %d viral moments for job %s", len(active_moments), job_id)
            except Exception as v_err:
                logger.warning("Auto viral moment detection failed, falling back to interval slicing: %s", v_err)
                active_moments = None

        if active_moments:
            count = min(len(active_moments), request.max_clips if request.max_clips else len(active_moments))
            if request.is_preview:
                count = 1
        elif request.is_preview:
            # Preview mode: render only the very first clip
            count = 1
        else:
            count = min(
                request.max_clips,
                max(
                    1,
                    math.ceil(available_seconds / request.clip_length),
                ),
            )

        font_path = find_windows_font()
        fontfile = escape_filter_path(font_path)

        update_job(
            job_id,
            status="processing",
            progress=38,
            message="Rendering preview clip" if request.is_preview else f"Generating {count} vertical clip(s)",
            files=[],
        )

        if cancel_event and cancel_event.is_set():
            update_job(job_id, status="cancelled", progress=0, message="Job cancelled by user")
            return

        created_files = []

        for index in range(count):
            if cancel_event and cancel_event.is_set():
                update_job(job_id, status="cancelled", message="Job cancelled by user", files=created_files)
                return

            current_moment = active_moments[index] if active_moments and index < len(active_moments) else None

            if current_moment:
                clip_start = float(current_moment.get("start_time", start))
                clip_end_val = float(current_moment.get("end_time", clip_start + request.clip_length))
                clip_duration = min(clip_end_val - clip_start, 180.0)
                raw_title = str(current_moment.get("headline") or request.title or "Viral Clip").strip()
            else:
                clip_start = start + index * request.clip_length
                if clip_start >= end:
                    break
                clip_duration = min(
                    request.clip_length,
                    end - clip_start,
                )
                raw_title = (request.title or "").strip()
            # Support {part} placeholder in title (e.g. "My Video part - {part}")
            has_part_in_title = bool(re.search(r"\{part\}", raw_title, re.IGNORECASE))
            if has_part_in_title:
                formatted_title = re.sub(r"\{part\}", str(index + 1), raw_title, flags=re.IGNORECASE)
            else:
                formatted_title = raw_title

            title = formatted_title if request.show_title else ""

            # If user already embedded {part} into the title itself, don't duplicate a standalone "Part X" label
            part_format_template = getattr(request, "part_format", None) or "Part {part}"
            if has_part_in_title:
                part = ""
            elif request.show_parts and not current_moment:
                part = part_format_template.replace("{part}", str(index + 1))
            elif request.show_parts and current_moment:
                part = f"Viral #{index + 1}"
            else:
                part = ""

            stem_base = re.sub(r"[_\-\s]*\{part\}", "", raw_title, flags=re.IGNORECASE).strip()
            stem_base = re.sub(r"[_\-\s]+part[_\-\s]*$", "", stem_base, flags=re.IGNORECASE).strip()
            safe_stem = safe_name(stem_base or "clip")
            if current_moment:
                filename = f"{safe_stem}_viral_{index + 1}.mp4"
            else:
                filename = f"{safe_stem}_part_{index + 1}.mp4"
            output_path = output_folder / filename

            # Calculate dynamic vertical positions & styles
            title_y = request.title_y if getattr(request, "title_y", None) is not None else 180
            title_size = int(getattr(request, "title_font_size", 48) or 48)
            part_size = int(getattr(request, "part_font_size", 34) or 34)
            title_color = getattr(request, "title_font_color", "white") or "white"
            part_color = getattr(request, "part_font_color", "white") or "white"
            title_box = getattr(request, "title_box_color", "black@0.45") or "black@0.45"
            part_box = getattr(request, "part_box_color", "black@0.40") or "black@0.40"

            if request.part_y is not None:
                part_y = request.part_y
            elif title and part:
                part_y = title_y + title_size + 45
            elif part:
                part_y = title_y
            else:
                part_y = title_y + title_size + 45

            # Check for AI Teaser Hook (Prepend 1-6s Cold Open)
            prepend_hook = bool(getattr(request, "prepend_hook", False))
            teaser_hook = current_moment.get("teaser_hook") if current_moment else None
            hook_info = None

            if prepend_hook and teaser_hook and isinstance(teaser_hook, dict):
                h_start = float(teaser_hook.get("start_time", clip_start))
                h_end = float(teaser_hook.get("end_time", h_start + 3.2))
                h_max = float(getattr(request, "hook_duration", 3.5) or 3.5)
                h_dur = round(min(h_max, max(1.0, h_end - h_start)), 2)
                h_badge = str(getattr(request, "hook_badge", None) or teaser_hook.get("badge_text", "WAIT FOR IT...")).strip()
                hook_info = {
                    "start": h_start,
                    "duration": h_dur,
                    "badge": h_badge,
                    "text": str(teaser_hook.get("text", "")).strip(),
                }

            total_render_duration = clip_duration + (hook_info["duration"] if hook_info else 0.0)
            source_has_audio = has_audio_stream(source_path)

            # Compute horizontal text alignment expressions (center, left, right)
            title_align = (getattr(request, "title_alignment", "center") or "center").lower()
            if getattr(request, "title_x", None) is not None:
                title_x_expr = str(request.title_x)
            elif title_align == "left":
                title_x_expr = "60"
            elif title_align == "right":
                title_x_expr = "w-text_w-60"
            else:
                title_x_expr = "(w-text_w)/2"

            part_align = (getattr(request, "part_alignment", "center") or "center").lower()
            if getattr(request, "part_x", None) is not None:
                part_x_expr = str(request.part_x)
            elif part_align == "left":
                part_x_expr = "60"
            elif part_align == "right":
                part_x_expr = "w-text_w-60"
            else:
                part_x_expr = "(w-text_w)/2"

            if hook_info:
                # -------------------------------------------------------------
                # DUAL-INPUT PIPELINE: Input 0 = Hook Teaser, Input 1 = Main Body
                # -------------------------------------------------------------
                safe_badge = escape_drawtext(hook_info["badge"]) if hook_info["badge"] else ""

                if request.background_style == "blur":
                    # Hook teaser vertical format
                    filter_script = (
                        "[0:v:0]split=2[h_bg][h_fg];"
                        "[h_bg]scale=180:320:force_original_aspect_ratio=increase,"
                        "crop=180:320,boxblur=8:2,scale=1080:1920:flags=fast_bilinear[h_blurred];"
                        "[h_fg]scale=1080:1440:force_original_aspect_ratio=decrease[h_scaled];"
                        "[h_blurred][h_scaled]overlay=(W-w)/2:(H-h)/2,setsar=1[h_base]"
                    )
                    h_last = "h_base"
                    if safe_badge:
                        badge_fontfile = escape_filter_path(find_windows_font(hook_info["badge"]))
                        filter_script += (
                            f";[{h_last}]drawtext=text='{safe_badge}':"
                            f"fontfile='{badge_fontfile}':"
                            "fontcolor=yellow:"
                            "fontsize=46:"
                            "x=(w-text_w)/2:"
                            "y=220:"
                            "box=1:"
                            "boxcolor=black@0.70:"
                            "boxborderw=16[h_t]"
                        )
                        h_last = "h_t"

                    # Main body vertical format
                    filter_script += (
                        ";[1:v:0]split=2[b_bg][b_fg];"
                        "[b_bg]scale=180:320:force_original_aspect_ratio=increase,"
                        "crop=180:320,boxblur=8:2,scale=1080:1920:flags=fast_bilinear[b_blurred];"
                        "[b_fg]scale=1080:1440:force_original_aspect_ratio=decrease[b_scaled];"
                        "[b_blurred][b_scaled]overlay=(W-w)/2:(H-h)/2,setsar=1[b_base]"
                    )
                    b_last = "b_base"
                    if title:
                        title_fontfile = escape_filter_path(find_windows_font(title))
                        safe_title = escape_drawtext(title)
                        filter_script += (
                            f";[{b_last}]drawtext=text='{safe_title}':"
                            f"fontfile='{title_fontfile}':"
                            f"fontcolor={title_color}:"
                            f"fontsize={title_size}:"
                            f"x={title_x_expr}:"
                            f"y={title_y}:"
                            "box=1:"
                            f"boxcolor={title_box}:"
                            "boxborderw=14[b_t1]"
                        )
                        b_last = "b_t1"

                    if part:
                        part_fontfile = escape_filter_path(find_windows_font(part))
                        safe_part = escape_drawtext(part)
                        filter_script += (
                            f";[{b_last}]drawtext=text='{safe_part}':"
                            f"fontfile='{part_fontfile}':"
                            f"fontcolor={part_color}:"
                            f"fontsize={part_size}:"
                            f"x={part_x_expr}:"
                            f"y={part_y}:"
                            "box=1:"
                            f"boxcolor={part_box}:"
                            "boxborderw=10[b_t2]"
                        )
                        b_last = "b_t2"

                    if source_has_audio:
                        filter_script += (
                            f";[0:a]aformat=channel_layouts=stereo:sample_rates=48000[h_a];"
                            f"[1:a]aformat=channel_layouts=stereo:sample_rates=48000[b_a];"
                            f"[{h_last}][h_a][{b_last}][b_a]concat=n=2:v=1:a=1[v_out][a_out]"
                        )
                        filter_args = ["-filter_complex", filter_script, "-map", "[v_out]", "-map", "[a_out]"]
                    else:
                        filter_script += f";[{h_last}][{b_last}]concat=n=2:v=1:a=0[v_out]"
                        filter_args = ["-filter_complex", filter_script, "-map", "[v_out]"]

                else:
                    # Classic centered letterbox with black padding
                    filter_script = (
                        "[0:v:0]scale=1080:1440:force_original_aspect_ratio=decrease,"
                        "pad=1080:1440:(ow-iw)/2:(oh-ih)/2:black,"
                        "pad=1080:1920:0:240:black,setsar=1[h_base]"
                    )
                    h_last = "h_base"
                    if safe_badge:
                        badge_fontfile = escape_filter_path(find_windows_font(hook_info["badge"]))
                        filter_script += (
                            f";[{h_last}]drawtext=text='{safe_badge}':"
                            f"fontfile='{badge_fontfile}':"
                            "fontcolor=yellow:"
                            "fontsize=46:"
                            "x=(w-text_w)/2:"
                            "y=220:"
                            "box=1:"
                            "boxcolor=black@0.70:"
                            "boxborderw=16[h_t]"
                        )
                        h_last = "h_t"

                    filter_script += (
                        ";[1:v:0]scale=1080:1440:force_original_aspect_ratio=decrease,"
                        "pad=1080:1440:(ow-iw)/2:(oh-ih)/2:black,"
                        "pad=1080:1920:0:240:black,setsar=1[b_base]"
                    )
                    b_last = "b_base"
                    if title:
                        title_fontfile = escape_filter_path(find_windows_font(title))
                        safe_title = escape_drawtext(title)
                        filter_script += (
                            f";[{b_last}]drawtext=text='{safe_title}':"
                            f"fontfile='{title_fontfile}':"
                            f"fontcolor={title_color}:"
                            f"fontsize={title_size}:"
                            f"x={title_x_expr}:"
                            f"y={title_y}:"
                            "box=1:"
                            f"boxcolor={title_box}:"
                            "boxborderw=14[b_t1]"
                        )
                        b_last = "b_t1"

                    if part:
                        part_fontfile = escape_filter_path(find_windows_font(part))
                        safe_part = escape_drawtext(part)
                        filter_script += (
                            f";[{b_last}]drawtext=text='{safe_part}':"
                            f"fontfile='{part_fontfile}':"
                            f"fontcolor={part_color}:"
                            f"fontsize={part_size}:"
                            f"x={part_x_expr}:"
                            f"y={part_y}:"
                            "box=1:"
                            f"boxcolor={part_box}:"
                            "boxborderw=10[b_t2]"
                        )
                        b_last = "b_t2"

                    if source_has_audio:
                        filter_script += (
                            f";[0:a]aformat=channel_layouts=stereo:sample_rates=48000[h_a];"
                            f"[1:a]aformat=channel_layouts=stereo:sample_rates=48000[b_a];"
                            f"[{h_last}][h_a][{b_last}][b_a]concat=n=2:v=1:a=1[v_out][a_out]"
                        )
                        filter_args = ["-filter_complex", filter_script, "-map", "[v_out]", "-map", "[a_out]"]
                    else:
                        filter_script += f";[{h_last}][{b_last}]concat=n=2:v=1:a=0[v_out]"
                        filter_args = ["-filter_complex", filter_script, "-map", "[v_out]"]

                command = [
                    "ffmpeg",
                    "-hide_banner",
                    "-y",
                    "-threads", "0",
                    "-ss", str(hook_info["start"]),
                    "-t", str(hook_info["duration"]),
                    "-i", str(source_path),
                    "-ss", str(clip_start),
                    "-t", str(clip_duration),
                    "-i", str(source_path),
                    *filter_args,
                    "-c:v", "libx264",
                    "-profile:v", "main",
                    "-level", "4.0",
                    "-preset", "superfast",
                    "-crf", "23",
                    "-pix_fmt", "yuv420p",
                ]
                if source_has_audio:
                    command.extend(["-c:a", "aac", "-ar", "48000", "-b:a", "128k"])
                command.extend(["-movflags", "+faststart", str(output_path)])

            else:
                # -------------------------------------------------------------
                # STANDARD SINGLE-INPUT PIPELINE
                # -------------------------------------------------------------
                if request.background_style == "blur":
                    # High-speed cinematic blur: downscale background to 180x320, apply light blur, and upscale to 1080x1920
                    filter_script = (
                        "[0:v:0]split=2[bg][fg];"
                        "[bg]scale=180:320:force_original_aspect_ratio=increase,"
                        "crop=180:320,boxblur=8:2,scale=1080:1920:flags=fast_bilinear[blurred];"
                        "[fg]scale=1080:1440:force_original_aspect_ratio=decrease[fg_scaled];"
                        "[blurred][fg_scaled]overlay=(W-w)/2:(H-h)/2,setsar=1[base]"
                    )
                    last_pad = "base"
                    if title:
                        title_fontfile = escape_filter_path(find_windows_font(title))
                        safe_title = escape_drawtext(title)
                        filter_script += (
                            f";[{last_pad}]drawtext=text='{safe_title}':"
                            f"fontfile='{title_fontfile}':"
                            f"fontcolor={title_color}:"
                            f"fontsize={title_size}:"
                            f"x={title_x_expr}:"
                            f"y={title_y}:"
                            "box=1:"
                            f"boxcolor={title_box}:"
                            "boxborderw=14[t1]"
                        )
                        last_pad = "t1"

                    if part:
                        part_fontfile = escape_filter_path(find_windows_font(part))
                        safe_part = escape_drawtext(part)
                        filter_script += (
                            f";[{last_pad}]drawtext=text='{safe_part}':"
                            f"fontfile='{part_fontfile}':"
                            f"fontcolor={part_color}:"
                            f"fontsize={part_size}:"
                            f"x={part_x_expr}:"
                            f"y={part_y}:"
                            "box=1:"
                            f"boxcolor={part_box}:"
                            "boxborderw=10[t2]"
                        )
                        last_pad = "t2"

                    filter_args = ["-filter_complex", filter_script, "-map", f"[{last_pad}]"]
                else:
                    # Classic centered letterbox with black padding
                    filters = (
                        "scale=1080:1440:"
                        "force_original_aspect_ratio=decrease,"
                        "pad=1080:1440:(ow-iw)/2:(oh-ih)/2:black,"
                        "pad=1080:1920:0:240:black,"
                        "setsar=1"
                    )

                    if title:
                        title_fontfile = escape_filter_path(find_windows_font(title))
                        safe_title = escape_drawtext(title)
                        filters += (
                            f",drawtext=text='{safe_title}':"
                            f"fontfile='{title_fontfile}':"
                            f"fontcolor={title_color}:"
                            f"fontsize={title_size}:"
                            f"x={title_x_expr}:"
                            f"y={title_y}:"
                            "box=1:"
                            f"boxcolor={title_box}:"
                            "boxborderw=14"
                        )

                    if part:
                        part_fontfile = escape_filter_path(find_windows_font(part))
                        safe_part = escape_drawtext(part)
                        filters += (
                            f",drawtext=text='{safe_part}':"
                            f"fontfile='{part_fontfile}':"
                            f"fontcolor={part_color}:"
                            f"fontsize={part_size}:"
                            f"x={part_x_expr}:"
                            f"y={part_y}:"
                            "box=1:"
                            f"boxcolor={part_box}:"
                            "boxborderw=10"
                        )

                    filter_args = ["-vf", filters, "-map", "0:v:0"]

                command = [
                    "ffmpeg",
                    "-hide_banner",
                    "-y",
                    "-threads", "0",
                    "-ss", str(clip_start),
                    "-t", str(clip_duration),
                    "-i", str(source_path),
                    *filter_args,
                    "-map", "0:a?",
                    "-c:v", "libx264",
                    "-profile:v", "main",
                    "-level", "4.0",
                    "-preset", "superfast",
                    "-crf", "23",
                    "-pix_fmt", "yuv420p",
                    "-c:a", "aac",
                    "-ar", "48000",
                    "-b:a", "128k",
                    "-movflags", "+faststart",
                    str(output_path),
                ]

            clip_start_pct = 38 + (index / max(count, 1)) * 58
            clip_range_pct = 58 / max(count, 1)

            def on_clip_progress(processed_secs: float, total_clip_secs: float):
                if total_clip_secs > 0:
                    sub_pct = min(1.0, processed_secs / total_clip_secs)
                    overall_pct = int(clip_start_pct + sub_pct * clip_range_pct)
                    update_job(
                        job_id,
                        progress=min(96, max(38, overall_pct)),
                        message=f"Creating clip {index + 1}/{count}: {int(processed_secs)}s/{int(total_clip_secs)}s ({int(sub_pct * 100)}%)",
                    )

            run_ffmpeg_with_progress(command, total_render_duration, on_progress=on_clip_progress, cancel_event=cancel_event)

            if not output_path.exists() or output_path.stat().st_size == 0:
                raise RuntimeError(
                    f"FFmpeg did not create a valid clip: {filename}"
                )

            # Persist clip metadata for zero-cost subtitle mapping
            try:
                eff_video_id = video_id if "video_id" in locals() and video_id else (source_path.stem if source_path else "")
                clip_meta = {
                    "clip_name": filename,
                    "source_file": source_path.name if source_path else "",
                    "source_video_id": eff_video_id,
                    "clip_start": float(clip_start),
                    "clip_end": float(clip_start + clip_duration),
                    "duration": float(total_render_duration),
                    "viral_headline": current_moment.get("headline", "") if current_moment else "",
                    "virality_score": current_moment.get("virality_score") if current_moment else None,
                    "hook": current_moment.get("hook", "") if current_moment else "",
                    "reason": current_moment.get("reason", "") if current_moment else "",
                    "has_prepended_hook": bool(hook_info),
                    "hook_start": float(hook_info["start"]) if hook_info else 0.0,
                    "hook_duration": float(hook_info["duration"]) if hook_info else 0.0,
                    "hook_badge": hook_info["badge"] if hook_info else "",
                    "hook_text": hook_info["text"] if hook_info else "",
                }
                meta_path = output_path.with_name(f"{filename}.meta.json")

                # Auto-generate or map voice-synced subtitles for this generated clip
                try:
                    from services.transcription_service import (
                        get_stored_transcript,
                        slice_transcript_for_clip,
                        create_voice_synced_word_chunks,
                        transcribe_video_with_groq,
                        get_groq_api_key,
                        convert_cues_to_hinglish,
                        has_devanagari_characters,
                    )
                    cues = []

                    # 1. Primary method: Transcribe the rendered clip directly with Groq Whisper for 100% audio sync
                    if output_path.exists() and get_groq_api_key():
                        try:
                            logger.info("Transcribing generated viral clip %s directly for 100%% voice-audio sync...", filename)
                            clip_tr = transcribe_video_with_groq(output_path, video_id=output_path.stem)
                            if clip_tr and clip_tr.get("segments"):
                                cues = create_voice_synced_word_chunks(clip_tr["segments"], max_words=3)
                                if any(has_devanagari_characters(c.get("text", "")) for c in cues) or str(clip_tr.get("language", "")).lower() in ("hi", "hindi", "urdu"):
                                    cues = convert_cues_to_hinglish(cues)
                        except Exception as c_err:
                            logger.warning("Direct clip auto-transcribe failed (%s), falling back to parent slice", c_err)

                    # 2. Fallback: Slicing parent transcript with clean hook/body boundary isolation
                    if not cues:
                        parent_tr = get_stored_transcript(eff_video_id)
                        if not parent_tr and source_path:
                            parent_tr = get_stored_transcript(source_path.stem)

                        if parent_tr and parent_tr.get("segments"):
                            if hook_info:
                                h_dur = float(hook_info["duration"])
                                raw_hook = slice_transcript_for_clip(
                                    parent_tr,
                                    float(hook_info["start"]),
                                    float(hook_info["start"] + h_dur)
                                )
                                hook_chunks = create_voice_synced_word_chunks(raw_hook, max_words=3)
                                for hc in hook_chunks:
                                    hc["end"] = min(h_dur, hc["end"])

                                raw_body = slice_transcript_for_clip(
                                    parent_tr,
                                    float(clip_start),
                                    float(clip_start + clip_duration)
                                )
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
                                raw_cues = slice_transcript_for_clip(parent_tr, float(clip_start), float(clip_start + clip_duration))
                                cues = create_voice_synced_word_chunks(raw_cues, max_words=3)

                            # Automatically convert Hindi speech to Hinglish by default
                            if cues and (any(has_devanagari_characters(c.get("text", "")) for c in cues) or (parent_tr and str(parent_tr.get("language", "")).lower() in ("hi", "hindi", "urdu"))):
                                try:
                                    cues = convert_cues_to_hinglish(cues)
                                except Exception as h_err:
                                    logger.warning("Auto-Hinglish conversion failed for %s: %s", filename, h_err)

                    if cues:
                        sub_file = output_path.with_name(f"{filename}.subtitles.json")
                        default_styles = {
                            "font_family": "Montserrat",
                            "font_size": 48,
                            "primary_color": "#FFFFFF",
                            "highlight_color": "#FACC15",
                            "outline_color": "#000000",
                            "outline_width": 0.5,
                            "text_transform": "uppercase",
                            "highlight_mode": "active_word",
                            "words_per_screen": 3,
                            "margin_v": 320
                        }
                        tmp_sub_file = output_path.with_name(f"{filename}.subtitles.json.tmp")
                        with open(tmp_sub_file, "w", encoding="utf-8") as sf:
                            json.dump({
                                "clip_name": filename,
                                "cues": cues,
                                "styles": default_styles
                            }, sf, indent=2, ensure_ascii=False)
                        tmp_sub_file.replace(sub_file)

                        clip_meta["has_subtitles"] = True
                        clip_meta["caption"] = " ".join([c.get("text", "").strip() for c in cues if c.get("text", "").strip()])

                        # Optional: Auto-burn animated subtitles directly into reel if requested
                        if getattr(request, "burn_subtitles", False):
                            try:
                                from services.subtitle_service import burn_subtitles_to_clip
                                temp_burn = output_path.with_name(f"{output_path.stem}_burn_temp.mp4")
                                burn_subtitles_to_clip(output_path, temp_burn, cues, default_styles)
                                if temp_burn.exists() and temp_burn.stat().st_size > 0:
                                    import time
                                    time.sleep(0.1)
                                    output_path.unlink(missing_ok=True)
                                    temp_burn.rename(output_path)
                                    clip_meta["subtitles_burned"] = True
                                    logger.info("Successfully auto-burned subtitles into %s", filename)
                            except Exception as b_err:
                                logger.warning("Auto-burn subtitles on %s failed: %s", filename, b_err)
                except Exception as sub_err:
                    logger.warning("Auto-mapping subtitles for clip skipped: %s", sub_err)

                with open(meta_path, "w", encoding="utf-8") as f_meta:
                    import json
                    json.dump(clip_meta, f_meta, indent=2)
                if db.is_db_connected():
                    db.db_save_clip_metadata(filename, clip_meta)
            except Exception as meta_err:
                logger.warning("Could not persist clip metadata: %s", meta_err)

            import urllib.parse
            rel_clip_path = str(output_path.relative_to(CLIPS_DIR)).replace("\\", "/")
            created_files.append({
                "name": filename,
                "relative_path": rel_clip_path,
                "url": f"/media/clips/{urllib.parse.quote(rel_clip_path)}",
            })
            try:
                ensure_clip_thumbnail(output_path)
            except Exception:
                pass

            update_job(
                job_id,
                files=list(created_files),
                progress=min(96, int(clip_start_pct + clip_range_pct)),
                message=f"Created clip {index + 1} of {count}",
            )

        if not created_files:
            raise RuntimeError(
                "No clips were created. Check the selected time range."
            )

        # Always keep the source when running a preview so that subsequent
        # preview tweaks and "Generate All" can reuse the cached file.
        should_delete = (
            not request.keep_source
            and not request.is_preview
            and downloaded_by_job
            and source_path
        )
        if should_delete:
            try:
                source_path.unlink(missing_ok=True)
            except OSError as error:
                update_job(
                    job_id,
                    message=(
                        "Clips created, but the source video could "
                        f"not be removed: {error}"
                    ),
                )

        completion_msg = (
            f"Preview clip ready! Adjust settings or click Generate All to create all clips."
            if request.is_preview
            else f"Successfully created {len(created_files)} clip(s)"
        )
        update_job(
            job_id,
            status="completed",
            progress=100,
            message=completion_msg,
            files=created_files,
            is_preview=request.is_preview,
        )

    except Exception as error:
        err_str = str(error).lower()
        if (cancel_event and cancel_event.is_set()) or "cancelled" in err_str:
            update_job(
                job_id,
                status="cancelled",
                message="Job was cancelled by user",
            )
        else:
            update_job(
                job_id,
                status="failed",
                message=str(error)[:4000],
            )


# --------------------------------------------------
# WEB ROUTES
# --------------------------------------------------

@app.get("/")
def home():
    index_path = STATIC_DIR / "index.html"

    if not index_path.exists():
        raise HTTPException(
            status_code=404,
            detail="static/index.html was not found.",
        )

    return FileResponse(index_path)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/cache-check")
def cache_check(url: str):
    """
    Return whether a local cached download already exists for this YouTube URL.
    Used by the frontend to show/hide the 'Source cached' pill.
    """
    check_url(url)
    video_id = extract_video_id(url)
    if not video_id:
        return {"cached": False, "video_id": None}

    cached = find_cached_source(DOWNLOAD_DIR / "downloads", video_id)
    return {"cached": cached is not None, "video_id": video_id, "file": cached.name if cached else None}


@app.get("/api/preview")
def preview_video(url: str):
    check_url(url)

    # Try client chains in order of reliability to avoid bot check challenges
    client_chains = [
        ["android", "ios"],
        ["android"],
        ["ios"],
        ["tv", "mweb"],
        None,
    ]

    last_error = None
    info = None

    for clients in client_chains:
        try:
            ydl_opts = get_yt_dlp_options(
                extra_opts={"skip_download": True},
                player_clients=clients,
            )
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url.strip(), download=False)
                if info and info.get("title"):
                    break
        except Exception as error:
            last_error = error
            continue

    if not info:
        cleaned_msg = clean_error_message(str(last_error or "Could not extract video metadata"))
        if "bot" in cleaned_msg.lower() or "sign in" in cleaned_msg.lower():
            cleaned_msg = (
                "YouTube bot check detected. "
                "Place an exported 'cookies.txt' file in your ClipForge folder, "
                "or try again in a few moments."
            )
        raise HTTPException(
            status_code=400,
            detail=f"Unable to load preview for this video: {cleaned_msg[:300]}",
        )

    duration = float(info.get("duration") or 0)
    mins = int(duration // 60)
    secs = int(duration % 60)
    hours = mins // 60
    mins = mins % 60
    if hours > 0:
        duration_str = f"{hours}:{mins:02d}:{secs:02d}"
    else:
        duration_str = f"{mins:02d}:{secs:02d}"

    thumbnail = info.get("thumbnail")
    thumbnails = info.get("thumbnails")
    if thumbnails and isinstance(thumbnails, list):
        # Pick best resolution thumbnail if available
        thumbnail = thumbnails[-1].get("url", thumbnail)

    return {
        "title": info.get("title") or "YouTube Video",
        "channel": info.get("uploader") or info.get("channel") or "YouTube Creator",
        "duration": duration,
        "duration_formatted": duration_str,
        "thumbnail": thumbnail,
        "view_count": info.get("view_count"),
        "upload_date": info.get("upload_date"),
        "video_id": info.get("id") or extract_video_id(url),
    }


@app.post("/api/jobs")
def create_job(request: ClipRequest, authorization: Optional[str] = Header(None)):
    user = get_current_user_optional(authorization)
    user_id = user["id"] if user else "guest"

    if request.source_file:
        source_path = find_file_in_dir(DOWNLOAD_DIR, request.source_file)
        if not source_path:
            raise HTTPException(
                status_code=400,
                detail=f"Source file '{Path(request.source_file).name}' not found in downloads folder.",
            )
    else:
        check_url(request.url)

    job_id = uuid.uuid4().hex
    cancel_event = threading.Event()
    job_cancel_events[job_id] = cancel_event

    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    job_doc = {
        "id": job_id,
        "job_id": job_id,
        "user_id": user_id,
        "status": "queued",
        "progress": 0,
        "message": "Waiting to start",
        "files": [],
        "created_at": now,
        "updated_at": now,
        "request": {
            "title": request.title,
            "url": request.url,
            "clip_length": request.clip_length,
            "count": request.count,
            "aspect_ratio": request.aspect_ratio,
            "background_style": request.background_style,
            "is_preview": request.is_preview,
            "source_file": request.source_file,
            "slicing_mode": getattr(request, "slicing_mode", "fixed"),
            "moments_count": len(request.moments) if request.moments else None,
            "prepend_hook": getattr(request, "prepend_hook", False),
            "hook_duration": getattr(request, "hook_duration", 3.5),
            "hook_badge": getattr(request, "hook_badge", "WAIT FOR IT..."),
            "burn_subtitles": getattr(request, "burn_subtitles", False),
            "title_alignment": getattr(request, "title_alignment", "center"),
            "part_alignment": getattr(request, "part_alignment", "center"),
        },
    }

    with jobs_lock:
        jobs[job_id] = job_doc

    if db.is_db_connected():
        try:
            db.db_save_job(job_doc)
        except Exception:
            pass

    thread = threading.Thread(
        target=process_job,
        args=(job_id, request, cancel_event),
        daemon=True,
    )
    thread.start()

    return {"job_id": job_id, **job_doc}


@app.get("/api/jobs")
def list_jobs(authorization: Optional[str] = Header(None)):
    """List recent requests/jobs scoped to user or guest."""
    user = get_current_user_optional(authorization)
    user_id = user["id"] if user else None

    jobs_map = {}
    if db.is_db_connected():
        for j in db.db_list_jobs(user_id=user_id, limit=50):
            jobs_map[j["id"]] = j

    with jobs_lock:
        for jid, active in jobs.items():
            if not user_id or active.get("user_id") in (user_id, "guest", "global"):
                jobs_map[jid] = dict(active)

    result_list = sorted(jobs_map.values(), key=lambda x: x.get("created_at", ""), reverse=True)
    return {"jobs": result_list}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)

    if not job and db.is_db_connected():
        job = db.db_get_job(job_id)

    if not job:
        raise HTTPException(
            status_code=404,
            detail="Job not found",
        )

    # Return a snapshot rather than the mutable internal dictionary.
    return dict(job)


@app.post("/api/jobs/{job_id}/cancel")
def cancel_job_endpoint(job_id: str):
    """Cancel a running or queued job."""
    with jobs_lock:
        job = jobs.get(job_id)
        if not job and db.is_db_connected():
            job = db.db_get_job(job_id)

        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        if job.get("status") in ("completed", "failed", "cancelled"):
            return {
                "success": True,
                "message": f"Job is already {job.get('status')}",
                "job": job,
            }

        # Signal cancellation event
        ev = job_cancel_events.get(job_id)
        if ev:
            ev.set()

        update_job(
            job_id,
            status="cancelled",
            message="Job was cancelled by user",
        )

        updated_job = jobs.get(job_id) or job
        return {
            "success": True,
            "message": "Job cancelled successfully",
            "job": updated_job,
        }


@app.delete("/api/jobs/{job_id}")
def delete_job_endpoint(job_id: str, authorization: Optional[str] = Header(None)):
    """Delete a job record from memory and MongoDB history."""
    user = get_current_user_optional(authorization)
    user_id = user["id"] if user else None

    with jobs_lock:
        jobs.pop(job_id, None)
        job_cancel_events.pop(job_id, None)

    deleted = False
    if db.is_db_connected():
        deleted = db.db_delete_job(job_id, user_id=user_id)

    return {"success": True, "message": "Job record deleted", "deleted": deleted}


@app.delete("/api/jobs")
def clear_jobs_endpoint(authorization: Optional[str] = Header(None)):
    """Clear completed/cancelled job records from history."""
    user = get_current_user_optional(authorization)
    user_id = user["id"] if user else None

    with jobs_lock:
        to_del = [jid for jid, j in jobs.items() if j.get("status") in ("completed", "cancelled", "failed")]
        for jid in to_del:
            jobs.pop(jid, None)
            job_cancel_events.pop(jid, None)

    count = 0
    if db.is_db_connected():
        count = db.db_clear_completed_jobs(user_id=user_id)

    return {"success": True, "message": f"Cleared {count} completed job record(s)"}


@app.get("/api/jobs/{job_id}/files/{filename:path}")
def download_clip(job_id: str, filename: str):
    unquoted = urllib.parse.unquote(filename)
    safe_filename = Path(unquoted).name

    with jobs_lock:
        job = jobs.get(job_id)
        output_folder = job_output_dirs.get(job_id)

        if not job:
            raise HTTPException(
                status_code=404,
                detail="Job not found",
            )

        matching = any(
            item["name"] == safe_filename or item["name"] == filename or item["name"] == Path(filename).name
            for item in job["files"]
        )

    if not matching:
        raise HTTPException(
            status_code=404,
            detail="Clip not found for this job.",
        )

    if output_folder is None:
        raise HTTPException(
            status_code=404,
            detail="Output folder is unavailable.",
        )

    clip_path = output_folder / safe_filename
    if not clip_path.is_file():
        clip_path = find_file_in_dir(output_folder, safe_filename)

    if not clip_path or not clip_path.is_file():
        raise HTTPException(
            status_code=404,
            detail="The generated clip no longer exists.",
        )

    return FileResponse(
        clip_path,
        media_type="video/mp4",
        filename=clip_path.name,
        headers={"Accept-Ranges": "bytes"},
    )


@app.get("/media/clip-thumbs/{filename:path}")
@app.get("/media/clips/{filename:path}/thumb")
def serve_clip_thumbnail(filename: str):
    """Serve or generate a 9:16 vertical JPEG thumbnail for a clip."""
    unquoted = urllib.parse.unquote(filename).replace("\\", "/")
    clip_path = find_file_in_dir(CLIPS_DIR, unquoted)
    if not clip_path:
        raise HTTPException(
            status_code=404,
            detail=f"Clip '{Path(unquoted).name}' not found",
        )
    thumb = ensure_clip_thumbnail(clip_path)
    if not thumb or not thumb.exists():
        raise HTTPException(status_code=404, detail="Thumbnail could not be generated")
    return FileResponse(
        thumb,
        media_type="image/jpeg",
        filename=thumb.name,
        headers={"Cache-Control": "public, max-age=86400"},
    )


@app.get("/media/clips/{filename:path}")
def serve_clip_media(filename: str):
    """Serve generated clip video directly by filename for preview or social publishing."""
    unquoted = urllib.parse.unquote(filename)
    clip_path = find_file_in_dir(CLIPS_DIR, unquoted)
    if not clip_path:
        raise HTTPException(
            status_code=404,
            detail=f"Clip '{Path(unquoted).name}' not found",
        )
    return FileResponse(
        clip_path,
        media_type="video/mp4",
        filename=clip_path.name,
        headers={"Accept-Ranges": "bytes"},
    )


@app.get("/api/clips")
def list_available_clips():
    """List all available generated clips grouped by video title and folder."""
    all_clips = []
    groups_dict = {}

    # Load publish history to map published status
    from storage import read_json, HISTORY_FILE
    history_records = read_json(HISTORY_FILE, {"records": []}).get("records", [])
    published_map = {}
    for record in history_records:
        c_name = record.get("clip_name")
        c_path = record.get("clip_path")
        success_targets = [t for t in record.get("targets", []) if t.get("status") == "success"]
        if success_targets:
            if c_name:
                published_map[c_name] = success_targets
            if c_path:
                published_map[Path(c_path).name] = success_targets

    if CLIPS_DIR.exists():
        for file in sorted(CLIPS_DIR.glob("**/*.mp4"), key=lambda f: f.stat().st_mtime, reverse=True):
            if file.name.endswith("_temp_burn.mp4"):
                continue
            try:
                stat = file.stat()
                rel_path = str(file.relative_to(CLIPS_DIR)).replace("\\", "/")
                parent_folder = file.parent
                folder_name = parent_folder.name if parent_folder != CLIPS_DIR and parent_folder != (CLIPS_DIR / "my_clips") else "General"
                folder_rel = str(parent_folder.relative_to(CLIPS_DIR)).replace("\\", "/") if parent_folder != CLIPS_DIR else "my_clips"

                # Subtitles
                has_subtitles = (
                    file.with_name(f"{file.name}.subtitles.json").exists()
                    or file.with_name(f"{file.stem}.subtitles.json").exists()
                    or "_subtitled" in file.stem
                )

                # Duration & Metadata
                duration = 0.0
                meta_data = {}
                meta_file = file.with_name(f"{file.name}.meta.json")
                if not meta_file.exists():
                    meta_file = file.with_name(f"{file.stem}.meta.json")
                if meta_file.exists():
                    try:
                        import json
                        with open(meta_file, "r", encoding="utf-8") as f_meta:
                            meta_data = json.load(f_meta)
                            duration = float(meta_data.get("duration", 0.0))
                            if meta_data.get("has_subtitles"):
                                has_subtitles = True
                    except Exception:
                        pass

                if duration <= 0:
                    try:
                        duration = probe_duration(file)
                    except Exception:
                        duration = 30.0

                mins = int(duration // 60)
                secs = int(duration % 60)
                duration_str = f"{mins}:{secs:02d}"

                stem = file.stem
                part_match = re.search(r"part_(\d+)", stem, re.IGNORECASE)
                part_num = int(part_match.group(1)) if part_match else 1
                part_label = f"Part {part_num}" if part_match else ""

                clean_title = f"{folder_name}_part_{part_num} - Part {part_num}" if (part_match and folder_name != "General") else stem
                meta_caption = (meta_data.get("caption") or meta_data.get("description") or "").strip()
                default_caption = f"Best Highlights of {folder_name} | part - {part_num} #viral #reels #shorts #trending" if folder_name != "General" else f"{stem} #viral #reels #shorts"
                caption = meta_caption if meta_caption else default_caption

                dt = datetime.datetime.fromtimestamp(stat.st_mtime)
                date_str = dt.strftime("%b %d, %Y")

                pub_targets = published_map.get(file.name) or published_map.get(stem)
                is_published = bool(pub_targets)
                publish_platforms = [t.get("account_alias") or t.get("platform") for t in (pub_targets or [])]
                publish_url = pub_targets[0].get("url") if pub_targets else None

                encoded_rel = urllib.parse.quote(rel_path)
                url = f"/media/clips/{encoded_rel}"
                thumb_url = f"/media/clip-thumbs/{encoded_rel}"

                clip_data = {
                    "name": file.name,
                    "relative_path": rel_path,
                    "folder_name": folder_name,
                    "folder_path": folder_rel,
                    "url": url,
                    "thumbnail_url": thumb_url,
                    "clean_title": clean_title,
                    "description": caption,
                    "part_number": part_num,
                    "part_label": part_label,
                    "duration": duration,
                    "duration_formatted": duration_str,
                    "size_mb": round(stat.st_size / (1024 * 1024), 2),
                    "size_bytes": stat.st_size,
                    "modified": stat.st_mtime,
                    "formatted_date": date_str,
                    "has_subtitles": has_subtitles,
                    "is_published": is_published,
                    "publish_platforms": publish_platforms,
                    "publish_url": publish_url,
                    "views": 0,
                    "comments": 0,
                }
                all_clips.append(clip_data)

                if folder_rel not in groups_dict:
                    groups_dict[folder_rel] = {
                        "folder_name": folder_name,
                        "folder_path": folder_rel,
                        "title": folder_name,
                        "clips": [],
                        "clip_count": 0,
                        "total_size_mb": 0.0,
                        "modified": stat.st_mtime,
                        "formatted_date": date_str,
                        "thumbnail_url": thumb_url,
                    }
                groups_dict[folder_rel]["clips"].append(clip_data)
                groups_dict[folder_rel]["clip_count"] += 1
                groups_dict[folder_rel]["total_size_mb"] = round(groups_dict[folder_rel]["total_size_mb"] + clip_data["size_mb"], 2)
                if stat.st_mtime > groups_dict[folder_rel]["modified"]:
                    groups_dict[folder_rel]["modified"] = stat.st_mtime
                    groups_dict[folder_rel]["formatted_date"] = date_str

            except Exception as e:
                logger.warning("Error processing clip %s: %s", file, e)

    groups_list = list(groups_dict.values())
    for grp in groups_list:
        grp["clips"].sort(key=lambda c: (c["part_number"], c["name"]))
        if grp["clips"]:
            grp["thumbnail_url"] = grp["clips"][0]["thumbnail_url"]

    groups_list.sort(key=lambda g: g["modified"], reverse=True)

    return {
        "clips": all_clips,
        "groups": groups_list,
        "total_clips": len(all_clips),
        "total_groups": len(groups_list),
    }


@app.get("/media/downloads/{filename:path}")
def serve_download_media(filename: str):
    """Serve downloaded source video directly by filename."""
    unquoted = urllib.parse.unquote(filename)
    dl_path = find_file_in_dir(DOWNLOAD_DIR, unquoted)
    if not dl_path:
        raise HTTPException(
            status_code=404,
            detail=f"Downloaded video '{Path(unquoted).name}' not found",
        )
    return FileResponse(
        dl_path,
        media_type="video/mp4",
        filename=dl_path.name,
        headers={"Accept-Ranges": "bytes"},
    )


@app.get("/api/downloads")
def list_available_downloads():
    """List all available downloaded source videos in data/downloads."""
    files, total_bytes = _scan_directory_files(DOWNLOAD_DIR, allowed_extensions={".mp4", ".mkv", ".webm"})
    for f in files:
        f["url"] = f"/media/downloads/{urllib.parse.quote(f['name'])}"
    return {
        "downloads": files,
        "count": len(files),
        "total_mb": round(total_bytes / (1024 * 1024), 2),
    }


@app.get("/api/downloads/{filename:path}/info")
def get_download_file_info(filename: str):
    """Get metadata, thumbnail, and probed duration of a downloaded video."""
    unquoted = urllib.parse.unquote(filename)
    source_path = find_file_in_dir(DOWNLOAD_DIR, unquoted)
    if not source_path:
        raise HTTPException(
            status_code=404,
            detail=f"Downloaded video '{Path(unquoted).name}' not found",
        )

    vid_match = re.search(r"\[([a-zA-Z0-9_-]{11})\]", source_path.stem)
    video_id = vid_match.group(1) if vid_match else None
    clean_title = re.sub(r"\s*\[[a-zA-Z0-9_-]{11}\]", "", source_path.stem).replace("_", " ").strip()

    duration = 0.0
    try:
        duration = probe_duration(source_path)
    except Exception:
        pass

    mins = int(duration // 60)
    secs = int(duration % 60)
    hours = mins // 60
    mins = mins % 60
    duration_str = f"{hours}:{mins:02d}:{secs:02d}" if hours > 0 else f"{mins:02d}:{secs:02d}"

    return {
        "filename": source_path.name,
        "clean_title": clean_title or source_path.stem,
        "video_id": video_id,
        "thumbnail": f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg" if video_id else None,
        "youtube_url": f"https://www.youtube.com/watch?v={video_id}" if video_id else None,
        "duration": duration,
        "duration_formatted": duration_str,
        "size_mb": round(source_path.stat().st_size / (1024 * 1024), 2),
        "url": f"/media/downloads/{urllib.parse.quote(source_path.name)}",
    }


def _scan_directory_files(directory: Path, allowed_extensions: set[str] | None = None):
    files = []
    total_bytes = 0
    if directory.exists():
        for path in sorted(directory.glob("**/*"), key=lambda p: p.stat().st_mtime if p.is_file() else 0, reverse=True):
            if path.is_file():
                if allowed_extensions and path.suffix.lower() not in allowed_extensions:
                    continue
                try:
                    stat = path.stat()
                    size_bytes = stat.st_size
                    total_bytes += size_bytes
                    rel = str(path.relative_to(directory)).replace("\\", "/")
                    vid_match = re.search(r"\[([a-zA-Z0-9_-]{11})\]", path.stem)
                    video_id = vid_match.group(1) if vid_match else None
                    clean_title = re.sub(r"\s*\[[a-zA-Z0-9_-]{11}\]", "", path.stem).replace("_", " ").strip()
                    files.append({
                        "name": path.name,
                        "relative_path": rel,
                        "size_mb": round(size_bytes / (1024 * 1024), 2),
                        "size_bytes": size_bytes,
                        "modified": stat.st_mtime,
                        "video_id": video_id,
                        "thumbnail": f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg" if video_id else None,
                        "clean_title": clean_title or path.stem,
                        "youtube_url": f"https://www.youtube.com/watch?v={video_id}" if video_id else None,
                    })
                except Exception:
                    pass
    return files, total_bytes


@app.get("/api/media/storage")
def get_media_storage():
    """Return storage metrics and list of all downloaded videos and generated clips."""
    downloads, dl_bytes = _scan_directory_files(DOWNLOAD_DIR)
    clips, clip_bytes = _scan_directory_files(CLIPS_DIR, allowed_extensions={".mp4", ".mkv", ".webm"})
    for d in downloads:
        d["url"] = f"/media/downloads/{urllib.parse.quote(d['name'])}"
    for c in clips:
        c["url"] = f"/media/clips/{urllib.parse.quote(c['name'])}"

    return {
        "downloads": downloads,
        "clips": clips,
        "total_downloads_mb": round(dl_bytes / (1024 * 1024), 2),
        "total_clips_mb": round(clip_bytes / (1024 * 1024), 2),
        "total_storage_mb": round((dl_bytes + clip_bytes) / (1024 * 1024), 2),
    }


@app.delete("/api/media/downloads")
def delete_downloads(filename: str | None = None):
    """Delete a specific file from data/downloads or clear all downloads."""
    if not DOWNLOAD_DIR.exists():
        return {"success": True, "deleted_count": 0, "freed_mb": 0.0, "message": "No downloads directory found"}

    deleted_count = 0
    freed_bytes = 0

    if filename:
        p = find_file_in_dir(DOWNLOAD_DIR, filename)
        if not p:
            raise HTTPException(status_code=404, detail=f"Download file '{Path(filename).name}' not found")
        try:
            size = p.stat().st_size
            p.unlink()
            freed_bytes += size
            deleted_count += 1
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to delete {p.name}: {exc}")
    else:
        for p in list(DOWNLOAD_DIR.glob("**/*")):
            if p.is_file():
                try:
                    size = p.stat().st_size
                    p.unlink()
                    freed_bytes += size
                    deleted_count += 1
                except Exception:
                    pass
        for d in list(DOWNLOAD_DIR.glob("**/*")):
            if d.is_dir() and not any(d.iterdir()):
                try:
                    d.rmdir()
                except Exception:
                    pass

    return {
        "success": True,
        "deleted_count": deleted_count,
        "freed_mb": round(freed_bytes / (1024 * 1024), 2),
        "message": f"Deleted {deleted_count} download file(s) ({round(freed_bytes / (1024 * 1024), 2)} MB freed)",
    }


@app.delete("/api/media/clips")
def delete_clips(filename: str | None = None):
    """Delete a specific clip from data/clips or clear all generated clips."""
    if not CLIPS_DIR.exists():
        return {"success": True, "deleted_count": 0, "freed_mb": 0.0, "message": "No clips directory found"}

    deleted_count = 0
    freed_bytes = 0

    if filename:
        p = find_file_in_dir(CLIPS_DIR, filename)
        if not p:
            raise HTTPException(status_code=404, detail=f"Clip '{Path(filename).name}' not found")
        try:
            parent_dir = p.parent
            size = p.stat().st_size
            p.unlink()
            freed_bytes += size
            deleted_count += 1
            # Remove associated metadata, thumbnail, and subtitle files
            for comp in [
                p.with_name(f"{p.name}.meta.json"),
                p.with_name(f"{p.stem}.meta.json"),
                p.with_name(f"{p.name}.subtitles.json"),
                p.with_name(f"{p.stem}.subtitles.json"),
                p.with_name(f"{p.stem}.thumb.jpg"),
                p.with_name(f"{p.name}.thumb.jpg"),
            ]:
                if comp.exists() and comp.is_file():
                    try:
                        freed_bytes += comp.stat().st_size
                        comp.unlink()
                    except Exception:
                        pass
            # If parent folder became empty, clean it up
            if parent_dir != CLIPS_DIR and parent_dir != (CLIPS_DIR / "my_clips") and not any(parent_dir.iterdir()):
                try:
                    parent_dir.rmdir()
                except Exception:
                    pass
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to delete {p.name}: {exc}")
    else:
        for p in list(CLIPS_DIR.glob("**/*")):
            if p.is_file():
                try:
                    size = p.stat().st_size
                    p.unlink()
                    freed_bytes += size
                    deleted_count += 1
                except Exception:
                    pass
        for d in list(CLIPS_DIR.glob("**/*")):
            if d.is_dir() and not any(d.iterdir()):
                try:
                    d.rmdir()
                except Exception:
                    pass

    return {
        "success": True,
        "deleted_count": deleted_count,
        "freed_mb": round(freed_bytes / (1024 * 1024), 2),
        "message": f"Deleted {deleted_count} clip(s) ({round(freed_bytes / (1024 * 1024), 2)} MB freed)",
    }


@app.delete("/api/media/clips/folder")
def delete_clip_folder(folder_path: str):
    """Delete an entire video folder and all clips contained within it."""
    unquoted = urllib.parse.unquote(folder_path).replace("\\", "/").strip("/")
    target_dir = CLIPS_DIR / unquoted
    if not target_dir.exists() or not target_dir.is_dir():
        safe_target = Path(unquoted).name
        candidates = [d for d in CLIPS_DIR.glob(f"**/{safe_target}") if d.is_dir()]
        if candidates:
            target_dir = candidates[0]
        else:
            raise HTTPException(status_code=404, detail=f"Clip folder '{unquoted}' not found")

    # Safety checks
    if target_dir.resolve() in (CLIPS_DIR.resolve(), (CLIPS_DIR / "my_clips").resolve(), BASE_DIR.resolve()):
        raise HTTPException(status_code=400, detail="Cannot delete root clips directory")

    deleted_count = 0
    freed_bytes = 0
    for p in list(target_dir.rglob("*")):
        if p.is_file():
            try:
                freed_bytes += p.stat().st_size
                deleted_count += 1
            except Exception:
                pass
    try:
        shutil.rmtree(str(target_dir))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to delete folder: {exc}")

    return {
        "success": True,
        "deleted_count": deleted_count,
        "freed_mb": round(freed_bytes / (1024 * 1024), 2),
        "message": f"Deleted folder and {deleted_count} file(s) ({round(freed_bytes / (1024 * 1024), 2)} MB freed)",
    }


@app.delete("/api/media/all")
def delete_all_media():
    """Purge all downloaded source videos and generated clips to free up storage."""
    res_dl = delete_downloads()
    res_cl = delete_clips()
    total_freed = round(res_dl["freed_mb"] + res_cl["freed_mb"], 2)
    total_count = res_dl["deleted_count"] + res_cl["deleted_count"]
    return {
        "success": True,
        "deleted_count": total_count,
        "freed_mb": total_freed,
        "message": f"Purged all media: {total_count} files ({total_freed} MB freed)",
    }



