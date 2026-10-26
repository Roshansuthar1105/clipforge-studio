
import os
import re
import uuid
import math
import threading
import subprocess
from pathlib import Path
from urllib.parse import urlparse

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


# --------------------------------------------------
# UTILITIES
# --------------------------------------------------

def safe_name(value: str) -> str:
    """Remove characters that are unsafe in Windows filenames."""
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value)
    value = re.sub(r"\s+", " ", value).strip(" .")
    return value[:100] or "video"


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
            message="Preparing download folders",
        )

        download_folder = DOWNLOAD_DIR / safe_name(
            request.download_folder
        )
        download_folder.mkdir(parents=True, exist_ok=True)

        if request.output_path and request.output_path.strip():
            # Allow an absolute output path selected by the user.
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

        source_basename = safe_name(
            request.source_name or "source"
        )

        options = {
            "format": (
                "bestvideo[height<=1080]+bestaudio/"
                "best[height<=1080]/best"
            ),
            "merge_output_format": "mp4",
            "outtmpl": str(
                download_folder / f"{source_basename}.%(ext)s"
            ),
            "noplaylist": True,
            "restrictfilenames": True,
            "quiet": True,
            "no_warnings": True,
        }

        update_job(
            job_id,
            progress=10,
            message="Downloading source video",
        )

        # Download the video using yt-dlp.
        with yt_dlp.YoutubeDL(options) as downloader:
            info = downloader.extract_info(
                request.url.strip(),
                download=True,
            )
            prepared_name = downloader.prepare_filename(info)

        source_path = Path(prepared_name)

        # yt-dlp may change the extension after merging streams.
        possible_paths = [
            source_path,
            source_path.with_suffix(".mp4"),
        ]

        if not any(path.exists() for path in possible_paths):
            possible_paths.extend(
                path for path in download_folder.glob(
                    f"{source_basename}.*"
                )
                if path.is_file()
            )

        source_path = next(
            (path for path in possible_paths if path.exists()),
            None,
        )

        if source_path is None:
            raise RuntimeError(
                "Download finished, but the source video file "
                "could not be found."
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
            message="Generating vertical clips",
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

        if not request.keep_source and downloaded_by_job and source_path:
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

        update_job(
            job_id,
            status="completed",
            progress=100,
            message=f"Successfully created {len(created_files)} clip(s)",
            files=created_files,
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


@app.get("/api/preview")
def preview_video(url: str):
    check_url(url)
    ydl_opts = {
        "skip_download": True,
        "quiet": True,
        "no_warnings": True,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url.strip(), download=False)
            if not info:
                raise ValueError("Could not extract video information.")

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
            }
    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail=f"Unable to load preview for this video: {str(error)[:300]}",
        )


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
