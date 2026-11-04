"""
Unit test suite verifying real-time progress percentages and insider operational metrics.
"""

import sys
import unittest
from pathlib import Path

# Ensure root workspace is in sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main
import publisher.jobs as pub_jobs
from publisher.models import BatchPublishRequest, PublishTarget
from routers.subtitles_router import _save_subtitle_job, _get_subtitle_job


class TestProgressTracking(unittest.TestCase):
    def test_update_job_synchronizes_stage_msg_and_message(self):
        job_id = "test_progress_sync_job"
        with main.jobs_lock:
            main.jobs[job_id] = {
                "id": job_id,
                "status": "queued",
                "progress": 0,
            }

        # 1. Update with message only -> stage_msg should also be set
        main.update_job(
            job_id,
            status="downloading",
            stage="downloading",
            progress=25,
            stage_progress=60,
            message="Downloading source: 45.0/120.0 MB (38%) • 4.2 MB/s • ETA 18s",
            download_details={"downloaded_mb": 45.0, "total_mb": 120.0, "pct": 38, "speed": "4.2 MB/s", "eta": "18s"}
        )

        with main.jobs_lock:
            j = main.jobs[job_id]
            self.assertEqual(j["message"], "Downloading source: 45.0/120.0 MB (38%) • 4.2 MB/s • ETA 18s")
            self.assertEqual(j["stage_msg"], "Downloading source: 45.0/120.0 MB (38%) • 4.2 MB/s • ETA 18s")
            self.assertEqual(j["stage_progress"], 60)
            self.assertEqual(j["download_details"]["speed"], "4.2 MB/s")

        # 2. Update with clipping insider info
        main.update_job(
            job_id,
            status="processing",
            stage="clipping",
            progress=45,
            stage_progress=30,
            current_clip=2,
            total_clips=10,
            current_clip_name="clip_2.mp4",
            current_clip_seconds=18.0,
            current_clip_total_seconds=60.0,
            message="Clipping 2/10 (clip_2.mp4): 18s/60s (30%) • Overall 45%",
        )

        with main.jobs_lock:
            j = main.jobs[job_id]
            self.assertEqual(j["stage"], "clipping")
            self.assertEqual(j["current_clip"], 2)
            self.assertEqual(j["total_clips"], 10)
            self.assertEqual(j["stage_msg"], "Clipping 2/10 (clip_2.mp4): 18s/60s (30%) • Overall 45%")
            self.assertEqual(j["current_clip_seconds"], 18.0)

    def test_batch_publish_initialization(self):
        req = BatchPublishRequest(
            clip_paths=["sample_clip_1.mp4", "sample_clip_2.mp4"],
            targets=[PublishTarget(account_id="dummy_acc", platform="youtube")],
            title_prefix="Batch Test",
        )
        batch = pub_jobs.start_batch_publish_job(req)
        batch_id = batch["batch_id"]

        status = pub_jobs.get_batch_publish_job_status(batch_id)
        self.assertIsNotNone(status)
        self.assertEqual(status["total_clips"], 2)
        self.assertEqual(status["current_clip_index"], 0)
        self.assertEqual(status["current_clip_number"], 1)
        msg = (status.get("message", "") or status.get("stage_msg", "")).lower()
        self.assertTrue("files" in msg and "posting" in msg)

    def test_subtitle_job_storage(self):
        job_id = "test_sub_job_123"
        job_doc = {
            "job_id": job_id,
            "clip_name": "my_clip.mp4",
            "status": "processing",
            "progress": 35,
            "current_clip_progress": 35,
            "total_clips": 1,
            "current_clip": "my_clip.mp4",
            "current_clip_seconds": 21.0,
            "current_clip_total_seconds": 60.0,
            "message": "Mounting subtitles to my_clip.mp4: 21s/60s (35%)",
            "stage_msg": "Mounting subtitles to my_clip.mp4: 21s/60s (35%)",
        }
        _save_subtitle_job(job_doc)

        retrieved = _get_subtitle_job(job_id)
        self.assertIsNotNone(retrieved)
        self.assertEqual(retrieved["current_clip_progress"], 35)
        self.assertEqual(retrieved["current_clip_seconds"], 21.0)
        self.assertIn("21s/60s", retrieved["message"])


if __name__ == "__main__":
    unittest.main()
