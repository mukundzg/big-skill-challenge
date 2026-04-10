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

    - agent_name: always ``\"system\"`` unless metadata contains a non-empty
      ``audit_agent_name`` (explicit override only; never uses ``user_agent``).
    - input / output: JSON columns; default ``{}`` unless metadata has ``audit_input`` /
      ``audit_output`` (same rules as ``audit_input``).

    If the DB is unavailable or the insert fails, logs an error and returns
    without raising (so business logic still completes).
    """
    if engine() is None:
        return

    meta = dict(metadata) if metadata else {}
    explicit_agent = meta.get("audit_agent_name")
    if explicit_agent is not None and str(explicit_agent).strip():
        agent_name = str(explicit_agent).strip()[:255]
    else:
        agent_name = "system"

    raw_in = meta.get("audit_input")
    if raw_in is None:
        audit_input: dict[str, Any] | list[Any] = {}
    elif isinstance(raw_in, dict):
        audit_input = raw_in
    elif isinstance(raw_in, list):
        audit_input = raw_in
    else:
        audit_input = {"value": str(raw_in)[:4000]}

    raw_out = meta.get("audit_output")
    if raw_out is None:
        audit_output: dict[str, Any] | list[Any] = {}
    elif isinstance(raw_out, dict):
        audit_output = raw_out
    elif isinstance(raw_out, list):
        audit_output = raw_out
    else:
        audit_output = {"value": str(raw_out)[:4000]}

    row = AuditLog(
        user_id=user_id,
        action=action[:255],
        agent_name=agent_name,
        audit_input=audit_input,
        audit_output=audit_output,
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
