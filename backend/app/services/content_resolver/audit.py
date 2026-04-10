from __future__ import annotations

from dataclasses import asdict
from typing import Any, Dict, List

from app.services.content_resolver.models import AuditLog


class AuditLogger:
    """
    Collects audit rows for persistence (e.g. audit_logs_adjudiction).
    Does not print to console; export via export_rows() for DB insert.
    """

    def __init__(self) -> None:
        self._rows: List[Dict[str, Any]] = []

    def log(self, row: AuditLog) -> None:
        created_at = row.created_at.isoformat()
        payload = asdict(row)
        payload["created_at"] = created_at
        self._rows.append(payload)

    def export_rows(self) -> List[Dict[str, Any]]:
        return list(self._rows)

