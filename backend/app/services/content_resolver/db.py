from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List

from sqlalchemy import text

from app.db import session_scope
from app.services.content_resolver.logging_utils import app_log
from app.services.content_resolver.tools import validate_input_entry

AUDIT_LOG_TABLE = "audit_logs_adjudiction"


class MySQLDBHandler:
    """DB adapter that reuses app-level SQLAlchemy session/transactions."""

    @staticmethod
    def _to_dt(value: Any) -> Any:
        if isinstance(value, datetime):
            return value
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                return value
        return value

    def initialize_schema(self) -> None:
        try:
            required = ("submissions", "scores", AUDIT_LOG_TABLE)
            with session_scope() as session:
                db_name = session.execute(text("SELECT DATABASE()")).scalar()
                if not db_name:
                    raise RuntimeError("No active database selected for content resolver")
                missing: list[str] = []
                for table_name in required:
                    exists = session.execute(
                        text(
                            """
                            SELECT COUNT(1)
                            FROM information_schema.TABLES
                            WHERE TABLE_SCHEMA = :schema_name AND TABLE_NAME = :table_name
                            """
                        ),
                        {"schema_name": db_name, "table_name": table_name},
                    ).scalar()
                    if not exists:
                        missing.append(table_name)
            if missing:
                joined = ", ".join(missing)
                raise RuntimeError(
                    "Content resolver tables are missing: "
                    f"{joined}. Create them via migrations before starting the API."
                )
        except Exception as exc:
            app_log("db", f"table validation failed: {exc}")
            raise

    def insert_payload(self, payload: Dict[str, Any]) -> Dict[str, int]:
        return self.insert_payloads_bulk([payload])

    def insert_submissions(self, entries: List[Dict[str, Any]]) -> Dict[int, int]:
        """
        Insert submissions first and return mapping: attempt_id -> submission_id.
        """
        mapping: Dict[int, int] = {}
        try:
            with session_scope() as session:
                submissions_sql = text(
                    """
                    INSERT INTO submissions (
                      user_id, attempt_id, text_answer, word_count,
                      submission_status, remarks, created_by, updated_by
                    )
                    VALUES (
                      :user_id, :attempt_id, :text_answer, :word_count,
                      :submission_status, :remarks, :created_by, :updated_by
                    )
                    """
                )
                for item in entries:
                    entry_text = str(item["entry"])
                    is_valid, validation_msg, word_count = validate_input_entry(entry_text)
                    result = session.execute(
                        submissions_sql,
                        {
                            "user_id": int(item["user_id"]),
                            "attempt_id": int(item["attempt_id"]),
                            "text_answer": entry_text,
                            "word_count": word_count,
                            "submission_status": "ACCEPTED" if is_valid else "REJECTED",
                            "remarks": "" if is_valid else validation_msg,
                            "created_by": int(item["user_id"]),
                            "updated_by": int(item["user_id"]),
                        },
                    )
                    submission_id = int(result.lastrowid or 0)
                    if submission_id <= 0:
                        # Some SQLAlchemy/driver paths may not populate result.lastrowid.
                        submission_id = int(session.execute(text("SELECT LAST_INSERT_ID()")).scalar() or 0)
                    if submission_id <= 0:
                        raise RuntimeError(
                            f"Failed to resolve submission_id for attempt_id={int(item['attempt_id'])}"
                        )
                    mapping[int(item["attempt_id"])] = submission_id
            return mapping
        except Exception as exc:
            app_log("db", f"submission insert failed: {exc}")
            raise

    def insert_payloads_bulk(self, payloads: List[Dict[str, Any]]) -> Dict[str, int]:
        app_log("db", f"bulk insert requested for payload_count={len(payloads)}")
        inserted = {"submissions": 0, "scores": 0, "audit_logs": 0}
        try:
            with session_scope() as session:
                submissions_sql = text(
                    """
                    INSERT INTO submissions (
                      user_id, attempt_id, text_answer, word_count,
                      submission_status, remarks, created_by, updated_by
                    )
                    VALUES (
                      :user_id, :attempt_id, :text_answer, :word_count,
                      :submission_status, :remarks, :created_by, :updated_by
                    )
                    """
                )
                scores_sql = text(
                    """
                    INSERT INTO scores (
                      submission_id, user_id, agent, relevance, creativity, clarity, impact,
                      total_score, weighted_score, confidence, uncertainty_reason, needs_human_review, reasoning, evaluated_at
                    )
                    VALUES (
                      :submission_id, :user_id, :agent, :relevance, :creativity, :clarity, :impact,
                      :total_score, :weighted_score, :confidence, :uncertainty_reason, :needs_human_review, :reasoning, :evaluated_at
                    )
                    """
                )
                audit_sql = text(
                    f"""
                    INSERT INTO {AUDIT_LOG_TABLE} (entry_id, agent_name, action, input, output, created_at)
                    VALUES (:entry_id, :agent_name, :action, :input, :output, :created_at)
                    """
                )

                for payload in payloads:
                    submission_id_by_attempt: Dict[int, int] = {}
                    raw_map = payload.get("submission_id_map", {}) or {}
                    # Redis/json queue serialization can convert dict keys to strings.
                    normalized_map = {int(k): int(v) for k, v in raw_map.items()}
                    submission_id_by_attempt.update(normalized_map)
                    inserted["submissions"] += len(normalized_map)

                    scores_rows = []
                    for row in payload.get("scores", []):
                        attempt_id = int(row["attempt_id"])
                        submission_id = submission_id_by_attempt.get(attempt_id)
                        if not submission_id:
                            app_log(
                                "db",
                                f"skipping score row: no submission_id mapping for attempt_id={attempt_id}",
                            )
                            continue
                        scores_rows.append(
                            {
                                "submission_id": submission_id,
                                "user_id": int(payload["user_id"]),
                                "agent": row.get("agent", "agentic"),
                                "relevance": row["relevance"],
                                "creativity": row["creativity"],
                                "clarity": row["clarity"],
                                "impact": row["impact"],
                                "total_score": row["total_score"],
                                "weighted_score": row["weighted_score"],
                                "confidence": row.get("confidence", 1.0),
                                "uncertainty_reason": row.get("uncertainty_reason", ""),
                                "needs_human_review": bool(row.get("needs_human_review", False)),
                                "reasoning": json.dumps(row["reasoning"]),
                                "evaluated_at": self._to_dt(row.get("evaluated_at")),
                            }
                        )
                    if scores_rows:
                        session.execute(scores_sql, scores_rows)
                        inserted["scores"] += len(scores_rows)

                    audit_rows = []
                    for row in payload.get("audit_logs", []):
                        audit_rows.append(
                            {
                                "entry_id": row.get("entry_id"),
                                "agent_name": row["agent_name"],
                                "action": row["action"],
                                "input": json.dumps(row["input"]),
                                "output": json.dumps(row["output"]),
                                "created_at": self._to_dt(row.get("created_at")),
                            }
                        )
                    if audit_rows:
                        session.execute(audit_sql, audit_rows)
                        inserted["audit_logs"] += len(audit_rows)

            app_log(
                "db",
                f"bulk insert committed: submissions={inserted['submissions']}, scores={inserted['scores']}, audit_logs={inserted['audit_logs']}",
            )
            return inserted
        except Exception as exc:
            app_log("db", f"bulk insert failed: {exc}")
            raise
