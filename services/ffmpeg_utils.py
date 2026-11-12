"""
services/ffmpeg_utils.py — Shared FFmpeg encoder detection, hardware acceleration with
safe software fallback, and progress-streaming execution helpers.
"""

from __future__ import annotations

import logging
import os
import subprocess
import threading
import time
from typing import Callable, Optional

logger = logging.getLogger("clipforge.ffmpeg_utils")

_encoder_lock = threading.Lock()
_cached_encoder: Optional[str] = None


def _probe_encoder(encoder: str) -> bool:
    """Verify via a tiny null encode that *encoder* actually works on this machine."""
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=128x128:d=0.1",
        "-c:v",
        encoder,
        "-pix_fmt",
        "yuv420p",
        "-f",
        "null",
        "-",
    ]
    try:
        res = subprocess.run(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=6,
            check=False,
        )
        return res.returncode == 0
    except Exception:
        return False


def get_preferred_h264_encoder() -> str:
    """
    Detect and cache the fastest working H.264 encoder.
    Respects optional FFMPEG_ENCODER env override (e.g. 'libx264' or 'h264_nvenc').
    """
    global _cached_encoder
    env_override = (os.getenv("FFMPEG_ENCODER") or "").strip()
    if env_override:
        return env_override

    with _encoder_lock:
        if _cached_encoder is not None:
            return _cached_encoder

        for cand in ("h264_nvenc", "h264_qsv", "h264_amf"):
            if _probe_encoder(cand):
                logger.info("Using hardware H.264 encoder: %s", cand)
                _cached_encoder = cand
                return cand

        logger.info("No working GPU H.264 encoder detected; using software libx264")
        _cached_encoder = "libx264"
        return _cached_encoder


def get_max_encode_workers() -> int:
    """Determine bounded concurrent worker count for parallel slicing / subtitle burning."""
    raw = (os.getenv("FFMPEG_MAX_WORKERS") or "").strip()
    if raw.isdigit() and int(raw) >= 1:
        return min(6, int(raw))
    encoder = get_preferred_h264_encoder()
    if encoder != "libx264":
        return 2
    cpus = os.cpu_count() or 2
    return max(1, min(3, cpus // 2 or 1))


def build_video_encoder_args(
    encoder: Optional[str] = None,
    *,
    crf: int = 22,
    preset: str = "veryfast",
) -> list[str]:
    """Return consistent H.264 encoding arguments for the requested or auto-detected encoder."""
    enc = encoder or get_preferred_h264_encoder()
    q = str(crf)

    if enc == "h264_nvenc":
        return [
            "-c:v", "h264_nvenc",
            "-preset", "p4",
            "-rc", "vbr",
            "-cq", q,
            "-b:v", "0",
            "-pix_fmt", "yuv420p",
        ]
    if enc == "h264_qsv":
        return [
            "-c:v", "h264_qsv",
            "-preset", "veryfast",
            "-global_quality", q,
            "-pix_fmt", "yuv420p",
        ]
    if enc == "h264_amf":
        return [
            "-c:v", "h264_amf",
            "-quality", "speed",
            "-rc", "cqp",
            "-qp_i", q,
            "-qp_p", q,
            "-pix_fmt", "yuv420p",
        ]
    return [
        "-c:v", "libx264",
        "-profile:v", "main",
        "-level", "4.0",
        "-preset", preset,
        "-crf", q,
        "-pix_fmt", "yuv420p",
    ]


def _run_ffmpeg_once(
    cmd: list[str],
    total_duration: float,
    progress_callback: Optional[Callable[[float, float], None]] = None,
    cancel_event: Optional[threading.Event] = None,
) -> tuple[int, str]:
    """Execute one FFmpeg command with optional progress pipe parsing and cancellation."""
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        errors="replace",
    )

    stderr_lines: list[str] = []

    def _drain_stderr():
        try:
            if proc.stderr:
                for line in proc.stderr:
                    stderr_lines.append(line)
        except Exception:
            pass

    err_thread = threading.Thread(target=_drain_stderr, daemon=True)
    err_thread.start()

    last_report = 0.0
    if progress_callback and proc.stdout:
        for line in proc.stdout:
            if cancel_event and cancel_event.is_set():
                proc.terminate()
                try:
                    proc.wait(timeout=3)
                except Exception:
                    proc.kill()
                raise RuntimeError("Job cancelled by user")

            line = line.strip()
            if line.startswith(("out_time_us=", "out_time_ms=")):
                try:
                    out_us = int(line.split("=", 1)[1])
                    current_sec = out_us / 1_000_000.0
                    now = time.time()
                    if now - last_report >= 0.25 or (total_duration > 0 and current_sec >= total_duration):
                        last_report = now
                        eff_total = total_duration if total_duration > 0 else max(current_sec + 1.0, 1.0)
                        progress_callback(min(current_sec, eff_total), eff_total)
                except Exception:
                    pass
            elif line == "progress=end" and total_duration > 0:
                progress_callback(total_duration, total_duration)
    else:
        while proc.poll() is None:
            if cancel_event and cancel_event.is_set():
                proc.terminate()
                try:
                    proc.wait(timeout=3)
                except Exception:
                    proc.kill()
                raise RuntimeError("Job cancelled by user")
            time.sleep(0.2)

    returncode = proc.wait()
    err_thread.join(timeout=2)
    return returncode, "".join(stderr_lines).strip()


def run_ffmpeg_with_fallback(
    build_cmd: Callable[[str], list[str]],
    total_duration: float = 0.0,
    progress_callback: Optional[Callable[[float, float], None]] = None,
    cancel_event: Optional[threading.Event] = None,
) -> None:
    """
    Build and run an FFmpeg command using the preferred encoder; if a hardware encoder
    fails at runtime, retry once cleanly using software libx264.
    """
    encoder = get_preferred_h264_encoder()
    cmd = build_cmd(encoder)
    returncode, err_text = _run_ffmpeg_once(cmd, total_duration, progress_callback, cancel_event)

    if returncode != 0 and encoder != "libx264":
        logger.warning(
            "Hardware encoder '%s' failed (%s); falling back to libx264",
            encoder,
            err_text[-300:],
        )
        cmd_sw = build_cmd("libx264")
        returncode, err_text = _run_ffmpeg_once(cmd_sw, total_duration, progress_callback, cancel_event)

    if returncode != 0:
        raise RuntimeError(f"FFmpeg error ({returncode}): {err_text[-800:] or 'Unknown FFmpeg failure'}")
