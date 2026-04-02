"""Quiz attempts, file assignment, dashboard stats."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.db import engine, session_scope
from app.models import (
    AttemptQuestionTiming,
    File,
    QuizAttempt,
    QuizSettings,
    UserFileMapping,
)
from app.services.quiz_gemini import QBANKS_DIR, load_and_build_quiz


def sync_qbank_files() -> int:
    """Insert `files` rows for each PDF in /qbanks (idempotent)."""
    if engine() is None or not QBANKS_DIR.is_dir():
        return 0
    added = 0
    with session_scope() as session:
        for p in sorted(QBANKS_DIR.glob("*.pdf")):
            existing = session.execute(
                select(File).where(File.file_name == p.name)
            ).scalar_one_or_none()
            if existing is None:
                session.add(File(file_name=p.name))
                added += 1
    return added


def _get_settings_row(session: Session) -> QuizSettings:
    row = session.get(QuizSettings, 1)
    if row is None:
        row = QuizSettings(
            id=1,
            max_attempts=3,
            time_per_question_seconds=60,
            marks_per_question=10,
        )
        session.add(row)
        session.flush()
    return row


def get_settings() -> dict[str, int]:
    if engine() is None:
        return {
            "max_attempts": 3,
            "time_per_question_seconds": 60,
            "marks_per_question": 10,
        }
    with session_scope() as session:
        s = _get_settings_row(session)
        return {
            "max_attempts": int(s.max_attempts),
            "time_per_question_seconds": int(s.time_per_question_seconds),
            "marks_per_question": int(s.marks_per_question),
        }


def get_dashboard_stats(user_id: int) -> dict[str, Any]:
    settings = get_settings()
    if engine() is None:
        return {
            **settings,
            "attempts_used": 0,
            "attempts_remaining": settings["max_attempts"],
            "total_correct_answers": 0,
            "total_score": 0.0,
        }

    with session_scope() as session:
        s = _get_settings_row(session)
        max_a = int(s.max_attempts)

        used = session.execute(
            select(func.count()).select_from(QuizAttempt).where(QuizAttempt.user_id == user_id)
        ).scalar_one()
        used = int(used or 0)

        total_correct = session.execute(
            select(func.coalesce(func.sum(QuizAttempt.correct_answers), 0)).where(
                QuizAttempt.user_id == user_id
            )
        ).scalar_one()
        total_correct = int(total_correct or 0)

        total_score = session.execute(
            select(func.coalesce(func.sum(QuizAttempt.score), 0)).where(
                QuizAttempt.user_id == user_id
            )
        ).scalar_one()
        total_score = float(total_score or 0)

        remaining = max(0, max_a - used)

        return {
            "max_attempts": max_a,
            "time_per_question_seconds": int(s.time_per_question_seconds),
            "marks_per_question": int(s.marks_per_question),
            "attempts_used": used,
            "attempts_remaining": remaining,
            "total_correct_answers": total_correct,
            "total_score": total_score,
        }


def _next_attempt_number(session: Session, user_id: int) -> int:
    m = session.execute(
        select(func.coalesce(func.max(QuizAttempt.attempt_number), 0)).where(
            QuizAttempt.user_id == user_id
        )
    ).scalar_one()
    return int(m or 0) + 1


def pick_random_unseen_file(session: Session, user_id: int) -> File | None:
    sub = select(UserFileMapping.file_id).where(UserFileMapping.user_id == user_id)
    stmt = select(File).where(~File.id.in_(sub)).order_by(text("RAND()")).limit(1)
    return session.execute(stmt).scalar_one_or_none()


@dataclass
class StartAttemptResult:
    ok: bool
    attempt_id: int | None = None
    attempt_number: int | None = None
    total_questions: int | None = None
    first_question: dict[str, Any] | None = None
    time_seconds: int | None = None
    marks_per_question: int | None = None
    error: str | None = None


def start_attempt(user_id: int) -> StartAttemptResult:
    if engine() is None:
        return StartAttemptResult(ok=False, error="Database not configured")

    sync_qbank_files()

    pdf_path: Path | None = None
    settings_snapshot: dict[str, int] = {}
    picked_file_id: int | None = None

    with session_scope() as session:
        settings = _get_settings_row(session)
        settings_snapshot = {
            "max_attempts": int(settings.max_attempts),
            "time": int(settings.time_per_question_seconds),
            "marks": int(settings.marks_per_question),
        }
        max_a = settings_snapshot["max_attempts"]
        used = session.execute(
            select(func.count()).select_from(QuizAttempt).where(QuizAttempt.user_id == user_id)
        ).scalar_one()
        used = int(used or 0)
        if used >= max_a:
            return StartAttemptResult(ok=False, error="No attempts remaining")

        f = pick_random_unseen_file(session, user_id)
        if f is None:
            return StartAttemptResult(ok=False, error="No unused question banks available")

        pdf_path = QBANKS_DIR / f.file_name
        if not pdf_path.is_file():
            return StartAttemptResult(ok=False, error=f"PDF missing on disk: {f.file_name}")
        picked_file_id = int(f.id)

    assert pdf_path is not None

    try:
        quiz = load_and_build_quiz(pdf_path)
    except Exception as e:
        return StartAttemptResult(ok=False, error=str(e))

    if not quiz:
        return StartAttemptResult(ok=False, error="No questions generated from PDF")

    with session_scope() as session:
        n = _next_attempt_number(session, user_id)
        assert picked_file_id is not None
        att = QuizAttempt(
            user_id=user_id,
            file_id=picked_file_id,
            attempt_number=n,
            status="IN_PROGRESS",
            score=None,
            quiz_json={"questions": quiz},
            correct_answers=0,
            total_questions=len(quiz),
            current_question_index=0,
        )
        session.add(att)
        session.flush()
        session.add(UserFileMapping(user_id=user_id, file_id=picked_file_id))
        session.flush()
        att_id = int(att.id)

    first = quiz[0]
    q_payload = {"question": first["question"], "options": first["options"]}
    return StartAttemptResult(
        ok=True,
        attempt_id=att_id,
        attempt_number=n,
        total_questions=len(quiz),
        first_question={"index": 0, **q_payload},
        time_seconds=settings_snapshot["time"],
        marks_per_question=settings_snapshot["marks"],
    )


def _get_attempt_for_user(
    session: Session, attempt_id: int, user_id: int
) -> QuizAttempt | None:
    row = session.get(QuizAttempt, attempt_id)
    if row is None or int(row.user_id) != user_id:
        return None
    return row


def get_question_for_attempt(
    attempt_id: int, user_id: int, question_index: int
) -> dict[str, Any] | None:
    if engine() is None:
        return None
    with session_scope() as session:
        att = _get_attempt_for_user(session, attempt_id, user_id)
        if att is None or att.status != "IN_PROGRESS":
            return None
        data = att.quiz_json
        if not isinstance(data, dict):
            return None
        qs = data.get("questions")
        if not isinstance(qs, list) or question_index < 0 or question_index >= len(qs):
            return None
        q = qs[question_index]
        existing = session.execute(
            select(AttemptQuestionTiming).where(
                AttemptQuestionTiming.attempt_id == attempt_id,
                AttemptQuestionTiming.question_index == question_index,
            )
        ).scalar_one_or_none()
        if existing is None:
            session.add(
                AttemptQuestionTiming(
                    attempt_id=attempt_id,
                    question_index=question_index,
                    shown_at=datetime.now(timezone.utc).replace(tzinfo=None),
                )
            )
        return {
            "index": question_index,
            "question": q["question"],
            "options": q["options"],
        }


def _finalize_score(correct: int, settings: QuizSettings) -> Decimal:
    marks = int(settings.marks_per_question)
    return Decimal(str(correct * marks))


def submit_answer(
    attempt_id: int, user_id: int, question_index: int, selected_option_index: int
) -> dict[str, Any]:
    if engine() is None:
        return {"ok": False, "error": "no_database"}

    with session_scope() as session:
        att = _get_attempt_for_user(session, attempt_id, user_id)
        if att is None or att.status != "IN_PROGRESS":
            return {"ok": False, "error": "invalid_attempt"}

        settings = _get_settings_row(session)
        data = att.quiz_json
        if not isinstance(data, dict):
            return {"ok": False, "error": "bad_quiz"}
        qs = data.get("questions")
        if not isinstance(qs, list) or question_index < 0 or question_index >= len(qs):
            return {"ok": False, "error": "bad_question"}

        q = qs[question_index]
        correct_idx = int(q.get("correct_index", -1))
        is_correct = selected_option_index == correct_idx
        last = question_index >= len(qs) - 1

        if not is_correct:
            att.status = "FAILED_WRONG"
            att.score = _finalize_score(int(att.correct_answers or 0), settings)
            att.current_question_index = question_index
            session.flush()
            return {
                "ok": True,
                "finished": True,
                "outcome": "wrong_exit",
                "correct_answers": int(att.correct_answers or 0),
                "total_questions": len(qs),
                "score": float(att.score or 0),
                "next_question": None,
            }

        att.correct_answers = int(att.correct_answers or 0) + 1

        if last:
            att.status = "SUCCESS"
            att.score = _finalize_score(int(att.correct_answers), settings)
            att.current_question_index = question_index
            session.flush()
            return {
                "ok": True,
                "finished": True,
                "outcome": "success",
                "correct_answers": int(att.correct_answers),
                "total_questions": len(qs),
                "score": float(att.score or 0),
                "next_question": None,
            }

        att.current_question_index = question_index + 1
        session.flush()

        nq = qs[question_index + 1]
        return {
            "ok": True,
            "finished": False,
            "outcome": None,
            "correct_answers": int(att.correct_answers),
            "total_questions": len(qs),
            "score": None,
            "next_question": {
                "index": question_index + 1,
                "question": nq["question"],
                "options": nq["options"],
            },
        }


def timeout_attempt(attempt_id: int, user_id: int) -> dict[str, Any]:
    if engine() is None:
        return {"ok": False, "error": "no_database"}

    with session_scope() as session:
        att = _get_attempt_for_user(session, attempt_id, user_id)
        if att is None or att.status != "IN_PROGRESS":
            return {"ok": False, "error": "invalid_attempt"}

        settings = _get_settings_row(session)
        att.status = "FAILED_TIMEOUT"
        att.score = _finalize_score(int(att.correct_answers or 0), settings)
        session.flush()
        return {
            "ok": True,
            "correct_answers": int(att.correct_answers or 0),
            "total_questions": int(att.total_questions or 0),
            "score": float(att.score or 0),
        }
