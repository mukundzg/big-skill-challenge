"""
Central audit API — import from anywhere in the backend.

    from app.audit import AuditAction, record, request_context

    record(AuditAction.LOGIN, user_id=user.id, metadata={**request_context(request), "email": user.email})

Add new action names in `actions.py`, then call `record()` from routes or services.
"""

from __future__ import annotations

from app.audit.actions import AuditAction
from app.audit.record import record, request_context

__all__ = ["AuditAction", "record", "request_context"]
