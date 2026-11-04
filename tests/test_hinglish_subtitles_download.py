"""
tests/test_hinglish_subtitles_download.py
Unit tests verifying that:
1. Subtitle downloads default to Hinglish (Romanized Hindi A-Z).
2. Subtitle downloads contain ZERO Devanagari characters and ZERO English translations.
3. yt-dlp options prioritize Hinglish/Hindi and strictly exclude English subtitles.
"""
import sys
import unittest
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from services.ytdlp_utils import get_yt_dlp_options
from services.transcription_service import has_devanagari_characters
from routers.subtitles_router import download_subtitles_for_clip


class TestHinglishSubtitlesDownload(unittest.TestCase):

    def test_ytdlp_options_prioritize_hinglish_exclude_english(self):
        """yt-dlp options must configure subtitleslangs for Hindi/Hinglish and exclude English."""
        opts = get_yt_dlp_options()
        sub_langs = opts.get("subtitleslangs", [])

        self.assertIn("hi-Latn", sub_langs, "yt-dlp must prioritize hi-Latn (Hinglish)")
        self.assertIn("hi", sub_langs, "yt-dlp must prioritize hi (Hindi)")

        # Ensure NO English language codes exist in subtitleslangs
        for lang in sub_langs:
            self.assertFalse(
                lang.startswith("en"),
                f"English subtitle code '{lang}' must NOT be in yt-dlp subtitleslangs"
            )

        # Ensure Accept-Language prioritizes Hindi over English
        accept_lang = opts.get("http_headers", {}).get("Accept-Language", "")
        self.assertTrue(accept_lang.startswith("hi"), "Accept-Language must start with Hindi preference")

    def test_download_subtitles_srt_is_hinglish_not_devanagari_not_english(self):
        """download_subtitles_for_clip must return valid SRT with 0 Devanagari and 0 English translation."""
        clip_name = "GENZ TEACHERS - STAND UP COMEDY BY RAJAT CHAUHAN Part 1.mp4"
        response = download_subtitles_for_clip(clip_name, format="srt")

        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment;", response.headers.get("content-disposition", ""))
        self.assertTrue(response.headers.get("content-disposition", "").endswith('.srt"'))

        srt_content = response.body.decode("utf-8")
        self.assertGreater(len(srt_content), 50, "SRT content must not be empty")

        # Zero Devanagari characters
        self.assertFalse(
            has_devanagari_characters(srt_content),
            "Downloaded subtitles must NOT contain any Devanagari characters (must be Hinglish)"
        )

        # Zero English translation text
        lower_srt = srt_content.lower()
        self.assertNotIn("hi ma'am, you are also married", lower_srt)
        self.assertNotIn("where are you from?", lower_srt)
        self.assertNotIn("what's your name?", lower_srt)

        # Contains authentic Hinglish words
        self.assertTrue(
            any(hw in lower_srt for hw in ["pooch", "kuch", "aap", "toh", "hai", "mein", "bhi"]),
            "Downloaded subtitles must contain authentic Hinglish words"
        )

    def test_download_subtitles_ass_is_hinglish(self):
        """download_subtitles_for_clip must return valid ASS format with Hinglish dialogue events."""
        clip_name = "GENZ TEACHERS - STAND UP COMEDY BY RAJAT CHAUHAN Part 1.mp4"
        response = download_subtitles_for_clip(clip_name, format="ass")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.headers.get("content-disposition", "").endswith('.ass"'))

        ass_content = response.body.decode("utf-8")
        self.assertIn("[Script Info]", ass_content)
        self.assertIn("[V4+ Styles]", ass_content)
        self.assertIn("[Events]", ass_content)

        # Zero Devanagari characters
        self.assertFalse(
            has_devanagari_characters(ass_content),
            "Downloaded ASS subtitles must NOT contain Devanagari characters"
        )


if __name__ == "__main__":
    unittest.main()

