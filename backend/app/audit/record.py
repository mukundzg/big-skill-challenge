"""Persistence + request helpers for audit rows."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import Request

from app.db import engine, session_scope
from app.models import AuditLog

logger = logging.getLogger(__name__)


def record(
    action: str,
    *,
    user_id: int | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """
    Insert one row into `audit_logs`. Safe to call from any service or route.

    If the DB is unavailable or the insert fails, logs an error and returns
    without raising (so business logic still completes).
    """
    if engine() is None:
        return

    row = AuditLog(
        user_id=user_id,
        action=action[:255],
        extra=metadata,
    )
    try:
        with session_scope() as session:
            session.add(row)
    except Exception:
        logger.exception("audit_logs insert failed (action=%s)", action)


def request_context(request: Request | None) -> dict[str, Any]:
    """Optional client hints for metadata (IP, user-agent). Pass None if not in a request."""
    if request is None:
        return {}
    meta: dict[str, Any] = {}
    try:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            meta["client_ip"] = forwarded.split(",")[0].strip()
        elif request.client and request.client.host:
            meta["client_ip"] = request.client.host
        ua = request.headers.get("user-agent")
        if ua:
            meta["user_agent"] = ua[:500]
    except Exception:
        pass
    return meta
