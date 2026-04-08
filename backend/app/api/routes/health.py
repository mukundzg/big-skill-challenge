"""Health check endpoint."""

from fastapi import APIRouter

from app.db import is_database_configured, test_database_connection
from app.services.redis_cache import get_redis_client, redis_available

router = APIRouter()


@router.get("/health")
def health():
    configured = is_database_configured()
    redis_ok = None
    redis_enabled = redis_available()
    if redis_enabled:
        r = get_redis_client()
        if r is not None:
            try:
                redis_ok = bool(r.ping())
            except Exception:
                redis_ok = False
    if not configured:
        return {
            "ok": True,
            "database": {"configured": False, "connected": None},
            "redis": {"enabled": redis_enabled, "connected": redis_ok},
        }
    ok, err = test_database_connection()
    return {
        "ok": True,
        "database": {"configured": True, "connected": ok, "error": err if not ok else None},
        "redis": {"enabled": redis_enabled, "connected": redis_ok},
    }
