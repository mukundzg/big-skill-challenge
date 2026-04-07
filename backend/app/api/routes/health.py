"""Health check endpoint."""

from fastapi import APIRouter

from app.db import is_database_configured, test_database_connection

router = APIRouter()


@router.get("/health")
def health():
    configured = is_database_configured()
    if not configured:
        return {
            "ok": True,
            "database": {"configured": False, "connected": None},
        }
    ok, err = test_database_connection()
    return {
        "ok": True,
        "database": {"configured": True, "connected": ok, "error": err if not ok else None},
    }
