"""
routers/auth_router.py — User signup, login, session validation, and profile endpoints.
"""

from typing import Optional
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel, EmailStr

import db

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


class SignupRequest(BaseModel):
    username: str
    email: Optional[str] = ""
    password: str
    name: Optional[str] = ""
    full_name: Optional[str] = ""


def _with_user_aliases(user: Optional[dict]) -> Optional[dict]:
    if not user:
        return None
    normalized = dict(user)
    display_name = normalized.get("full_name") or normalized.get("name") or normalized.get("username", "")
    normalized["name"] = display_name
    normalized["full_name"] = display_name
    return normalized


class LoginRequest(BaseModel):
    username: str
    password: str


def get_current_user_optional(authorization: Optional[str] = Header(None)) -> Optional[dict]:
    """Helper to extract user from Authorization: Bearer <token> header, or None."""
    if not authorization:
        return None
    token = authorization.replace("Bearer ", "").strip()
    if not token:
        return None
    return db.get_user_by_token(token)


@router.get("/status")
def auth_status(authorization: Optional[str] = Header(None)):
    """Check MongoDB status and current logged in session."""
    user = _with_user_aliases(get_current_user_optional(authorization))
    return {
        "db_connected": db.is_db_connected(),
        "user": user,
    }


@router.post("/signup")
def signup(req: SignupRequest):
    """Register a new user account and return an active session token."""
    if not db.is_db_connected():
        raise HTTPException(
            status_code=503,
            detail="Database is currently unavailable. Please ensure MongoDB is running.",
        )

    username = req.username.strip()
    if len(username) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters.")
    if len(req.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters.")

    try:
        resolved_name = (req.full_name or req.name or "").strip()
        user = _with_user_aliases(
            db.create_user(
                username=username,
                email=req.email or "",
                password=req.password,
                name=resolved_name,
            )
        )
        token = db.create_session(user["id"])
        return {
            "success": True,
            "message": "Account created successfully",
            "user": user,
            "token": token,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create account: {e}")


@router.post("/login")
def login(req: LoginRequest):
    """Authenticate with username or email and return an active session token."""
    if not db.is_db_connected():
        raise HTTPException(
            status_code=503,
            detail="Database is currently unavailable. Please ensure MongoDB is running.",
        )

    user = _with_user_aliases(db.authenticate_user(req.username, req.password))
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    token = db.create_session(user["id"])
    return {
        "success": True,
        "message": "Logged in successfully",
        "user": user,
        "token": token,
    }


@router.get("/me")
def get_me(authorization: Optional[str] = Header(None)):
    """Get the current authenticated user's profile."""
    user = _with_user_aliases(get_current_user_optional(authorization))
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {"user": user}


@router.post("/logout")
def logout(authorization: Optional[str] = Header(None)):
    """Invalidate current session token."""
    if authorization:
        token = authorization.replace("Bearer ", "").strip()
        db.revoke_session(token)
    return {"success": True, "message": "Logged out successfully"}
