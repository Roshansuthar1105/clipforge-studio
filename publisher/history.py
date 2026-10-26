"""
publisher/history.py — Manage publish log entries stored in data/publish_history.json.
"""

from storage import load_history, save_history, append_history_record, delete_history_record


def get_publish_history() -> list[dict]:
    return load_history()


def record_publish_job(record: dict) -> None:
    append_history_record(record)


def delete_publish_record(job_id: str) -> bool:
    return delete_history_record(job_id)
