"""
storage.py — Thin JSON flat-file helpers for ClipForge Studio.

All persistent state (accounts, publish history) lives in two JSON files
inside the `data/` directory.  No database, no encryption — keep it simple
and local.
"""

import json
import threading
from pathlib import Path

# ──────────────────────────────────────────────────────────────────────────────
# File paths
# ──────────────────────────────────────────────────────────────────────────────

_DATA_DIR = Path(__file__).resolve().parent / "data"

ACCOUNTS_FILE = _DATA_DIR / "accounts.json"
HISTORY_FILE  = _DATA_DIR / "publish_history.json"

# ──────────────────────────────────────────────────────────────────────────────
# Low-level helpers
# ──────────────────────────────────────────────────────────────────────────────

_locks: dict[str, threading.Lock] = {}


def _lock_for(path: Path) -> threading.Lock:
    key = str(path)
    if key not in _locks:
        _locks[key] = threading.Lock()
    return _locks[key]


def read_json(path: Path, default: dict | None = None) -> dict:
    """Read a JSON file and return its content as a dict.
    Returns `default` (or {}) when the file does not exist or is malformed.
    """
    with _lock_for(path):
        if not path.exists():
            return default if default is not None else {}
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return default if default is not None else {}


def write_json(path: Path, data: dict) -> None:
    """Atomically write *data* to *path* as pretty-printed JSON."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with _lock_for(path):
        tmp = path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(data, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        tmp.replace(path)


# ──────────────────────────────────────────────────────────────────────────────
# Accounts helpers
# ──────────────────────────────────────────────────────────────────────────────

def load_accounts() -> list[dict]:
    return read_json(ACCOUNTS_FILE, {"accounts": []}).get("accounts", [])


def save_accounts(accounts: list[dict]) -> None:
    write_json(ACCOUNTS_FILE, {"accounts": accounts})


def find_account(account_id: str) -> dict | None:
    return next((a for a in load_accounts() if a["id"] == account_id), None)


def upsert_account(account: dict) -> None:
    accounts = load_accounts()
    for i, a in enumerate(accounts):
        if a["id"] == account["id"]:
            accounts[i] = account
            save_accounts(accounts)
            return
    accounts.append(account)
    save_accounts(accounts)


def delete_account(account_id: str) -> bool:
    accounts = load_accounts()
    new_list = [a for a in accounts if a["id"] != account_id]
    if len(new_list) == len(accounts):
        return False
    save_accounts(new_list)
    return True


# ──────────────────────────────────────────────────────────────────────────────
# Publish history helpers
# ──────────────────────────────────────────────────────────────────────────────

def load_history() -> list[dict]:
    return read_json(HISTORY_FILE, {"records": []}).get("records", [])


def save_history(records: list[dict]) -> None:
    write_json(HISTORY_FILE, {"records": records})


def append_history_record(record: dict) -> None:
    records = load_history()
    # Overwrite if same job_id already exists
    for i, r in enumerate(records):
        if r.get("job_id") == record.get("job_id"):
            records[i] = record
            save_history(records)
            return
    records.insert(0, record)   # newest first
    save_history(records)


def delete_history_record(job_id: str) -> bool:
    records = load_history()
    new_list = [r for r in records if r.get("job_id") != job_id]
    if len(new_list) == len(records):
        return False
    save_history(new_list)
    return True
