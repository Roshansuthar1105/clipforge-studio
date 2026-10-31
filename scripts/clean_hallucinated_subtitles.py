import os
import sys
import json
import re
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from services.transcription_service import (
    is_hallucinated_prompt_segment,
    clean_hallucinated_text,
    sanitize_word_list,
    has_devanagari_characters,
    convert_cues_to_hinglish,
    save_clip_subtitles,
)

DATA_DIR = PROJECT_ROOT / "data"

def sanitize_transcripts():
    transcripts_dir = DATA_DIR / "transcripts"
    if not transcripts_dir.exists():
        return

    cleaned_count = 0
    for p in transcripts_dir.glob("*.json"):
        try:
            with open(p, "r", encoding="utf-8") as f:
                content = f.read()
            if "do not translate" in content.lower():
                print(f"[TRANSCRIPT] Removing corrupted transcript: {p.name}")
                p.unlink(missing_ok=True)
                cleaned_count += 1
            elif "_hi.json" in p.name or "_hi_" in p.name:
                print(f"[TRANSCRIPT] Removing legacy forced-language transcript: {p.name}")
                p.unlink(missing_ok=True)
                cleaned_count += 1
        except Exception as exc:
            print(f"[TRANSCRIPT ERROR] {p.name}: {exc}")
    print(f"Purged {cleaned_count} corrupted transcript files.")


def sanitize_subtitle_files():
    clips_dir = DATA_DIR / "clips"
    if not clips_dir.exists():
        return

    modified_count = 0
    for sub_path in clips_dir.rglob("*.subtitles.json"):
        try:
            with open(sub_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            cues = data.get("cues", [])
            orig_len = len(cues)

            # Clean and filter cues
            cleaned_cues = []
            for c in cues:
                raw_t = str(c.get("text", "")).strip()
                cl_t = clean_hallucinated_text(raw_t)
                if cl_t and not is_hallucinated_prompt_segment(raw_t):
                    c_copy = dict(c)
                    c_copy["text"] = cl_t
                    if "words" in c_copy and isinstance(c_copy["words"], list):
                        c_copy["words"] = sanitize_word_list(c_copy["words"])
                    cleaned_cues.append(c_copy)

            if len(cleaned_cues) != orig_len or not cleaned_cues:
                if not cleaned_cues:
                    print(f"[SUBTITLE] All cues were hallucinations; removing to regenerate from audio: {sub_path.name}")
                    sub_path.unlink(missing_ok=True)
                else:
                    print(f"[SUBTITLE] Cleaned {orig_len - len(cleaned_cues)} cue(s) from {sub_path.name}")
                    for idx, c in enumerate(cleaned_cues):
                        c["id"] = idx
                    data["cues"] = cleaned_cues
                    with open(sub_path, "w", encoding="utf-8") as f:
                        json.dump(data, f, indent=2, ensure_ascii=False)

                    # Update companion meta.json caption
                    meta_candidates = [
                        sub_path.parent / sub_path.name.replace(".subtitles.json", ".meta.json"),
                        sub_path.parent / (sub_path.name.replace(".mp4.subtitles.json", ".mp4") + ".meta.json"),
                    ]
                    for meta_path in meta_candidates:
                        if meta_path.exists():
                            try:
                                with open(meta_path, "r", encoding="utf-8") as mf:
                                    meta_data = json.load(mf)
                                new_caption = clean_hallucinated_text(" ".join(c.get("text", "").strip() for c in cleaned_cues if c.get("text", "").strip()))
                                meta_data["caption"] = new_caption
                                meta_data["description"] = new_caption
                                with open(meta_path, "w", encoding="utf-8") as mf:
                                    json.dump(meta_data, mf, indent=2, ensure_ascii=False)
                                print(f"[META] Updated caption for {meta_path.name}")
                            except Exception as m_err:
                                print(f"[META ERROR] {meta_path.name}: {m_err}")
                modified_count += 1
        except Exception as exc:
            print(f"[SUBTITLE ERROR] {sub_path.name}: {exc}")

    # Also clean any meta.json files that retained "Do not translate" in their caption
    for meta_path in clips_dir.rglob("*.meta.json"):
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
            caption = meta.get("caption", "")
            if "do not translate" in caption.lower():
                cleaned_cap = clean_hallucinated_text(caption)
                meta["caption"] = cleaned_cap
                meta["description"] = cleaned_cap
                with open(meta_path, "w", encoding="utf-8") as f:
                    json.dump(meta, f, indent=2, ensure_ascii=False)
                print(f"[META] Purged prompt hallucination from caption in {meta_path.name}")
        except Exception as exc:
            print(f"[META ERROR] {meta_path.name}: {exc}")

    print(f"Sanitized subtitle and metadata files. Total modified: {modified_count}")


if __name__ == "__main__":
    print("Starting sanitization...")
    sanitize_transcripts()
    sanitize_subtitle_files()
    print("Sanitization complete.")
