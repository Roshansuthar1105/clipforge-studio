"""
routers/speedtest_router.py — FastAPI endpoints for testing internet speed, latency,
and video upload/download throughput for ClipForge Studio.
"""

import time
import os
from typing import Optional
from fastapi import APIRouter, Request, Query, HTTPException
from fastapi.responses import StreamingResponse
import requests

router = APIRouter(prefix="/api/speedtest", tags=["SpeedTest"])

CLOUDFLARE_PING_URL = "https://speed.cloudflare.com/__down?bytes=0"
CLOUDFLARE_DOWN_URL = "https://speed.cloudflare.com/__down?bytes={bytes}"
CLOUDFLARE_UP_URL = "https://speed.cloudflare.com/__up"


@router.get("/ping")
def ping():
    """Ultra-low overhead ping endpoint for measuring round-trip latency (RTT)."""
    return {
        "status": "ok",
        "timestamp": time.time(),
    }


@router.get("/download")
def download_stream(bytes_count: int = Query(5_000_000, alias="bytes", ge=100_000, le=50_000_000)):
    """
    Stream arbitrary binary chunks to measure client-to-server download bandwidth.
    """
    chunk_size = 64 * 1024  # 64 KB per chunk
    zeros = b"\0" * chunk_size

    def iter_bytes():
        remaining = bytes_count
        while remaining > 0:
            send_size = min(remaining, chunk_size)
            if send_size == chunk_size:
                yield zeros
            else:
                yield b"\0" * send_size
            remaining -= send_size

    return StreamingResponse(
        iter_bytes(),
        media_type="application/octet-stream",
        headers={
            "Content-Length": str(bytes_count),
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
        },
    )


@router.post("/upload")
async def upload_stream(request: Request):
    """
    Receive arbitrary binary payload from client to measure client-to-server upload bandwidth.
    """
    t_start = time.perf_counter()
    total_bytes = 0

    async for chunk in request.stream():
        total_bytes += len(chunk)

    duration = max(time.perf_counter() - t_start, 0.001)
    mbps = round((total_bytes * 8) / (duration * 1_000_000), 2)

    return {
        "status": "ok",
        "received_bytes": total_bytes,
        "duration_seconds": round(duration, 3),
        "mbps": mbps,
    }


@router.get("/server")
def server_speedtest():
    """
    Conduct an automated internet speed test directly from the ClipForge backend server
    to measure external connection throughput for YouTube downloads & Instagram/Meta reel publishing.
    """
    results = {
        "ping_ms": 0.0,
        "jitter_ms": 0.0,
        "download_mbps": 0.0,
        "upload_mbps": 0.0,
        "rating": "Unknown",
        "status": "success",
        "timestamp": time.time(),
    }

    # 1. Ping / Latency test (3 samples)
    latencies = []
    for _ in range(3):
        try:
            t0 = time.perf_counter()
            r = requests.get(CLOUDFLARE_PING_URL, timeout=5)
            if r.status_code == 200:
                latencies.append((time.perf_counter() - t0) * 1000)
        except Exception:
            pass

    if latencies:
        avg_ping = sum(latencies) / len(latencies)
        jitter = max(latencies) - min(latencies) if len(latencies) > 1 else 0.0
        results["ping_ms"] = round(avg_ping, 1)
        results["jitter_ms"] = round(jitter, 1)
    else:
        results["ping_ms"] = 0.0
        results["jitter_ms"] = 0.0

    # 2. Server Download speed test (Download 10MB chunk from CDN)
    try:
        down_target = 10_000_000  # 10 MB
        t0 = time.perf_counter()
        resp = requests.get(CLOUDFLARE_DOWN_URL.format(bytes=down_target), timeout=15)
        dur = max(time.perf_counter() - t0, 0.001)
        if resp.status_code == 200 and len(resp.content) > 0:
            bytes_received = len(resp.content)
            results["download_mbps"] = round((bytes_received * 8) / (dur * 1_000_000), 2)
    except Exception as e:
        results["download_error"] = str(e)

    # 3. Server Upload speed test (Upload 3MB chunk to CDN)
    try:
        up_size = 3_000_000  # 3 MB
        random_payload = os.urandom(up_size)
        t0 = time.perf_counter()
        up_resp = requests.post(CLOUDFLARE_UP_URL, data=random_payload, timeout=15)
        dur = max(time.perf_counter() - t0, 0.001)
        if up_resp.status_code in (200, 204):
            results["upload_mbps"] = round((up_size * 8) / (dur * 1_000_000), 2)
    except Exception as e:
        results["upload_error"] = str(e)

    # 4. Generate readiness assessment for ClipForge workflows
    down = results["download_mbps"]
    up = results["upload_mbps"]

    if down >= 50 and up >= 20:
        results["rating"] = "Blazing Fast — Perfect for instant 4K reel processing, yt-dlp ripping & batch publishing"
        results["quality"] = "excellent"
    elif down >= 25 and up >= 10:
        results["rating"] = "High Speed — Great for 1080p full-HD video downloads & smooth social uploads"
        results["quality"] = "great"
    elif down >= 10 and up >= 5:
        results["rating"] = "Good — Normal HD video processing & standard social media publishing"
        results["quality"] = "good"
    elif down > 0 or up > 0:
        results["rating"] = "Fair — Video downloads and uploads will complete, but may take longer"
        results["quality"] = "fair"
    else:
        results["rating"] = "Connection limited or server offline"
        results["quality"] = "poor"
        results["status"] = "degraded"

    return results
