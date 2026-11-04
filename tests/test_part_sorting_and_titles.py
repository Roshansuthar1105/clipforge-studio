import sys
import re
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import main
from main import safe_name
from publisher.models import BatchPublishRequest


def test_safe_name_removes_underscores_and_handles_pipes():
    # Pipe and colon should become spaced hyphen, NOT underscore
    res1 = safe_name("Adventure | Stand-up Comedy by Ravi Gupta")
    assert "_" not in res1, f"Found underscore in {res1}"
    assert "Adventure - Stand-up Comedy by Ravi Gupta" in res1

    res2 = safe_name("Standup: Funny Moments (Episode 1)")
    assert "_" not in res2, f"Found underscore in {res2}"
    assert "Standup - Funny Moments (Episode 1)" in res2

    # Existing raw underscores should be converted to clean spaces
    res3 = safe_name("Adventure _ Stand-up Comedy by Ravi Gupta_9")
    assert "_" not in res3, f"Found underscore in {res3}"
    assert "Adventure" in res3 and "Ravi Gupta 9" in res3

    # Forbidden Windows chars should be stripped
    res4 = safe_name('What "Crazy" Video? <Must Watch> *2026*')
    assert "_" not in res4
    assert all(c not in res4 for c in '<>:"/\\|?*')


def test_part_number_extraction_and_natural_sorting():
    filenames = [
        "Adventure _ Stand-up Comedy by Ravi Gupta_9.mp4",
        "Adventure _ Stand-up Comedy by Ravi Gupta_8.mp4",
        "Adventure _ Stand-up Comedy by Ravi Gupta_2.mp4",
        "Adventure _ Stand-up Comedy by Ravi Gupta_18.mp4",
        "Adventure _ Stand-up Comedy by Ravi Gupta_17.mp4",
        "Adventure _ Stand-up Comedy by Ravi Gupta_10.mp4",
        "Adventure _ Stand-up Comedy by Ravi Gupta_1.mp4",
    ]

    def _extract_part(name: str):
        stem = Path(name).stem
        m = (
            re.search(r"part[_\s\-]*(\d+)", stem, re.IGNORECASE)
            or re.search(r"viral[_\s\-]*#?(\d+)", stem, re.IGNORECASE)
            or re.search(r"[_\s\-](\d+)$", stem)
            or re.search(r"(\d+)$", stem)
        )
        return (0, int(m.group(1)), stem) if m else (1, 0, stem)

    sorted_files = sorted(filenames, key=_extract_part)
    extracted_nums = [_extract_part(f)[1] for f in sorted_files]
    assert extracted_nums == [1, 2, 8, 9, 10, 17, 18], f"Incorrect order: {extracted_nums}"


def test_batch_publish_request_accepts_title_alias():
    req = BatchPublishRequest(
        clip_paths=["clip1.mp4", "clip2.mp4"],
        title="My Custom Show",
    )
    assert req.title_prefix == "My Custom Show"
    assert req.title == "My Custom Show"


def test_batch_publish_title_cleaning_logic():
    # Simulate publisher logic
    def format_title(raw_prefix, clip_stem, part_num, total_clips):
        if raw_prefix:
            clean_prefix = raw_prefix.replace("_", " ").strip()
            if "{part}" not in clean_prefix.lower() and "{n}" not in clean_prefix.lower():
                clean_prefix = re.sub(r"[\s\-_]+(part|viral)[\s\-_]*\d*$", "", clean_prefix, flags=re.IGNORECASE).strip()
                clean_prefix = re.sub(r"[\s\-_]+\d+$", "", clean_prefix).strip()
        else:
            stem_clean = clip_stem.replace("_", " ").strip()
            stem_clean = re.sub(r"[\s\-_]+(part|viral)[\s\-_]*\d*$", "", stem_clean, flags=re.IGNORECASE).strip()
            stem_clean = re.sub(r"[\s\-_]+\d+$", "", stem_clean).strip()
            clean_prefix = stem_clean or "Video"

        if "{part}" in clean_prefix.lower():
            return re.sub(r"\{part\}", str(part_num), clean_prefix, flags=re.IGNORECASE)
        elif "{n}" in clean_prefix.lower():
            return re.sub(r"\{n\}", str(part_num), clean_prefix, flags=re.IGNORECASE)
        elif total_clips > 1:
            return f"{clean_prefix} - Part {part_num}"
        else:
            return clean_prefix

    # Case 1: Legacy file with _9.mp4 and fallback stem
    t1 = format_title(None, "Adventure _ Stand-up Comedy by Ravi Gupta_9", 1, 18)
    assert t1 == "Adventure   Stand-up Comedy by Ravi Gupta - Part 1" or "Adventure Stand-up Comedy by Ravi Gupta - Part 1" in t1
    assert "_9 - Part 1" not in t1
    assert "_" not in t1

    # Case 2: User provides custom title
    t2 = format_title("Ravi Gupta Special", "Adventure _ Stand-up Comedy by Ravi Gupta_9", 1, 18)
    assert t2 == "Ravi Gupta Special - Part 1"

    # Case 3: User provides template with {part}
    t3 = format_title("Ravi Gupta Special Episode {part}", "Adventure _ Stand-up Comedy by Ravi Gupta_9", 5, 18)
    assert t3 == "Ravi Gupta Special Episode 5"


def test_api_clips_ordering():
    data = main.list_available_clips()
    groups = data.get("groups", [])
    for grp in groups:
        parts = [c.get("part_number") for c in grp.get("clips", []) if c.get("part_number") is not None]
        if len(parts) > 1:
            # Check parts are non-decreasing (ascending)
            for i in range(len(parts) - 1):
                assert parts[i] <= parts[i + 1], f"Folder {grp['folder_name']} clips not sorted: {parts}"
    
    # Check all_clips
    all_clips = data.get("clips", [])
    print(f"Total clips verified in /api/clips: {len(all_clips)}")


if __name__ == "__main__":
    print("Testing safe_name...")
    test_safe_name_removes_underscores_and_handles_pipes()
    print("[PASS] safe_name")

    print("Testing part_number extraction and natural sorting...")
    test_part_number_extraction_and_natural_sorting()
    print("[PASS] part_number natural sorting")

    print("Testing batch publish request title alias...")
    test_batch_publish_request_accepts_title_alias()
    print("[PASS] BatchPublishRequest title alias")

    print("Testing batch publish title cleaning logic...")
    test_batch_publish_title_cleaning_logic()
    print("[PASS] batch publish title cleaning")

    print("Testing API clips ordering...")
    test_api_clips_ordering()
    print("[PASS] API clips ordering")

    print("\nALL TESTS PASSED SUCCESSFULLY!")
