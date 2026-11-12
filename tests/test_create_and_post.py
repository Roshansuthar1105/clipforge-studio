import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import main
from main import (
    AutoPublishConfig,
    AutoPublishTargetConfig,
    ClipRequest,
    OverlayStyleConfig,
    _build_clip_overlays_for_part,
    _dispatch_auto_publish_for_job,
    _normalize_job_sub_styles,
)
from publisher.jobs import _compute_part_schedule_times
from publisher.models import BatchPublishRequest, PublishTarget
from publisher.schedule_models import CreateScheduleRequest
from publisher.youtube_publisher import _normalize_publish_at_iso, upload_to_youtube
from services.facebook_publisher import _fb_reel_finish, _fb_video_finish
from services.subtitle_service import build_ass_content


def test_clip_overlays_and_ass_generation():
    req = ClipRequest(
        url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        clip_length=60,
        max_clips=3,
        title_overlay=OverlayStyleConfig(
            enabled=True,
            text="Funny Standup {part}",
            position_y_pct=12,
            box_style="banner",
        ),
        part_overlay=OverlayStyleConfig(
            enabled=True,
            text="Part {part}",
            position_y_pct=20,
            box_style="box",
        ),
    )

    overlays = _build_clip_overlays_for_part(req, part_num=2, formatted_title="Funny Standup 2", is_viral=False)
    assert len(overlays) == 2
    assert overlays[0]["text"] == "Funny Standup 2"
    assert overlays[1]["text"] == "Part 2"

    styles = _normalize_job_sub_styles({"words_per_screen": 4, "position_percent": 80})
    assert styles["words_per_screen"] == 4
    assert styles["margin_v"] == int(round(1920 * 0.2))

    # build_ass_content should emit overlay styles + dialogues even when cues=[]
    ass_text = build_ass_content([], style=styles, overlays=overlays)
    assert "FUNNY STANDUP 2" in ass_text
    assert "PART 2" in ass_text
    assert "Dialogue:" in ass_text


def test_facebook_reel_and_video_native_scheduling():
    import asyncio

    captured_posts = []

    class FakeAsyncClient:
        async def post(self, url, data=None, **kwargs):
            captured_posts.append((url, data))
            resp = MagicMock()
            resp.status_code = 200
            resp.json.return_value = {"success": True, "id": "fb_vid_123"}
            resp.raise_for_status = MagicMock()
            return resp

    fake_client = FakeAsyncClient()

    async def _run():
        await _fb_reel_finish(
            fake_client, "page_1", "vid_1", "tok_1",
            title="Reel Title", description="Part 1 caption",
            scheduled_publish_time=1900000000,
        )
        await _fb_video_finish(
            fake_client, "page_1", "sess_1", "tok_2",
            title="Feed Title", description="Feed Desc",
            scheduled_publish_time=1900003600,
        )

    asyncio.run(_run())

    assert len(captured_posts) == 2
    reel_url, reel_data = captured_posts[0]
    assert "video_reels" in reel_url
    assert reel_data["upload_phase"] == "finish"
    assert reel_data["video_state"] == "SCHEDULED"
    assert reel_data["scheduled_publish_time"] == "1900000000"

    vid_url, vid_data = captured_posts[1]
    assert "videos" in vid_url
    assert vid_data["published"] == "false"
    assert vid_data["scheduled_publish_time"] == "1900003600"


def test_youtube_native_schedule_and_tags():
    assert _normalize_publish_at_iso("2026-12-01T10:30:00Z") == "2026-12-01T10:30:00Z"

    fake_insert_calls = []

    class FakeInsert:
        def __init__(self, kwargs):
            self.kwargs = kwargs

        def next_chunk(self):
            return None, {"id": "yt_short_999"}

    class FakeVideos:
        def insert(self, **kwargs):
            fake_insert_calls.append(kwargs)
            return FakeInsert(kwargs)

    fake_service = MagicMock()
    fake_service.videos.return_value = FakeVideos()

    fake_acc = {"id": "yt_acc_1", "platform": "youtube"}
    with patch("publisher.youtube_publisher.get_youtube_service", return_value=(fake_service, fake_acc)), \
         patch("publisher.youtube_publisher.upsert_account"), \
         patch("publisher.youtube_publisher.MediaFileUpload", return_value=MagicMock()), \
         patch("pathlib.Path.exists", return_value=True):
        res = upload_to_youtube(
            account=fake_acc,
            video_path=Path("dummy.mp4"),
            title="Test Short #shorts",
            description="Test desc",
            tags=["comedy", "shorts"],
            privacy_status="public",
            publish_at="2026-12-01T10:30:00Z",
        )

    assert res["video_id"] == "yt_short_999"
    body = fake_insert_calls[0]["body"]
    assert body["snippet"]["tags"] == ["comedy", "shorts"]
    assert body["status"]["privacyStatus"] == "private"
    assert body["status"]["publishAt"] == "2026-12-01T10:30:00Z"


def test_stagger_schedule_computation_and_models():
    iso_0, unix_0 = _compute_part_schedule_times("2026-12-01T10:00:00Z", offset_minutes=0)
    iso_1, unix_1 = _compute_part_schedule_times("2026-12-01T10:00:00Z", offset_minutes=90)
    assert iso_0 == "2026-12-01T10:00:00Z"
    assert iso_1 == "2026-12-01T11:30:00Z"
    assert unix_1 - unix_0 == 5400

    req = CreateScheduleRequest(
        clip_path="clip_1.mp4",
        targets=[PublishTarget(account_id="ig_1", platform="instagram")],
        title="Part 1",
        tags=["reels", "viral"],
        scheduled_time="2026-12-01T10:00:00Z",
    )
    assert req.tags == ["reels", "viral"]

    batch = BatchPublishRequest(
        clip_paths=["p1.mp4", "p2.mp4"],
        targets=[PublishTarget(account_id="fb_1", platform="facebook")],
        tags=["reels"],
        publish_at="2026-12-01T10:00:00Z",
        stagger_minutes=60,
        facebook_as_reel=True,
    )
    assert batch.stagger_minutes == 60
    assert batch.publish_at == "2026-12-01T10:00:00Z"


def test_auto_publish_dispatch_modes():
    created_files = [
        {"filename": "Clip Part 1.mp4", "relative_path": "Out/Clip Part 1.mp4"},
        {"filename": "Clip Part 2.mp4", "relative_path": "Out/Clip Part 2.mp4"},
    ]
    targets = [
        AutoPublishTargetConfig(account_id="fb_1", platform="facebook"),
        AutoPublishTargetConfig(account_id="yt_1", platform="youtube"),
        AutoPublishTargetConfig(account_id="ig_1", platform="instagram"),
    ]

    # 1. Native schedule routes FB+YT to start_batch_publish_job AND IG to create_scheduled_post
    req_native = ClipRequest(
        url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        title="My Show",
        auto_publish=AutoPublishConfig(
            enabled=True,
            mode="native_schedule",
            targets=targets,
            title="My Show - Part {part}",
            caption="Caption {part}",
            tags=["comedy"],
            scheduled_time="2026-12-01T10:00:00Z",
            stagger_minutes=45,
        ),
    )

    batch_calls = []
    sched_calls = []

    def fake_start_batch(batch_req):
        batch_calls.append(batch_req)
        return {"batch_id": "batch_native_1"}

    def fake_create_sched(sched_req, user_id=None):
        sched_calls.append(sched_req)
        return {"id": f"sched_{len(sched_calls)}"}

    with patch("publisher.jobs.start_batch_publish_job", side_effect=fake_start_batch), \
         patch("publisher.scheduler.create_scheduled_post", side_effect=fake_create_sched):
        meta = _dispatch_auto_publish_for_job("job_1", req_native, created_files, user_id="u1")

    assert meta["publish_batch_id"] == "batch_native_1"
    assert len(meta["scheduled_post_ids"]) == 2
    assert len(batch_calls) == 1
    assert [t.platform for t in batch_calls[0].targets] == ["facebook", "youtube"]
    assert batch_calls[0].publish_at == "2026-12-01T10:00:00Z"
    assert batch_calls[0].stagger_minutes == 45
    assert sched_calls[0].targets[0].platform == "instagram"
    assert sched_calls[0].scheduled_time == "2026-12-01T10:00:00Z"
    assert sched_calls[1].scheduled_time == "2026-12-01T10:45:00Z"
    assert sched_calls[0].tags == ["comedy"]

    # 2. Backend schedule queues all 3 platforms for both parts (2 scheduled posts, 3 targets each)
    sched_calls.clear()
    req_backend = req_native.model_copy(deep=True)
    req_backend.auto_publish.mode = "backend_schedule"
    with patch("publisher.scheduler.create_scheduled_post", side_effect=fake_create_sched):
        meta_be = _dispatch_auto_publish_for_job("job_2", req_backend, created_files, user_id="u1")

    assert len(meta_be["scheduled_post_ids"]) == 2
    assert len(sched_calls[0].targets) == 3

    # 3. Post Now dispatches batch publish across all 3 platforms immediately
    batch_calls.clear()
    req_now = req_native.model_copy(deep=True)
    req_now.auto_publish.mode = "now"
    with patch("publisher.jobs.start_batch_publish_job", side_effect=fake_start_batch):
        meta_now = _dispatch_auto_publish_for_job("job_3", req_now, created_files, user_id="u1")

    assert meta_now["publish_batch_id"] == "batch_native_1"
    assert len(batch_calls[0].targets) == 3
    assert batch_calls[0].publish_at is None
