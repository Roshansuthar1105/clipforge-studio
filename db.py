"""
db.py — MongoDB Database layer for ClipForge Studio.

Provides persistence for:
  - Users & Authentication (Signup, Login, Sessions)
  - User-scoped Connected Social Accounts (YouTube, Instagram, Facebook)
  - Background Video Processing Jobs & History
  - Publishing History
"""

import os
import secrets
import hashlib
import datetime
import logging
from typing import Optional, Dict, Any, List
from pathlib import Path
from dotenv import load_dotenv
import pymongo
from pymongo.errors import ConnectionFailure, PyMongoError

load_dotenv()

logger = logging.getLogger("clipforge.db")

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017/clipforge")

_client: Optional[pymongo.MongoClient] = None
_db = None


def get_db():
    global _client, _db
    if _db is not None:
        return _db
    try:
        _client = pymongo.MongoClient(MONGODB_URI, serverSelectionTimeoutMS=2000)
        # Verify connection
        _client.admin.command("ping")
        # Extract database name from URI, default to 'clipforge'
        parsed_db_name = pymongo.uri_parser.parse_uri(MONGODB_URI).get("database") or "clipforge"
        _db = _client[parsed_db_name]
        logger.info("Connected to MongoDB successfully: %s", parsed_db_name)

        # Ensure indexes
        _db.users.create_index("username", unique=True)
        _db.users.create_index("email", unique=True)
        _db.sessions.create_index("token", unique=True)
        _db.sessions.create_index("expires_at", expireAfterSeconds=0)
        _db.accounts.create_index([("user_id", pymongo.ASCENDING), ("id", pymongo.ASCENDING)])
        _db.jobs.create_index([("user_id", pymongo.ASCENDING), ("created_at", pymongo.DESCENDING)])
        _db.jobs.create_index("id", unique=True)
        return _db
    except Exception as exc:
        logger.warning("MongoDB connection failed (%s); fallback mode enabled.", exc)
        return None


def is_db_connected() -> bool:
    try:
        db = get_db()
        return db is not None
    except Exception:
        return False


# ──────────────────────────────────────────────────────────────────────────────
# Password & Auth Utilities
# ──────────────────────────────────────────────────────────────────────────────

def _hash_password(password: str, salt: Optional[str] = None) -> tuple[str, str]:
    if not salt:
        salt = secrets.token_hex(16)
    hashed = hashlib.sha256((salt + password).encode("utf-8")).hexdigest()
    return hashed, salt


def _verify_password(password: str, hashed: str, salt: str) -> bool:
    expected, _ = _hash_password(password, salt)
    return secrets.compare_digest(expected, hashed)


# ──────────────────────────────────────────────────────────────────────────────
# User Management
# ──────────────────────────────────────────────────────────────────────────────

def create_user(username: str, email: str, password: str, name: str = "") -> Dict[str, Any]:
    db = get_db()
    if db is None:
        raise RuntimeError("MongoDB is not connected")

    username = username.strip().lower()
    email = email.strip().lower()

    if not username or not password:
        raise ValueError("Username and password are required")

    if db.users.find_one({"username": username}):
        raise ValueError("Username is already taken")

    if email and db.users.find_one({"email": email}):
        raise ValueError("Email is already registered")

    pwd_hash, salt = _hash_password(password)
    user_id = secrets.token_hex(12)
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()

    user_doc = {
        "_id": user_id,
        "id": user_id,
        "username": username,
        "email": email,
        "name": name.strip() or username.capitalize(),
        "password_hash": pwd_hash,
        "salt": salt,
        "created_at": now,
    }

    db.users.insert_one(user_doc)
    return {
        "id": user_id,
        "username": username,
        "email": email,
        "name": user_doc["name"],
        "created_at": now,
    }


def authenticate_user(username_or_email: str, password: str) -> Optional[Dict[str, Any]]:
    db = get_db()
    if db is None:
        return None

    query = username_or_email.strip().lower()
    user = db.users.find_one({"$or": [{"username": query}, {"email": query}]})
    if not user:
        return None

    if not _verify_password(password, user.get("password_hash", ""), user.get("salt", "")):
        return None

    return {
        "id": user["id"],
        "username": user["username"],
        "email": user.get("email", ""),
        "name": user.get("name", user["username"]),
        "created_at": user.get("created_at"),
    }


def create_session(user_id: str, days_valid: int = 30) -> str:
    db = get_db()
    token = secrets.token_urlsafe(32)
    now = datetime.datetime.now(datetime.timezone.utc)
    expires = now + datetime.timedelta(days=days_valid)

    if db is not None:
        db.sessions.insert_one({
            "token": token,
            "user_id": user_id,
            "created_at": now,
            "expires_at": expires,
        })
    return token


def get_user_by_token(token: str) -> Optional[Dict[str, Any]]:
    db = get_db()
    if db is None or not token:
        return None

    session = db.sessions.find_one({"token": token})
    if not session:
        return None

    # Check expiration
    if session.get("expires_at"):
        exp = session["expires_at"]
        if isinstance(exp, str):
            exp = datetime.datetime.fromisoformat(exp)
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=datetime.timezone.utc)
        if exp < datetime.datetime.now(datetime.timezone.utc):
            db.sessions.delete_one({"token": token})
            return None

    user = db.users.find_one({"id": session["user_id"]})
    if not user:
        return None

    return {
        "id": user["id"],
        "username": user["username"],
        "email": user.get("email", ""),
        "name": user.get("name", user["username"]),
        "created_at": user.get("created_at"),
    }


def revoke_session(token: str) -> bool:
    db = get_db()
    if db is not None and token:
        res = db.sessions.delete_one({"token": token})
        return res.deleted_count > 0
    return False


# ──────────────────────────────────────────────────────────────────────────────
# User-scoped Connected Accounts
# ──────────────────────────────────────────────────────────────────────────────

def db_load_accounts(user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    db = get_db()
    if db is None:
        # Fallback to local file if mongo not available
        import storage
        return storage.load_accounts(user_id)

    if user_id and user_id != "global":
        query = {"$or": [{"user_id": user_id}, {"user_id": "global"}]}
    else:
        query = {"user_id": "global"}

    cursor = db.accounts.find(query)
    results = []
    for doc in cursor:
        doc.pop("_id", None)
        results.append(doc)
    return results


def db_find_account(account_id: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    db = get_db()
    if db is None:
        import storage
        return storage.find_account(account_id, user_id)

    query: dict[str, Any] = {"id": account_id}
    if user_id and user_id != "global":
        query["$or"] = [{"user_id": user_id}, {"user_id": "global"}]

    doc = db.accounts.find_one(query)
    if doc:
        doc.pop("_id", None)
    return doc


def db_upsert_account(account: Dict[str, Any], user_id: Optional[str] = None) -> None:
    db = get_db()
    if user_id:
        account["user_id"] = user_id
    elif "user_id" not in account or not account["user_id"]:
        account["user_id"] = "global"

    if db is None:
        import storage
        storage.upsert_account(account, user_id)
        return

    doc = dict(account)
    db.accounts.replace_one(
        {"id": account["id"]},
        doc,
        upsert=True,
    )


def db_delete_account(account_id: str, user_id: Optional[str] = None) -> bool:
    db = get_db()
    if db is None:
        import storage
        return storage.delete_account(account_id, user_id)

    query: dict[str, Any] = {"id": account_id}
    if user_id and user_id != "global":
        query["$or"] = [{"user_id": user_id}, {"user_id": "global"}]

    res = db.accounts.delete_one(query)
    return res.deleted_count > 0


# ──────────────────────────────────────────────────────────────────────────────
# Video Processing Jobs Tracking
# ──────────────────────────────────────────────────────────────────────────────

def db_save_job(job_data: Dict[str, Any]) -> None:
    db = get_db()
    if db is None:
        return

    job_id = job_data.get("id") or job_data.get("job_id")
    if not job_id:
        return

    doc = dict(job_data)
    doc["_id"] = job_id
    doc["id"] = job_id
    if "updated_at" not in doc:
        doc["updated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()

    db.jobs.replace_one({"id": job_id}, doc, upsert=True)


def db_get_job(job_id: str) -> Optional[Dict[str, Any]]:
    db = get_db()
    if db is None:
        return None

    doc = db.jobs.find_one({"id": job_id})
    if doc:
        doc.pop("_id", None)
    return doc


def db_list_jobs(user_id: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
    db = get_db()
    if db is None:
        return []

    query = {}
    if user_id and user_id != "global":
        query["$or"] = [{"user_id": user_id}, {"user_id": "guest"}, {"user_id": "global"}, {"user_id": {"$exists": False}}]

    cursor = db.jobs.find(query).sort("created_at", pymongo.DESCENDING).limit(limit)
    jobs = []
    for doc in cursor:
        doc.pop("_id", None)
        jobs.append(doc)
    return jobs


def db_delete_job(job_id: str, user_id: Optional[str] = None) -> bool:
    db = get_db()
    if db is None:
        return False
    query: dict[str, Any] = {"id": job_id}
    if user_id and user_id != "global":
        query["$or"] = [{"user_id": user_id}, {"user_id": "guest"}, {"user_id": "global"}]
    res = db.jobs.delete_one(query)
    return res.deleted_count > 0


def db_clear_completed_jobs(user_id: Optional[str] = None) -> int:
    """Clear completed or cancelled jobs for a user."""
    db = get_db()
    if db is None:
        return 0
    query: dict[str, Any] = {"status": {"$in": ["completed", "cancelled", "failed"]}}
    if user_id and user_id != "global":
        query["$or"] = [{"user_id": user_id}, {"user_id": "guest"}, {"user_id": "global"}]
    res = db.jobs.delete_many(query)
    return res.deleted_count


def db_cleanup_stale_jobs() -> int:
    """Mark any jobs left in 'queued', 'downloading', or 'processing' as 'failed' (interrupted) on server restart."""
    db = get_db()
    if db is None:
        return 0
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    res = db.jobs.update_many(
        {"status": {"$in": ["queued", "downloading", "processing"]}},
        {"$set": {"status": "failed", "message": "Job interrupted (server restarted)", "updated_at": now}}
    )
    return res.modified_count


# ──────────────────────────────────────────────────────────────────────────────
# Publish History
# ──────────────────────────────────────────────────────────────────────────────

def db_record_publish_job(job: Dict[str, Any]) -> None:
    db = get_db()
    if db is None:
        import storage
        storage.record_publish_job(job)
        return

    doc = dict(job)
    doc["_id"] = job.get("job_id") or secrets.token_hex(8)
    db.publish_history.insert_one(doc)


def db_get_publish_history(user_id: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
    db = get_db()
    if db is None:
        import storage
        return storage.load_publish_history(limit)

    query = {}
    if user_id:
        query["user_id"] = user_id

    cursor = db.publish_history.find(query).sort("started_at", pymongo.DESCENDING).limit(limit)
    items = []
    for doc in cursor:
        doc.pop("_id", None)
        items.append(doc)
    return items
