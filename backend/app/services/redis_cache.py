"""Small Redis helper for caching expensive operations (optional dependency)."""

from __future__ import annotations

import os
from typing import Any

from app.core.app_logger import log_warn

try:
    import redis  # type: ignore
except Exception:  # pragma: no cover
    redis = None  # type: ignore


_CLIENT: Any | None = None


def _redis_url() -> str | None:
    raw = os.environ.get("REDIS_URL", "").strip()
    return raw or None


def redis_available() -> bool:
    return redis is not None and _redis_url() is not None


def get_redis_client() -> Any | None:
    """
    Lazy singleton. Returns None if REDIS_URL is not set or redis package isn't installed.
    """
    global _CLIENT
    if _CLIENT is not None:
        return _CLIENT

    if redis is None:
        return None
    url = _redis_url()
    if not url:
        return None

    try:
        _CLIENT = redis.Redis.from_url(url, decode_responses=True)
        return _CLIENT
    except Exception as e:
        log_warn("Redis client init failed; caching disabled", exc=e)
        _CLIENT = None
        return None

