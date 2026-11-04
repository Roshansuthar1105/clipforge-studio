"""
scripts/restore_hinglish_subtitles.py
Ensures all subtitles across the workspace are 100% Hinglish:
1. Converts any remaining Devanagari text into clean Hinglish.
2. Identifies any clips that were mistakenly translated into pure English words,
   re-slices from the raw Hindi transcript, and converts them to authentic Hinglish.
"""
import sys
import json
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from services.transcription_service import (
    has_devanagari_characters,
    convert_cues_to_hinglish,
    get_stored_transcript,
    slice_transcript_for_clip,
    create_voice_synced_word_chunks,
    save_clip_subtitles,
)

DATA_DIR = PROJECT_ROOT / "data"
CLIPS_DIR = DATA_DIR / "clips"
TRANSCRIPTS_DIR = DATA_DIR / "transcripts"


def restore_all_to_hinglish():
    if not CLIPS_DIR.exists():
        print("Clips directory does not exist.")
        return

    sub_files = list(CLIPS_DIR.rglob("*.subtitles.json"))
    print(f"Checking {len(sub_files)} subtitle files for Hinglish compliance...")

    converted_devanagari = 0
    restored_from_raw = 0

    for sub_path in sub_files:
        try:
            with open(sub_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            cues = data.get("cues", [])
            if not cues:
                continue

            stem = sub_path.stem.replace(".subtitles", "").replace(".mp4", "")

            # 1. Check for Devanagari characters
            if any(has_devanagari_characters(c.get("text", "")) for c in cues):
                print(f"[CONVERT DEVANAGARI -> HINGLISH] {sub_path.name}")
                new_cues = convert_cues_to_hinglish(cues)
                data["cues"] = new_cues
                with open(sub_path, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                converted_devanagari += 1
                continue

            # 2. Check if clip has a raw Hindi transcript that had been translated to English
            raw_tr = get_stored_transcript(f"{stem}_raw")
            if not raw_tr:
                meta_p = sub_path.with_name(f"{stem}.mp4.meta.json")
                if not meta_p.exists():
                    meta_p = sub_path.with_name(f"{stem}.meta.json")
                if meta_p.exists():
                    try:
                        with open(meta_p, "r", encoding="utf-8") as fm:
                            meta = json.load(fm)
                            src_id = meta.get("source_video_id")
                            if src_id:
                                raw_tr = get_stored_transcript(f"{src_id}_raw")
                    except Exception:
                        pass

            if raw_tr and any(has_devanagari_characters(s.get("text", "")) for s in raw_tr.get("segments", [])):
                # Raw audio was Hindi! Check if existing cues look like an English translation
                first_texts = " ".join([c.get("text", "") for c in cues[:5]]).lower()
                known_en_phrases = ["you are also", "where are you", "what's your", "how are you", "good morning", "i am", "who is"]
                if any(phrase in first_texts for phrase in known_en_phrases):
                    print(f"[RECOVER ENGLISH TRANSLATION -> HINGLISH] {sub_path.name}")
                    raw_segs = raw_tr.get("segments", [])
                    if f"{stem}_raw" in str(raw_tr.get("video_id", "")):
                        chunks = create_voice_synced_word_chunks(raw_segs, max_words=3)
                        new_cues = convert_cues_to_hinglish(chunks)
                    else:
                        meta_p = sub_path.with_name(f"{stem}.mp4.meta.json")
                        if not meta_p.exists():
                            meta_p = sub_path.with_name(f"{stem}.meta.json")
                        with open(meta_p, "r", encoding="utf-8") as fm:
                            meta = json.load(fm)
                        c_st = float(meta.get("clip_start", 0.0))
                        c_en = float(meta.get("clip_end", 0.0))
                        raw_sliced = slice_transcript_for_clip(raw_tr, c_st, c_en)
                        chunks = create_voice_synced_word_chunks(raw_sliced, max_words=3)
                        new_cues = convert_cues_to_hinglish(chunks)

                    data["cues"] = new_cues
                    with open(sub_path, "w", encoding="utf-8") as f:
                        json.dump(data, f, indent=2, ensure_ascii=False)
                    restored_from_raw += 1

        except Exception as exc:
            print(f"[ERROR] {sub_path.name}: {exc}")

    print(f"\nDone! Converted {converted_devanagari} Devanagari files and restored {restored_from_raw} English-translated files to Hinglish.")


if __name__ == "__main__":
    restore_all_to_hinglish()

