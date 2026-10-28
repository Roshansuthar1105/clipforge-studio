
import os
import re
import time
import uuid
import math
import shutil
import logging
import threading
import subprocess
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urlunparse

import yt_dlp
from typing import Optional
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

app = FastAPI(title="ClipForge Studio")

logger = logging.getLogger("clipforge")

@app.on_event("startup")
def on_startup():
    if db.is_db_connected():
        cleaned = db.db_cleanup_stale_jobs()
        if cleaned > 0:
            logger.info("Cleaned up %d stale job(s) from previous server run", cleaned)

app.include_router(auth_router)
app.include_router(accounts_router)
app.include_router(publish_router)
app.include_router(meta_publish_router)

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

    # "blur" for cinematic blurred 9:16 background, "black" for classic bars.
    background_style: str = "blur"

    # When True, generate only the first clip (fast preview / test render).
    is_preview: bool = False

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
    """Find a file by exact name in directory or subdirectories without glob bracket issues."""
    if not directory.exists():
        return None
    safe_name = Path(filename).name
    direct = directory / safe_name
    if direct.is_file():
        return direct
    for p in directory.rglob("*"):
        if p.is_file() and p.name == safe_name:
            return p
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

    # Responsive polling loop checking for user cancellation
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
        time.sleep(0.1)

    stdout, stderr = proc.communicate()
    if proc.returncode != 0:
        message = (stderr or stdout or "Command failed").strip()
        raise RuntimeError(message[-4000:])

    return (stdout or "").strip()


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


def find_windows_font() -> Path:
    """Find a font that works on Windows or Linux."""
    candidates = [
        Path(os.environ.get("WINDIR", r"C:\Windows"))
        / "Fonts" / "arialbd.ttf",
        Path(os.environ.get("WINDIR", r"C:\Windows"))
        / "Fonts" / "arial.ttf",
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]

    for candidate in candidates:
        if candidate.exists():
            return candidate

    raise RuntimeError(
        "No supported font was found. Install Arial or DejaVu Sans."
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

        if request.output_path and request.output_path.strip():
            output_folder = Path(
                os.path.expandvars(
                    os.path.expanduser(request.output_path.strip())
                )
            ).resolve()
        else:
            output_folder = CLIPS_DIR / safe_name(
                request.clips_folder
            )

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
                    progress=18,
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
                        pct = min(18, int(10 + (downloaded / total) * 8))
                        mb_down = downloaded / (1024 * 1024)
                        mb_tot = total / (1024 * 1024)
                        update_job(
                            job_id,
                            progress=pct,
                            message=f"Downloading source: {mb_down:.1f}/{mb_tot:.1f} MB",
                        )

            base_dl_opts = {
                "format": (
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

        if request.is_preview:
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
            progress=20,
            message="Rendering preview clip" if request.is_preview else "Generating vertical clips",
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

            clip_start = start + index * request.clip_length

            if clip_start >= end:
                break

            clip_duration = min(
                request.clip_length,
                end - clip_start,
            )

            title = (
                safe_name(request.title)
                if request.show_title
                else ""
            )

            part = (
                f"Part {index + 1}"
                if request.show_parts
                else ""
            )

            filename = (
                f"{safe_name(request.title)}_part_{index + 1}.mp4"
            )
            output_path = output_folder / filename

            # Fit the video into a 9:16 frame.
            if request.background_style == "blur":
                # Dual-stream: scale & heavily blur background (1080x1920) and overlay sharp centered foreground
                filter_script = (
                    "[0:v:0]split=2[bg][fg];"
                    "[bg]scale=1080:1920:force_original_aspect_ratio=increase,"
                    "crop=1080:1920,boxblur=25:5[blurred];"
                    "[fg]scale=1080:1440:force_original_aspect_ratio=decrease[fg_scaled];"
                    "[blurred][fg_scaled]overlay=(W-w)/2:(H-h)/2,setsar=1[base]"
                )
                last_pad = "base"
                if title:
                    safe_title = escape_drawtext(title)
                    filter_script += (
                        f";[{last_pad}]drawtext=text='{safe_title}':"
                        f"fontfile='{fontfile}':"
                        "fontcolor=white:"
                        "fontsize=48:"
                        "x=(w-text_w)/2:"
                        "y=55:"
                        "box=1:"
                        "boxcolor=black@0.45:"
                        "boxborderw=14[t1]"
                    )
                    last_pad = "t1"

                if part:
                    safe_part = escape_drawtext(part)
                    filter_script += (
                        f";[{last_pad}]drawtext=text='{safe_part}':"
                        f"fontfile='{fontfile}':"
                        "fontcolor=white:"
                        "fontsize=34:"
                        "x=(w-text_w)/2:"
                        "y=175[t2]"
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
                    safe_title = escape_drawtext(title)
                    filters += (
                        f",drawtext=text='{safe_title}':"
                        f"fontfile='{fontfile}':"
                        "fontcolor=white:"
                        "fontsize=48:"
                        "x=(w-text_w)/2:"
                        "y=55:"
                        "box=1:"
                        "boxcolor=black@0.35:"
                        "boxborderw=14"
                    )

                if part:
                    safe_part = escape_drawtext(part)
                    filters += (
                        f",drawtext=text='{safe_part}':"
                        f"fontfile='{fontfile}':"
                        "fontcolor=white:"
                        "fontsize=34:"
                        "x=(w-text_w)/2:"
                        "y=175"
                    )

                filter_args = ["-vf", filters, "-map", "0:v:0"]

            update_job(
                job_id,
                progress=min(
                    94,
                    20 + int(74 * index / max(count, 1)),
                ),
                message=f"Creating clip {index + 1} of {count}",
            )

            command = [
                "ffmpeg",
                "-hide_banner",
                "-y",
                "-ss", str(clip_start),
                "-i", str(source_path),
                "-t", str(clip_duration),
                *filter_args,
                "-map", "0:a?",
                "-c:v", "libx264",
                "-profile:v", "main",
                "-level", "4.0",
                "-preset", "veryfast",
                "-crf", "23",
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                "-ar", "48000",
                "-b:a", "128k",
                "-movflags", "+faststart",
                str(output_path),
            ]

            run_command(command, cancel_event=cancel_event)

            if not output_path.exists() or output_path.stat().st_size == 0:
                raise RuntimeError(
                    f"FFmpeg did not create a valid clip: {filename}"
                )

            created_files.append({
                "name": filename,
                "url": f"/api/jobs/{job_id}/files/{filename}",
            })

            update_job(
                job_id,
                files=list(created_files),
                progress=min(
                    95,
                    20 + int(75 * len(created_files) / count),
                ),
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


@app.get("/api/jobs/{job_id}/files/{filename}")
def download_clip(job_id: str, filename: str):
    safe_filename = Path(filename).name

    with jobs_lock:
        job = jobs.get(job_id)
        output_folder = job_output_dirs.get(job_id)

        if not job:
            raise HTTPException(
                status_code=404,
                detail="Job not found",
            )

        matching = any(
            item["name"] == safe_filename
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
        raise HTTPException(
            status_code=404,
            detail="The generated clip no longer exists.",
        )

    return FileResponse(
        clip_path,
        media_type="video/mp4",
        filename=safe_filename,
    )


@app.get("/media/clips/{filename}")
def serve_clip_media(filename: str):
    """Serve generated clip video directly by filename for preview or social publishing."""
    clip_path = find_file_in_dir(CLIPS_DIR, filename)
    if not clip_path:
        raise HTTPException(
            status_code=404,
            detail=f"Clip '{Path(filename).name}' not found",
        )
    return FileResponse(
        clip_path,
        media_type="video/mp4",
        filename=clip_path.name,
    )


@app.get("/api/clips")
def list_available_clips():
    """List all available generated clips found in the clips directory."""
    clips = []
    if CLIPS_DIR.exists():
        for file in sorted(CLIPS_DIR.glob("**/*.mp4"), key=lambda f: f.stat().st_mtime, reverse=True):
            clips.append({
                "name": file.name,
                "url": f"/media/clips/{file.name}",
                "size_mb": round(file.stat().st_size / (1024 * 1024), 2),
            })
    return {"clips": clips}


@app.get("/media/downloads/{filename}")
def serve_download_media(filename: str):
    """Serve downloaded source video directly by filename."""
    dl_path = find_file_in_dir(DOWNLOAD_DIR, filename)
    if not dl_path:
        raise HTTPException(
            status_code=404,
            detail=f"Downloaded video '{Path(filename).name}' not found",
        )
    return FileResponse(
        dl_path,
        media_type="video/mp4",
        filename=dl_path.name,
    )


@app.get("/api/downloads")
def list_available_downloads():
    """List all available downloaded source videos in data/downloads."""
    files, total_bytes = _scan_directory_files(DOWNLOAD_DIR, allowed_extensions={".mp4", ".mkv", ".webm"})
    for f in files:
        f["url"] = f"/media/downloads/{f['name']}"
    return {
        "downloads": files,
        "count": len(files),
        "total_mb": round(total_bytes / (1024 * 1024), 2),
    }


@app.get("/api/downloads/{filename}/info")
def get_download_file_info(filename: str):
    """Get metadata, thumbnail, and probed duration of a downloaded video."""
    source_path = find_file_in_dir(DOWNLOAD_DIR, filename)
    if not source_path:
        raise HTTPException(
            status_code=404,
            detail=f"Downloaded video '{Path(filename).name}' not found",
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
        "url": f"/media/downloads/{source_path.name}",
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
            size = p.stat().st_size
            p.unlink()
            freed_bytes += size
            deleted_count += 1
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



