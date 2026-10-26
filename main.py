
import os
import re
import uuid
import math
import shutil
import threading
import subprocess
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urlunparse

import yt_dlp
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field


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

app = FastAPI(title="ClipForge Studio")

app.mount(
    "/static",
    StaticFiles(directory=str(STATIC_DIR)),
    name="static",
)

jobs = {}
jobs_lock = threading.Lock()
job_output_dirs = {}


# --------------------------------------------------
# REQUEST SETTINGS
# --------------------------------------------------

class ClipRequest(BaseModel):
    url: str
    title: str = "My Video"

    clip_length: int = Field(default=30, ge=1, le=600)
    max_clips: int = Field(default=5, ge=1, le=100)

    start_seconds: int = Field(default=0, ge=0)
    end_seconds: int | None = Field(default=None, ge=1)

    download_folder: str = "downloads"
    clips_folder: str = "my_clips"

    # Optional filename for the downloaded source.
    source_name: str | None = None

    # Optional absolute output folder.
    output_path: str | None = None

    show_title: bool = True
    show_parts: bool = True
    keep_source: bool = True

    # "blur" for cinematic blurred 9:16 background, "black" for classic bars.
    background_style: str = "blur"

    # When True, generate only the first clip (fast preview / test render).
    is_preview: bool = False


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


def find_cached_source(download_folder: Path, video_id: str) -> Path | None:
    """
    Search *download_folder* for a previously downloaded file whose name
    contains *[video_id]* and whose size is greater than zero.
    Returns the Path if found, else None.
    """
    pattern = f"*\[{video_id}\]*"
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


def run_command(command: list[str]) -> str:
    """Run a command and return useful error output."""
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            errors="replace",
            timeout=3600,
            check=False,
        )
    except FileNotFoundError as error:
        raise RuntimeError(
            f"Required program was not found: {command[0]}. "
            "Install FFmpeg and make sure ffmpeg.exe and "
            "ffprobe.exe are available in PATH."
        ) from error
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(
            f"Command timed out: {command[0]}"
        ) from error

    if result.returncode != 0:
        message = (result.stderr or result.stdout or "Command failed").strip()
        raise RuntimeError(message[-4000:])

    return result.stdout.strip()


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
            jobs[job_id].update(values)


# --------------------------------------------------
# VIDEO PROCESSING
# --------------------------------------------------

def process_job(job_id: str, request: ClipRequest):
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
        # Derive a stable, video-unique filename
        # --------------------------------------------------
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

        created_files = []

        for index in range(count):
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
                    "[blurred][fg_scaled]overlay=(W-w)/2:(H-h)/2[base]"
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
                    "pad=1080:1920:0:240:black"
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
                "-preset", "veryfast",
                "-crf", "23",
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                "-b:a", "128k",
                "-movflags", "+faststart",
                str(output_path),
            ]

            run_command(command)

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
def create_job(request: ClipRequest):
    check_url(request.url)

    job_id = uuid.uuid4().hex

    with jobs_lock:
        jobs[job_id] = {
            "id": job_id,
            "status": "queued",
            "progress": 0,
            "message": "Waiting to start",
            "files": [],
        }

    thread = threading.Thread(
        target=process_job,
        args=(job_id, request),
        daemon=True,
    )
    thread.start()

    return {"job_id": job_id, **jobs[job_id]}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)

        if not job:
            raise HTTPException(
                status_code=404,
                detail="Job not found",
            )

        # Return a snapshot rather than the mutable internal dictionary.
        return dict(job)


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
