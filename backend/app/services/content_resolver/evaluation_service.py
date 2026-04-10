from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from sqlalchemy import select

from app.db import session_scope
from app.models import ContentSubject
from app.services.content_resolver.audit import AuditLogger
from app.services.content_resolver.llm_reviewer import llm_review_enabled, review_with_openai
from app.services.content_resolver.logging_utils import app_log
from app.services.content_resolver.models import AuditLog
from app.services.content_resolver.orchestrator import EvaluationOrchestrator
from app.services.content_resolver.tools import load_rubric

_PKG_DIR = Path(__file__).resolve().parent
DEFAULT_RUBRIC_PATH = str(_PKG_DIR / "config" / "rubric.json")


def build_service(
    rubric_path: str = DEFAULT_RUBRIC_PATH,
    subject_name: str = "",
    subject_description: str | None = None,
    weights: Dict[str, float] | None = None,
    shortlist_n: int = 5,
    enable_cross_check: bool = True,
) -> EvaluationOrchestrator:
    return EvaluationOrchestrator(
        rubric_path=rubric_path,
        subject_name=subject_name,
        subject_description=subject_description,
        weights=weights,
        shortlist_n=shortlist_n,
        enable_cross_check=enable_cross_check,
    )


def _get_active_subject() -> tuple[int, str, str | None]:
    with session_scope() as session:
        row = session.execute(
            select(ContentSubject).where(
                ContentSubject.is_active.is_(True),
                ContentSubject.is_deleted.is_(False),
            )
        ).scalar_one_or_none()
        if row is None:
            raise RuntimeError("No active content subject configured. Ask admin to add one active subject.")
        return int(row.id), row.subject_name, row.subject_description


def run_evaluation(raw_entries: List[Dict[str, Any]]) -> Dict:
    app_log("evaluation_service", f"run_evaluation called with {len(raw_entries)} entries")
    subject_id, subject_name, subject_description = _get_active_subject()
    service = build_service(subject_name=subject_name, subject_description=subject_description)
    summary = service.evaluate_entries(raw_entries)
    db_payload = service.export_db_payload()
    enable_llm = llm_review_enabled()
    app_log("evaluation_service", f"ENABLE_LLM_REVIEW={enable_llm}")
    if enable_llm:
        db_payload = _append_llm_reviews(
            db_payload=db_payload,
            rubric_path=service.rubric_path,
            weights=service.weights,
            subject_name=subject_name,
            subject_description=subject_description,
        )
    else:
        app_log("evaluation_service", "LLM review disabled; keeping only agentic scores")
    return {
        "entries": raw_entries,
        "active_subject": {
            "id": subject_id,
            "name": subject_name,
            "description": subject_description,
        },
        "ranked_scores": [
            {
                "attempt_id": s.attempt_id,
                "relevance": s.relevance,
                "creativity": s.creativity,
                "clarity": s.clarity,
                "impact": s.impact,
                "total_score": s.total_score,
                "weighted_score": s.weighted_score,
            }
            for s in summary.ranked_scores
        ],
        "shortlisted_attempt_ids": [s.attempt_id for s in summary.shortlisted],
        "consistency_report": summary.consistency_report,
        "db_payload": db_payload,
    }


def _append_llm_reviews(
    db_payload: Dict,
    rubric_path: str,
    weights: Dict[str, float],
    subject_name: str,
    subject_description: str | None,
) -> Dict:
    app_log("llm_review", "LLM dual-write flow started")
    rubric = load_rubric(rubric_path)
    entries_by_attempt = {row["attempt_id"]: row["entry"] for row in db_payload.get("entries", [])}
    agentic_by_attempt = {}
    for row in db_payload.get("scores", []):
        if row.get("agent", "agentic") == "agentic":
            agentic_by_attempt[row["attempt_id"]] = row

    audit_logger = AuditLogger()
    llm_rows = []
    for attempt_id, entry_text in entries_by_attempt.items():
        baseline = agentic_by_attempt.get(attempt_id)
        if not baseline:
            continue
        llm_row, err = review_with_openai(
            entry_text=entry_text,
            rubric=rubric,
            weights=weights,
            subject_name=subject_name,
            subject_description=subject_description,
            baseline_scores=baseline,
        )
        if llm_row is not None:
            delta = max(
                abs(int(llm_row["relevance"]) - int(baseline["relevance"])),
                abs(int(llm_row["creativity"]) - int(baseline["creativity"])),
                abs(int(llm_row["clarity"]) - int(baseline["clarity"])),
                abs(int(llm_row["impact"]) - int(baseline["impact"])),
            )
            confidence = max(0.0, min(1.0, 0.9 - (0.08 * delta)))
            needs_human_review = confidence < 0.60
            uncertainty_reason = (
                f"llm-agentic delta={delta}" if not needs_human_review else f"confidence below threshold after llm delta={delta}"
            )
            llm_rows.append(
                {
                    "attempt_id": attempt_id,
                    "agent": "llm",
                    "relevance": llm_row["relevance"],
                    "creativity": llm_row["creativity"],
                    "clarity": llm_row["clarity"],
                    "impact": llm_row["impact"],
                    "total_score": llm_row["total_score"],
                    "weighted_score": llm_row["weighted_score"],
                    "confidence": round(confidence, 3),
                    "uncertainty_reason": uncertainty_reason,
                    "needs_human_review": needs_human_review,
                    "reasoning": llm_row["reasoning"],
                    "evaluated_at": llm_row["evaluated_at"],
                }
            )
            audit_logger.log(
                AuditLog(
                    entry_id=attempt_id,
                    agent_name="llm_reviewer",
                    action="review_scores",
                    input={"entry_text": entry_text, "baseline_scores": baseline},
                    output={"status": "accepted", "llm_scores": llm_row},
                )
            )
            app_log("llm_review", f"attempt_id={attempt_id} llm review accepted")
        else:
            baseline["needs_human_review"] = True
            prior_reason = baseline.get("uncertainty_reason", "")
            llm_reason = f"llm review skipped/error: {err}"
            baseline["uncertainty_reason"] = f"{prior_reason}; {llm_reason}".strip("; ")
            baseline["confidence"] = min(float(baseline.get("confidence", 1.0)), 0.45)
            audit_logger.log(
                AuditLog(
                    entry_id=attempt_id,
                    agent_name="llm_reviewer",
                    action="review_scores",
                    input={"entry_text": entry_text, "baseline_scores": baseline},
                    output={"status": "skipped", "error": err},
                )
            )
            app_log("llm_review", f"attempt_id={attempt_id} llm review skipped: {err}")

    db_payload["scores"].extend(llm_rows)
    db_payload["audit_logs"].extend(audit_logger.export_rows())
    db_payload["llm_review"] = {
        "enabled": True,
        "llm_rows_added": len(llm_rows),
        "reviewed_at": datetime.now(tz=timezone.utc).isoformat(),
    }
    app_log("llm_review", f"LLM dual-write completed: llm_rows_added={len(llm_rows)}")
    return db_payload

