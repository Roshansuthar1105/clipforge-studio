"""
tests/test_no_raw_copy_and_no_thumb.py
Unit tests verifying that:
1. Querying clip subtitles does NOT create a {video_name}.raw.mp4 copy on disk.
2. ensure_clip_thumbnail does NOT run FFmpeg or generate new .thumb.jpg files on disk.
3. Subtitle cues with Hindi audio are converted to Hinglish (Latin alphabet) with 0 Devanagari.
"""
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import main
from main import ensure_clip_thumbnail
from routers.subtitles_router import get_subtitles_for_clip, refresh_clip_thumbnail
from services.transcription_service import (
    convert_cues_to_hinglish,
    has_devanagari_characters,
    CLIPS_DIR,
)


class TestNoRawCopyAndNoThumb(unittest.TestCase):

    def test_get_subtitles_does_not_create_raw_mp4(self):
        """Playing/retrieving subtitles for a clip must NEVER duplicate the clip to .raw.mp4."""
        test_clip_name = "GENZ TEACHERS - STAND UP COMEDY BY RAJAT CHAUHAN Part 1.mp4"
        test_clip_path = CLIPS_DIR / test_clip_name

        # If clip exists in test environment, verify .raw.mp4 is not created
        if test_clip_path.exists():
            raw_path = test_clip_path.with_name(f"{test_clip_path.stem}.raw.mp4")
            if raw_path.exists():
                raw_path.unlink()

            res = get_subtitles_for_clip(test_clip_name)
            self.assertIsNotNone(res)
            self.assertFalse(raw_path.exists(), "get_subtitles_for_clip MUST NOT create .raw.mp4")

    def test_ensure_clip_thumbnail_does_not_create_thumb_on_disk(self):
        """ensure_clip_thumbnail must not run FFmpeg to generate .thumb.jpg files."""
        fake_clip = CLIPS_DIR / "temp_test_clip_without_thumb.mp4"
        fake_thumb = CLIPS_DIR / "temp_test_clip_without_thumb.thumb.jpg"
        if fake_thumb.exists():
            fake_thumb.unlink()

        try:
            fake_clip.write_text("fake video content", encoding="utf-8")
            res = ensure_clip_thumbnail(fake_clip)
            self.assertIsNone(res, "ensure_clip_thumbnail should return None when no thumb exists")
            self.assertFalse(fake_thumb.exists(), "ensure_clip_thumbnail MUST NOT create .thumb.jpg on disk")
        finally:
            if fake_clip.exists():
                fake_clip.unlink()
            if fake_thumb.exists():
                fake_thumb.unlink()

    def test_refresh_clip_thumbnail_is_noop(self):
        """refresh_clip_thumbnail must be a harmless no-op."""
        fake_clip = CLIPS_DIR / "temp_test_clip_refresh.mp4"
        res = refresh_clip_thumbnail(fake_clip)
        self.assertIsNone(res)

    def test_hinglish_conversion_produces_latin_alphabet_zero_devanagari(self):
        """convert_cues_to_hinglish must convert Hindi speech into Romanized Hinglish with 0 Devanagari."""
        sample_cues = [
            {"text": "नमस्ते दोस्त", "start": 0.0, "end": 1.5},
            {"text": "आप कैसे हैं", "start": 1.5, "end": 3.0},
        ]
        res = convert_cues_to_hinglish(sample_cues)
        self.assertTrue(len(res) == 2)
        for cue in res:
            self.assertFalse(
                has_devanagari_characters(cue["text"]),
                f"Cue '{cue['text']}' must not contain Devanagari characters"
            )


if __name__ == "__main__":
    unittest.main()

