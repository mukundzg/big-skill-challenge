"""Quiz attempts, file assignment, dashboard stats."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
import os
import random
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.service_guard import guarded_service
from app.db import engine, session_scope
from app.models import (
    AttemptQuestionTiming,
    ContestSetting,
    File,
    QuizAttempt,
    QuizQuestion,
    QuizSettings,
    User,
)

SHORTLIST_PROMPT_TEXT = 'In exactly 25 words, tell us why you should win this prize.'
SHORTLIST_ENGINE_NAME = "Lucid Engine AI™"
SHORTLIST_ENGINE_DESC = (
    "Structured deterministic evaluation engine, not generative AI. "
    "Scores against a fixed rubric. Final winners confirmed exclusively by 3 independent human judges."
)
SHORTLIST_ENGINE_MODEL = "Lucid Engine AI™ v2.1.4"
SHORTLIST_NEXT_STEPS = [
    "3 independent judges score your entry separately — no judge sees others' scores",
    "All judges complete evaluation before scores are aggregated",
    "Tied entries subject to secondary review and consensus",
    "Independent scrutineer verifies the process and confirms the final result",
    "Winners announced at competition close",
]


def _ensure_contest_result_table(session) -> None:
    session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS contest_entry_results (
              id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
              contest_setting_id BIGINT NOT NULL,
              score_id BIGINT NOT NULL,
              submission_id BIGINT NOT NULL,
              attempt_id BIGINT NULL,
              user_id BIGINT NOT NULL,
              status VARCHAR(32) NOT NULL,
              rank_position BIGINT NOT NULL,
              created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uq_contest_score (contest_setting_id, score_id),
              INDEX idx_contest_status (contest_setting_id, status),
              INDEX idx_contest_user (contest_setting_id, user_id),
              INDEX idx_contest_attempt (contest_setting_id, attempt_id)
            )
            """
        )
    )


def _ensure_contest_link_columns(session) -> None:
    db_name = session.execute(text("SELECT DATABASE()")).scalar()
    if db_name:
        attempts_col_exists = session.execute(
            text(
                """
                SELECT COUNT(1)
                FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = :schema_name
                  AND TABLE_NAME = 'attempts'
                  AND COLUMN_NAME = 'contest_setting_id'
                """
            ),
            {"schema_name": db_name},
        ).scalar()
        if not attempts_col_exists:
            session.execute(
                text(
                    """
                    ALTER TABLE attempts
                    ADD COLUMN contest_setting_id BIGINT NULL
                    """
                )
            )
        attempts_idx_exists = session.execute(
            text(
                """
                SELECT COUNT(1)
                FROM information_schema.STATISTICS
                WHERE TABLE_SCHEMA = :schema_name
                  AND TABLE_NAME = 'attempts'
                  AND INDEX_NAME = 'idx_attempts_contest_setting_id'
                """
            ),
            {"schema_name": db_name},
        ).scalar()
        if not attempts_idx_exists:
            session.execute(
                text(
                    """
                    CREATE INDEX idx_attempts_contest_setting_id
                    ON attempts(contest_setting_id)
                    """
                )
            )
        submissions_col_exists = session.execute(
            text(
                """
                SELECT COUNT(1)
                FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = :schema_name
                  AND TABLE_NAME = 'submissions'
                  AND COLUMN_NAME = 'contest_setting_id'
                """
            ),
            {"schema_name": db_name},
        ).scalar()
        if not submissions_col_exists:
            session.execute(
                text(
                    """
                    ALTER TABLE submissions
                    ADD COLUMN contest_setting_id BIGINT NULL
                    """
                )
            )
        submissions_idx_exists = session.execute(
            text(
                """
                SELECT COUNT(1)
                FROM information_schema.STATISTICS
                WHERE TABLE_SCHEMA = :schema_name
                  AND TABLE_NAME = 'submissions'
                  AND INDEX_NAME = 'idx_submissions_contest_setting_id'
                """
            ),
            {"schema_name": db_name},
        ).scalar()
        if not submissions_idx_exists:
            session.execute(
                text(
                    """
                    CREATE INDEX idx_submissions_contest_setting_id
                    ON submissions(contest_setting_id)
                    """
                )
            )
    # Backfill missing submission links from attempts whenever possible.
    session.execute(
        text(
            """
            UPDATE submissions s
            INNER JOIN attempts a ON a.id = s.attempt_id
            SET s.contest_setting_id = a.contest_setting_id
            WHERE s.contest_setting_id IS NULL
              AND a.contest_setting_id IS NOT NULL
            """
        )
    )


@guarded_service("quiz.sync_qbank_files")
def sync_qbank_files() -> int:
    """Legacy no-op. Question-bank rows are now created via admin upload endpoint."""
    return 0


def _get_settings_row(session: Session) -> QuizSettings:
    row = session.get(QuizSettings, 1)
    if row is None:
        row = QuizSettings(
            id=1,
            max_attempts=3,
            time_per_question_seconds=60,
            marks_per_question=10,
            questions_per_attempt=10,
        )
        session.add(row)
        session.flush()
    return row


@guarded_service("quiz.get_settings")
def get_settings() -> dict[str, int]:
    if engine() is None:
        return {
            "max_attempts": 3,
            "time_per_question_seconds": 60,
            "marks_per_question": 10,
            "questions_per_attempt": 10,
        }
    with session_scope() as session:
        s = _get_settings_row(session)
        return {
            "max_attempts": int(s.max_attempts),
            "time_per_question_seconds": int(s.time_per_question_seconds),
            "marks_per_question": int(s.marks_per_question),
            "questions_per_attempt": int(getattr(s, "questions_per_attempt", 10) or 10),
        }


@guarded_service("quiz.questions_per_attempt_for_question_bank")
def questions_per_attempt_for_question_bank() -> int:
    """Minimum MCQs required when uploading a question-bank PDF (quiz_settings.questions_per_attempt)."""
    if engine() is None:
        try:
            v = int(os.environ.get("QUIZ_QUESTIONS_PER_ATTEMPT", "10").strip() or "10")
        except Exception:
            v = 10
        return max(1, min(v, 100))
    with session_scope() as session:
        s = _get_settings_row(session)
        try:
            v = int(getattr(s, "questions_per_attempt", 10) or 10)
        except Exception:
            v = 10
        return max(1, min(v, 100))


@guarded_service("quiz.get_quiz_settings_admin")
def get_quiz_settings_admin() -> dict[str, Any]:
    """Full quiz_settings row for admin UI."""
    if engine() is None:
        return {
            "id": 1,
            "max_attempts": 3,
            "time_per_question_seconds": 60,
            "marks_per_question": 10,
            "questions_per_attempt": 10,
            "created_at": None,
            "updated_at": None,
        }
    with session_scope() as session:
        s = _get_settings_row(session)
        ca = s.created_at
        ua = s.updated_at
        return {
            "id": int(s.id),
            "max_attempts": int(s.max_attempts),
            "time_per_question_seconds": int(s.time_per_question_seconds),
            "marks_per_question": int(s.marks_per_question),
            "questions_per_attempt": int(getattr(s, "questions_per_attempt", 10) or 10),
            "created_at": ca.isoformat() if ca else None,
            "updated_at": ua.isoformat() if ua else None,
        }


@guarded_service("quiz.get_dashboard_stats")
def get_dashboard_stats(user_id: int) -> dict[str, Any]:
    settings = get_settings()
    if engine() is None:
        return {
            **settings,
            "attempts_used": 0,
            "attempts_remaining": settings["max_attempts"],
            "total_correct_answers": 0,
            "total_score": 0.0,
            "shortlisted": 0,
            "contest_is_active": False,
            "contest_season_end": None,
        }

    with session_scope() as session:
        s = _get_settings_row(session)
        max_a = int(s.max_attempts)
        now = datetime.now(timezone.utc).replace(tzinfo=None)

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

        contest = session.execute(
            select(ContestSetting).where(
                ContestSetting.is_active.is_(True),
                ContestSetting.is_deleted.is_(False),
            )
        ).scalar_one_or_none()
        season_start = contest.season_start if contest is not None else None
        season_end = contest.season_end if contest is not None else None
        shortlisted = 0
        if contest is not None:
            _ensure_contest_result_table(session)
            shortlisted_raw = session.execute(
                text(
                    """
                    SELECT COUNT(*)
                    FROM contest_entry_results cer
                    WHERE cer.contest_setting_id = :contest_setting_id
                      AND cer.user_id = :user_id
                      AND cer.status IN ('SHORTLISTED', 'WINNER')
                    """
                ),
                {"contest_setting_id": int(contest.id), "user_id": int(user_id)},
            ).scalar()
            shortlisted = int(shortlisted_raw or 0)
        contest_is_active = bool(
            contest is not None
            and season_end is not None
            and (season_start is None or season_start <= now)
            and season_end >= now
        )

        remaining = max(0, max_a - used)

        return {
            "max_attempts": max_a,
            "time_per_question_seconds": int(s.time_per_question_seconds),
            "marks_per_question": int(s.marks_per_question),
            "questions_per_attempt": int(getattr(s, "questions_per_attempt", 10) or 10),
            "attempts_used": used,
            "attempts_remaining": remaining,
            "total_correct_answers": total_correct,
            "total_score": total_score,
            "shortlisted": shortlisted,
            "contest_is_active": contest_is_active,
            "contest_season_end": season_end.isoformat() if season_end else None,
        }


@guarded_service("quiz.get_user_shortlist_result")
def get_user_shortlist_result(user_id: int) -> dict[str, Any] | None:
    if engine() is None:
        return None
    with session_scope() as session:
        contest = session.execute(
            select(ContestSetting).where(
                ContestSetting.is_active.is_(True),
                ContestSetting.is_deleted.is_(False),
            )
        ).scalar_one_or_none()
        if contest is None:
            return None
        _ensure_contest_result_table(session)
        row = session.execute(
            text(
                """
                SELECT
                  cer.status,
                  cer.rank_position,
                  cer.score_id,
                  cer.submission_id,
                  cer.created_at AS shortlisted_at,
                  sub.attempt_id,
                  sub.text_answer,
                  sub.word_count,
                  sub.created_at AS submitted_at,
                  sc.relevance,
                  sc.creativity,
                  sc.clarity,
                  sc.impact,
                  sc.weighted_score,
                  sc.total_score,
                  sc.evaluated_at
                FROM contest_entry_results cer
                INNER JOIN submissions sub ON sub.id = cer.submission_id
                LEFT JOIN scores sc ON sc.id = cer.score_id
                WHERE cer.contest_setting_id = :contest_setting_id
                  AND cer.user_id = :user_id
                  AND cer.status IN ('SHORTLISTED', 'WINNER')
                ORDER BY
                  CASE WHEN cer.status = 'WINNER' THEN 0 ELSE 1 END,
                  cer.rank_position ASC,
                  cer.id DESC
                LIMIT 1
                """
            ),
            {"contest_setting_id": int(contest.id), "user_id": int(user_id)},
        ).mappings().one_or_none()
        if row is None:
            return None

        total_shortlisted = int(
            session.execute(
                text(
                    """
                    SELECT COUNT(*)
                    FROM contest_entry_results
                    WHERE contest_setting_id = :contest_setting_id
                      AND status IN ('SHORTLISTED', 'WINNER')
                    """
                ),
                {"contest_setting_id": int(contest.id)},
            ).scalar()
            or 0
        )
        total_entries = int(session.execute(text("SELECT COUNT(*) FROM scores")).scalar() or 0)
        submitted_at = row.get("submitted_at")
        submitted_iso = submitted_at.isoformat() if submitted_at is not None else None
        evaluated_at = row.get("evaluated_at")
        evaluated_iso = evaluated_at.isoformat() if evaluated_at is not None else None
        shortlisted_at = row.get("shortlisted_at")
        shortlisted_iso = shortlisted_at.isoformat() if shortlisted_at is not None else None
        attempt_id = int(row.get("attempt_id") or 0)
        year = submitted_at.year if submitted_at is not None else datetime.now().year
        status = str(row.get("status") or "SHORTLISTED").upper()
        relevance = int(row["relevance"]) if row.get("relevance") is not None else 0
        creativity = int(row["creativity"]) if row.get("creativity") is not None else 0
        clarity = int(row["clarity"]) if row.get("clarity") is not None else 0
        impact = int(row["impact"]) if row.get("impact") is not None else 0
        total_score_i = int(row["total_score"]) if row.get("total_score") is not None else 0

        return {
            "status": status,
            "status_label": "Winner" if status == "WINNER" else "Shortlisted",
            "reference": f"TBSC-{year}-{attempt_id:06d}" if attempt_id > 0 else f"TBSC-{year}-000000",
            "prompt": SHORTLIST_PROMPT_TEXT,
            "submission_text": str(row.get("text_answer") or ""),
            "word_count": int(row["word_count"]) if row.get("word_count") is not None else None,
            "submitted_at": submitted_iso,
            "rank_position": int(row["rank_position"]) if row.get("rank_position") is not None else None,
            "total_shortlisted": total_shortlisted,
            "total_entries": total_entries,
            "weighted_score": (
                float(row["weighted_score"]) if row.get("weighted_score") is not None else None
            ),
            "total_score": total_score_i if row.get("total_score") is not None else None,
            "engine_name": SHORTLIST_ENGINE_NAME,
            "engine_description": SHORTLIST_ENGINE_DESC,
            "engine_model_version": SHORTLIST_ENGINE_MODEL,
            "rubric_breakdown": [
                {"label": "Relevance to the Prompt", "score": relevance, "max": 10, "color": "#F59E0B"},
                {"label": "Creativity & Originality", "score": creativity, "max": 10, "color": "#7C3AED"},
                {"label": "Clarity & Expression", "score": clarity, "max": 10, "color": "#3B82F6"},
                {"label": "Metaphorical Resonance", "score": impact, "max": 10, "color": "#EA580C"},
            ],
            "next_steps": SHORTLIST_NEXT_STEPS,
            "audit_trail": [
                {
                    "event": "Entry submitted & sealed",
                    "timestamp": submitted_iso or "—",
                },
                {
                    "event": "AI evaluation completed",
                    "timestamp": evaluated_iso or "—",
                },
                {
                    "event": "Shortlist generated",
                    "timestamp": shortlisted_iso or "—",
                },
                {
                    "event": f"Model: {SHORTLIST_ENGINE_MODEL}",
                    "timestamp": "Deterministic seed: 2026-Q1",
                },
            ],
        }


@guarded_service("quiz.list_user_entries")
def list_user_entries(user_id: int, *, limit: int = 30) -> list[dict[str, Any]]:
    """Recent entries/attempts for the user's My Entries tab."""
    if engine() is None:
        return []

    limit = max(1, min(limit, 100))
    with session_scope() as session:
        _ensure_contest_link_columns(session)
        active_contest = session.execute(
            select(ContestSetting).where(
                ContestSetting.is_active.is_(True),
                ContestSetting.is_deleted.is_(False),
            )
        ).scalar_one_or_none()
        if active_contest is None:
            return []
        params = {
            "user_id": int(user_id),
            "limit_n": int(limit),
            "contest_setting_id": int(active_contest.id),
        }
        rows = session.execute(
            text(
                """
                SELECT
                  a.id AS attempt_id,
                  a.attempt_number AS attempt_number,
                  a.status AS attempt_status,
                  a.created_at AS attempt_created_at,
                  s.id AS submission_id,
                  s.word_count AS submission_word_count,
                  s.created_at AS submission_created_at,
                  cer.contest_rank AS contest_rank
                FROM attempts a
                LEFT JOIN (
                  SELECT s1.*
                  FROM submissions s1
                  INNER JOIN (
                    SELECT attempt_id, MAX(id) AS max_id
                    FROM submissions
                    WHERE user_id = :user_id
                      AND contest_setting_id = :contest_setting_id
                    GROUP BY attempt_id
                  ) latest ON latest.max_id = s1.id
                ) s ON s.attempt_id = a.id
                LEFT JOIN (
                  SELECT
                    cer1.attempt_id,
                    MAX(
                      CASE
                        WHEN cer1.status = 'WINNER' THEN 2
                        WHEN cer1.status = 'SHORTLISTED' THEN 1
                        ELSE 0
                      END
                    ) AS contest_rank
                  FROM contest_entry_results cer1
                  WHERE cer1.contest_setting_id = :contest_setting_id
                  GROUP BY cer1.attempt_id
                ) cer ON cer.attempt_id = a.id
                WHERE a.user_id = :user_id
                  AND a.contest_setting_id = :contest_setting_id
                ORDER BY a.created_at DESC
                LIMIT :limit_n
                """
            ),
            params,
        ).mappings().all()

    out: list[dict[str, Any]] = []
    for r in rows:
        attempt_id = int(r["attempt_id"])
        created = r.get("submission_created_at") or r.get("attempt_created_at")
        created_iso = created.isoformat() if created is not None else None
        status = str(r.get("attempt_status") or "").upper()
        contest_rank = int(r.get("contest_rank") or 0)
        if contest_rank >= 2:
            status = "WINNER"
            label = "Winner"
        elif contest_rank == 1:
            status = "SHORTLISTED"
            label = "Shortlisted"
        elif status == "SUCCESS":
            label = "Submitted" if r.get("submission_id") else "Quiz Passed"
        elif status in {"FAILED_WRONG", "FAILED_TIMEOUT"}:
            label = "Quiz Failed"
        elif status == "IN_PROGRESS":
            label = "Incomplete"
        else:
            label = status.replace("_", " ").title() if status else "Unknown"

        year = created.year if created is not None else datetime.now().year
        out.append(
            {
                "attempt_id": attempt_id,
                "attempt_number": int(r.get("attempt_number") or 0),
                "reference": f"TBSC-{year}-{attempt_id:06d}",
                "status": status,
                "status_label": label,
                "submitted_at": created_iso,
                "word_count": (
                    int(r["submission_word_count"])
                    if r.get("submission_word_count") is not None
                    else None
                ),
            }
        )
    return out


def _next_attempt_number(session: Session, user_id: int) -> int:
    m = session.execute(
        select(func.coalesce(func.max(QuizAttempt.attempt_number), 0)).where(
            QuizAttempt.user_id == user_id
        )
    ).scalar_one()
    return int(m or 0) + 1


def pick_random_question_bank_file(session: Session) -> File | None:
    """Any non-deleted `files` row that has at least one active `quiz_questions` row."""
    has_active_questions = (
        select(func.count())
        .select_from(QuizQuestion)
        .where(
            QuizQuestion.file_id == File.id,
            QuizQuestion.is_active.is_(True),
            QuizQuestion.is_deleted.is_(False),
        )
        .scalar_subquery()
    )
    stmt = (
        select(File)
        .where(
            File.is_deleted.is_(False),
            has_active_questions > 0,
        )
        .order_by(text("RAND()"))
        .limit(1)
    )
    return session.execute(stmt).scalar_one_or_none()


def _question_limit_per_attempt(session: Session) -> int:
    s = _get_settings_row(session)
    try:
        v = int(getattr(s, "questions_per_attempt", 10) or 10)
    except Exception:
        v = 10
    return max(1, min(v, 100))


def _build_attempt_questions_from_db(session: Session, file_id: int) -> list[dict[str, Any]]:
    rows = session.execute(
        select(QuizQuestion).where(
            QuizQuestion.file_id == file_id,
            QuizQuestion.is_active.is_(True),
            QuizQuestion.is_deleted.is_(False),
        )
    ).scalars().all()
    if not rows:
        return []
    random.shuffle(rows)
    rows = rows[: _question_limit_per_attempt(session)]
    quiz: list[dict[str, Any]] = []
    for r in rows:
        options = [
            str(r.correct_answer),
            str(r.decoy_1),
            str(r.decoy_2),
            str(r.decoy_3),
        ]
        random.shuffle(options)
        correct_index = options.index(str(r.correct_answer))
        quiz.append(
            {
                "question_id": int(r.id),
                "question": str(r.question_text),
                "options": options,
                "correct_index": correct_index,
            }
        )
    return quiz


@dataclass
class StartAttemptResult:
    ok: bool
    attempt_id: int | None = None
    attempt_number: int | None = None
    total_questions: int | None = None
    first_question: dict[str, Any] | None = None
    time_seconds: int | None = None
    marks_per_question: int | None = None
    source_file_id: int | None = None
    source_file_name: str | None = None
    error: str | None = None


@guarded_service("quiz.start_attempt")
def start_attempt(user_id: int) -> StartAttemptResult:
    if engine() is None:
        return StartAttemptResult(ok=False, error="Database not configured")

    att_id: int | None = None
    attempt_number: int | None = None
    quiz: list[dict[str, Any]] = []
    time_seconds: int | None = None
    marks_per_question: int | None = None
    source_file_id: int | None = None
    source_file_name: str | None = None

    with session_scope() as session:
        _ensure_contest_link_columns(session)
        settings = _get_settings_row(session)
        time_seconds = int(settings.time_per_question_seconds)
        marks_per_question = int(settings.marks_per_question)
        max_a = int(settings.max_attempts)
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        active_contest = session.execute(
            select(ContestSetting).where(
                ContestSetting.is_active.is_(True),
                ContestSetting.is_deleted.is_(False),
                ContestSetting.season_start.is_not(None),
                ContestSetting.season_end.is_not(None),
                ContestSetting.season_start <= now,
                ContestSetting.season_end >= now,
            )
        ).scalar_one_or_none()
        if active_contest is None:
            return StartAttemptResult(ok=False, error="No active contest available")
        used = session.execute(
            select(func.count()).select_from(QuizAttempt).where(QuizAttempt.user_id == user_id)
        ).scalar_one()
        used = int(used or 0)
        if used >= max_a:
            return StartAttemptResult(ok=False, error="No attempts remaining")

        f = pick_random_question_bank_file(session)
        if f is None:
            return StartAttemptResult(
                ok=False,
                error="No question banks with active questions are available",
            )
        picked_file_id = int(f.id)
        source_file_id = picked_file_id
        source_file_name = str(f.file_name)
        quiz = _build_attempt_questions_from_db(session, picked_file_id)
        if not quiz:
            return StartAttemptResult(
                ok=False,
                error=f"No active questions found for file: {f.file_name}",
            )

        n = _next_attempt_number(session, user_id)
        att = QuizAttempt(
            user_id=user_id,
            contest_setting_id=int(active_contest.id),
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
        att_id = int(att.id)
        attempt_number = n

    first = quiz[0]
    q_payload = {"question": first["question"], "options": first["options"]}
    return StartAttemptResult(
        ok=True,
        attempt_id=att_id,
        attempt_number=attempt_number,
        total_questions=len(quiz),
        first_question={"index": 0, **q_payload},
        time_seconds=time_seconds,
        marks_per_question=marks_per_question,
        source_file_id=source_file_id,
        source_file_name=source_file_name,
    )


def _get_attempt_for_user(
    session: Session, attempt_id: int, user_id: int
) -> QuizAttempt | None:
    row = session.get(QuizAttempt, attempt_id)
    if row is None or int(row.user_id) != user_id:
        return None
    return row


@guarded_service("quiz.get_question_for_attempt")
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


@guarded_service("quiz.submit_answer")
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


@guarded_service("quiz.timeout_attempt")
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


@guarded_service("quiz.update_quiz_settings_row")
def update_quiz_settings_row(
    *,
    max_attempts: int | None = None,
    time_per_question_seconds: int | None = None,
    marks_per_question: int | None = None,
    questions_per_attempt: int | None = None,
) -> dict[str, Any]:
    """Persist quiz_settings row id=1 (admin)."""
    if engine() is None:
        raise RuntimeError("Database not configured")
    if max_attempts is not None and max_attempts < 1:
        raise ValueError("max_attempts must be >= 1")
    if time_per_question_seconds is not None and time_per_question_seconds < 5:
        raise ValueError("time_per_question_seconds must be >= 5")
    if marks_per_question is not None and marks_per_question < 1:
        raise ValueError("marks_per_question must be >= 1")
    if questions_per_attempt is not None and questions_per_attempt < 1:
        raise ValueError("questions_per_attempt must be >= 1")

    with session_scope() as session:
        row = _get_settings_row(session)
        if max_attempts is not None:
            row.max_attempts = max_attempts
        if time_per_question_seconds is not None:
            row.time_per_question_seconds = time_per_question_seconds
        if marks_per_question is not None:
            row.marks_per_question = marks_per_question
        if questions_per_attempt is not None:
            row.questions_per_attempt = questions_per_attempt
        session.flush()

    return get_quiz_settings_admin()


@guarded_service("quiz.get_analytics_summary")
def get_analytics_summary() -> dict[str, Any]:
    """Aggregate stats over attempts (scores live on attempts)."""
    if engine() is None:
        return {
            "total_attempts": 0,
            "by_status": {},
            "average_score": None,
            "total_score_sum": 0.0,
            "distinct_users": 0,
        }

    with session_scope() as session:
        total = session.execute(select(func.count()).select_from(QuizAttempt)).scalar_one()
        total = int(total or 0)

        status_rows = session.execute(
            select(QuizAttempt.status, func.count())
            .group_by(QuizAttempt.status)
        ).all()
        by_status: dict[str, int] = {}
        for st, c in status_rows:
            if st:
                by_status[str(st)] = int(c or 0)

        avg_score = session.execute(
            select(func.avg(QuizAttempt.score)).where(QuizAttempt.score.isnot(None))
        ).scalar_one()
        avg_f = float(avg_score) if avg_score is not None else None

        sum_score = session.execute(
            select(func.coalesce(func.sum(QuizAttempt.score), 0))
        ).scalar_one()
        sum_f = float(sum_score or 0)

        distinct_users = session.execute(
            select(func.count(func.distinct(QuizAttempt.user_id))).select_from(QuizAttempt)
        ).scalar_one()
        distinct_users = int(distinct_users or 0)

        return {
            "total_attempts": total,
            "by_status": by_status,
            "average_score": avg_f,
            "total_score_sum": sum_f,
            "distinct_users": distinct_users,
        }


@guarded_service("quiz.list_attempts_analytics")
def list_attempts_analytics(
    *,
    limit: int = 50,
    offset: int = 0,
    status: str | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """Paginated quiz attempts with user email for admin analytics."""
    if engine() is None:
        return [], 0

    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    with session_scope() as session:
        base = select(QuizAttempt, User.email).join(User, QuizAttempt.user_id == User.id)
        count_q = select(func.count()).select_from(QuizAttempt)
        if status:
            base = base.where(QuizAttempt.status == status)
            count_q = count_q.where(QuizAttempt.status == status)

        total = session.execute(count_q).scalar_one()
        total = int(total or 0)

        stmt = (
            base.order_by(QuizAttempt.created_at.desc()).limit(limit).offset(offset)
        )
        rows = session.execute(stmt).all()

        out: list[dict[str, Any]] = []
        for att, email in rows:
            ca = att.created_at
            ua = att.updated_at
            sc = att.score
            time_taken_seconds: int | None = None
            if ca is not None and ua is not None:
                try:
                    time_taken_seconds = int((ua - ca).total_seconds())
                except Exception:
                    time_taken_seconds = None
            out.append(
                {
                    "id": int(att.id),
                    "user_id": int(att.user_id),
                    "email": str(email),
                    "attempt_number": int(att.attempt_number),
                    "status": str(att.status),
                    "score": float(sc) if sc is not None else None,
                    "total_questions": int(att.total_questions or 0),
                    "correct_answers": int(att.correct_answers or 0),
                    "created_at": ca.isoformat() if ca else None,
                    "updated_at": ua.isoformat() if ua else None,
                    "time_taken_seconds": time_taken_seconds,
                }
            )
        return out, total
