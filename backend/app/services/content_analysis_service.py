"""Admin content analysis from the `scores` table."""

from __future__ import annotations

import json
import math
from typing import Any

from sqlalchemy import text

from app.core.service_guard import guarded_service
from app.db import engine, run_in_transaction, session_scope


def _active_contest_window(session) -> tuple[Any, Any] | None:
    row = session.execute(
        text(
            """
            SELECT season_start, season_end
            FROM contest_settings
            WHERE is_active = 1 AND is_deleted = 0
            LIMIT 1
            """
        )
    ).mappings().one_or_none()
    if row is None:
        return None
    season_start = row.get("season_start")
    season_end = row.get("season_end")
    if season_start is None or season_end is None:
        return None
    return season_start, season_end


def _coerce_reasoning(v: Any) -> dict[str, Any] | None:
    if v is None:
        return None
    if isinstance(v, dict):
        return v
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return None
        try:
            j = json.loads(s)
            return j if isinstance(j, dict) else None
        except Exception:
            return None
    return None


def _row_to_score_dict(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": int(r["id"]),
        "agent": str(r["agent"]),
        "relevance": int(r["relevance"]),
        "creativity": int(r["creativity"]),
        "clarity": int(r["clarity"]),
        "impact": int(r["impact"]),
        "total_score": int(r["total_score"]),
        "weighted_score": float(r["weighted_score"]),
        "confidence": float(r["confidence"]) if r.get("confidence") is not None else None,
        "uncertainty_reason": str(r["uncertainty_reason"]) if r.get("uncertainty_reason") is not None else "",
        "needs_human_review": bool(int(r["needs_human_review"])) if r.get("needs_human_review") is not None else False,
        "reasoning": _coerce_reasoning(r.get("reasoning")),
        "evaluated_at": r["evaluated_at"].isoformat() if r.get("evaluated_at") else None,
        "submission_id": int(r["submission_id"]),
        "user_id": int(r["user_id"]),
        "user_email": str(r["user_email"]) if r.get("user_email") is not None else "",
        "highlight_kind": str(r["highlight_kind"]) if r.get("highlight_kind") is not None else None,
    }


@guarded_service("content_analysis.list_scores")
def list_scores(
    *,
    limit: int = 50,
    offset: int = 0,
    agent: str | None = None,
    user_id: int | None = None,
    submission_id: int | None = None,
) -> tuple[list[dict[str, Any]], int]:
    if engine() is None:
        return [], 0

    limit = max(1, min(int(limit), 200))
    offset = max(0, int(offset))

    with session_scope() as session:
        active_window = _active_contest_window(session)
    if active_window is None:
        return [], 0
    season_start, season_end = active_window

    where: list[str] = [
        "sub.created_at >= :season_start",
        "sub.created_at <= :season_end",
    ]
    params: dict[str, Any] = {
        "limit": limit,
        "offset": offset,
        "season_start": season_start,
        "season_end": season_end,
    }
    if agent:
        where.append("s.agent = :agent")
        params["agent"] = agent
    if user_id is not None:
        where.append("s.user_id = :user_id")
        params["user_id"] = int(user_id)
    if submission_id is not None:
        where.append("s.submission_id = :submission_id")
        params["submission_id"] = int(submission_id)

    where_sql = " WHERE " + " AND ".join(where)

    count_q = text(
        f"""
        SELECT COUNT(*) AS c
        FROM scores s
        INNER JOIN submissions sub ON sub.id = s.submission_id
        {where_sql}
        """
    )
    rows_q = text(
        f"""
        SELECT
          s.id, s.agent, s.relevance, s.creativity, s.clarity, s.impact, s.total_score, s.weighted_score,
          s.confidence, s.uncertainty_reason, s.needs_human_review,
          s.reasoning, s.evaluated_at, s.submission_id, s.user_id, u.email AS user_email
        FROM scores s
        INNER JOIN submissions sub ON sub.id = s.submission_id
        LEFT JOIN users u ON u.id = s.user_id
        {where_sql}
        ORDER BY s.evaluated_at DESC, s.id DESC
        LIMIT :limit OFFSET :offset
        """
    )

    def _work(session):
        total = session.execute(count_q, params).mappings().one()["c"]
        total_i = int(total or 0)
        rows_local = session.execute(rows_q, params).mappings().all()
        return total_i, rows_local
    total, rows = run_in_transaction(_work, operation="content_analysis.list_scores")

    out: list[dict[str, Any]] = [_row_to_score_dict(r) for r in rows]
    return out, total


@guarded_service("content_analysis.list_shortlisted_scores")
def list_shortlisted_scores(
    *,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int, dict[str, Any]] | None:
    """
    Rows in the top ``shortlist_threshold`` percent of all `scores` by weighted_score (then tie-breakers),
    using the **active** `contest_settings` row. ``shortlist_size`` = ceil(n * p / 100) capped at ``n``.
    Returns None if there is no active contest setting.
    """
    if engine() is None:
        return None

    limit = max(1, min(int(limit), 200))
    offset = max(0, int(offset))

    threshold_q = text(
        """
        SELECT shortlist_threshold, allow_repeat_users, season_start, season_end
        FROM contest_settings
        WHERE is_active = 1 AND is_deleted = 0
        LIMIT 1
        """
    )

    def _threshold_and_n(session):
        tr = session.execute(threshold_q).mappings().one_or_none()
        if tr is None:
            return None
        season_start = tr.get("season_start")
        season_end = tr.get("season_end")
        if season_start is None or season_end is None:
            return None
        pct = int(tr["shortlist_threshold"])
        pct = max(1, min(pct, 100))
        repeat_users = bool(tr["allow_repeat_users"])
        n_raw = session.execute(
            text(
                """
                SELECT COUNT(*) AS n
                FROM scores s
                INNER JOIN submissions sub ON sub.id = s.submission_id
                WHERE sub.created_at >= :season_start AND sub.created_at <= :season_end
                """
            ),
            {"season_start": season_start, "season_end": season_end},
        ).scalar()
        n = int(n_raw or 0)
        du_raw = session.execute(
            text(
                """
                SELECT COUNT(DISTINCT s.user_id) AS n
                FROM scores s
                INNER JOIN submissions sub ON sub.id = s.submission_id
                WHERE sub.created_at >= :season_start AND sub.created_at <= :season_end
                """
            ),
            {"season_start": season_start, "season_end": season_end},
        ).scalar()
        distinct_users = int(du_raw or 0)
        return pct, repeat_users, n, distinct_users, season_start, season_end

    base = run_in_transaction(_threshold_and_n, operation="content_analysis.list_shortlisted_scores.meta")
    if base is None:
        return None

    pct, repeat_users, n, distinct_users, season_start, season_end = base
    if n == 0:
        return (
            [],
            0,
            {
                "threshold_percent": pct,
                "repeat_users": repeat_users,
                "total_scores_in_pool": 0,
                "shortlist_size": 0,
            },
        )

    k = min(n, max(0, math.ceil(n * pct / 100.0)))

    rows_q_repeat = text(
        """
        WITH ranked AS (
          SELECT
            s.id, s.agent, s.relevance, s.creativity, s.clarity, s.impact, s.total_score, s.weighted_score,
            s.confidence, s.uncertainty_reason, s.needs_human_review,
            s.reasoning, s.evaluated_at, s.submission_id, s.user_id, u.email AS user_email,
            ROW_NUMBER() OVER (
              ORDER BY s.weighted_score DESC, s.total_score DESC, s.evaluated_at DESC, s.id DESC
            ) AS rn
          FROM scores s
          INNER JOIN submissions sub ON sub.id = s.submission_id
          LEFT JOIN users u ON u.id = s.user_id
          WHERE sub.created_at >= :season_start AND sub.created_at <= :season_end
        )
        SELECT
          id, agent, relevance, creativity, clarity, impact, total_score, weighted_score,
          confidence, uncertainty_reason, needs_human_review,
          reasoning, evaluated_at, submission_id, user_id, user_email
        FROM ranked
        WHERE rn <= :k
        ORDER BY weighted_score DESC, total_score DESC, evaluated_at DESC, id DESC
        LIMIT :limit OFFSET :offset
        """
    )
    rows_q_unique = text(
        """
        WITH per_user AS (
          SELECT
            s.id, s.agent, s.relevance, s.creativity, s.clarity, s.impact, s.total_score, s.weighted_score,
            s.confidence, s.uncertainty_reason, s.needs_human_review,
            s.reasoning, s.evaluated_at, s.submission_id, s.user_id, u.email AS user_email,
            ROW_NUMBER() OVER (
              PARTITION BY s.user_id
              ORDER BY s.weighted_score DESC, s.total_score DESC, s.evaluated_at DESC, s.id DESC
            ) AS user_rn
          FROM scores s
          INNER JOIN submissions sub ON sub.id = s.submission_id
          LEFT JOIN users u ON u.id = s.user_id
          WHERE sub.created_at >= :season_start AND sub.created_at <= :season_end
        ),
        ranked AS (
          SELECT
            *,
            ROW_NUMBER() OVER (
              ORDER BY weighted_score DESC, total_score DESC, evaluated_at DESC, id DESC
            ) AS rn
          FROM per_user
          WHERE user_rn = 1
        )
        SELECT
          id, agent, relevance, creativity, clarity, impact, total_score, weighted_score,
          confidence, uncertainty_reason, needs_human_review,
          reasoning, evaluated_at, submission_id, user_id, user_email
        FROM ranked
        WHERE rn <= :k
        ORDER BY weighted_score DESC, total_score DESC, evaluated_at DESC, id DESC
        LIMIT :limit OFFSET :offset
        """
    )

    def _rows(session):
        return session.execute(
            rows_q_repeat if repeat_users else rows_q_unique,
            {
                "k": k,
                "limit": limit,
                "offset": offset,
                "season_start": season_start,
                "season_end": season_end,
            },
        ).mappings().all()

    rows = run_in_transaction(_rows, operation="content_analysis.list_shortlisted_scores.rows")
    shortlist_count = k if repeat_users else min(k, distinct_users)
    out = [_row_to_score_dict(r) for r in rows]
    meta = {
        "threshold_percent": pct,
        "repeat_users": repeat_users,
        "total_scores_in_pool": n,
        "shortlist_size": shortlist_count,
    }
    return out, shortlist_count, meta


@guarded_service("content_analysis.scores_summary")
def scores_summary(
    *,
    agent: str | None = None,
    user_id: int | None = None,
    submission_id: int | None = None,
) -> dict[str, Any]:
    """
    Aggregate metrics over the filtered set.
    Returns avg/min/max for each metric plus count.
    """
    if engine() is None:
        return {
            "count": 0,
            "avg": None,
            "min": None,
            "max": None,
        }

    with session_scope() as session:
        active_window = _active_contest_window(session)
    if active_window is None:
        return {"count": 0, "avg": None, "min": None, "max": None}
    season_start, season_end = active_window

    where: list[str] = [
        "sub.created_at >= :season_start",
        "sub.created_at <= :season_end",
    ]
    params: dict[str, Any] = {"season_start": season_start, "season_end": season_end}
    if agent:
        where.append("s.agent = :agent")
        params["agent"] = agent
    if user_id is not None:
        where.append("s.user_id = :user_id")
        params["user_id"] = int(user_id)
    if submission_id is not None:
        where.append("s.submission_id = :submission_id")
        params["submission_id"] = int(submission_id)
    where_sql = " WHERE " + " AND ".join(where)

    q = text(
        f"""
        SELECT
          COUNT(*) AS c,
          AVG(relevance) AS avg_relevance,
          AVG(creativity) AS avg_creativity,
          AVG(clarity) AS avg_clarity,
          AVG(impact) AS avg_impact,
          AVG(total_score) AS avg_total_score,
          AVG(weighted_score) AS avg_weighted_score,
          MIN(weighted_score) AS min_weighted_score,
          MAX(weighted_score) AS max_weighted_score
        FROM scores s
        INNER JOIN submissions sub ON sub.id = s.submission_id
        {where_sql}
        """
    )

    r = run_in_transaction(lambda session: session.execute(q, params).mappings().one(), operation="content_analysis.scores_summary")

    c = int(r["c"] or 0)
    if c == 0:
        return {"count": 0, "avg": None, "min": None, "max": None}

    avg = {
        "relevance": float(r["avg_relevance"] or 0),
        "creativity": float(r["avg_creativity"] or 0),
        "clarity": float(r["avg_clarity"] or 0),
        "impact": float(r["avg_impact"] or 0),
        "total_score": float(r["avg_total_score"] or 0),
        "weighted_score": float(r["avg_weighted_score"] or 0),
    }
    mn = {"weighted_score": float(r["min_weighted_score"] or 0)}
    mx = {"weighted_score": float(r["max_weighted_score"] or 0)}
    return {"count": c, "avg": avg, "min": mn, "max": mx}


@guarded_service("content_analysis.get_score_detail")
def get_score_detail(score_id: int) -> dict[str, Any] | None:
    """Single score row + original submitted text for admin verification."""
    if engine() is None:
        return None
    q = text(
        """
        SELECT
          s.id, s.agent, s.relevance, s.creativity, s.clarity, s.impact, s.total_score, s.weighted_score,
          s.confidence, s.uncertainty_reason, s.needs_human_review,
          s.reasoning, s.evaluated_at, s.submission_id, s.user_id,
          u.email AS user_email,
          sub.text_answer AS submission_text,
          sub.word_count AS submission_word_count
        FROM scores s
        LEFT JOIN users u ON u.id = s.user_id
        LEFT JOIN submissions sub ON sub.id = s.submission_id
        WHERE s.id = :score_id
        LIMIT 1
        """
    )
    r = run_in_transaction(
        lambda session: session.execute(q, {"score_id": int(score_id)}).mappings().one_or_none(),
        operation="content_analysis.get_score_detail",
    )
    if r is None:
        return None
    out = _row_to_score_dict(r)
    out["submission_text"] = str(r["submission_text"]) if r.get("submission_text") is not None else ""
    out["submission_word_count"] = int(r["submission_word_count"]) if r.get("submission_word_count") is not None else None
    return out


@guarded_service("content_analysis.analytics_overview_scores")
def analytics_overview_scores() -> dict[str, Any]:
    """Summary for /admin/analytics/summary sourced from `scores`."""
    if engine() is None:
        return {
            "total_scores": 0,
            "by_agent": {},
            "average_total_score": None,
            "average_weighted_score": None,
            "weighted_score_sum": 0.0,
            "distinct_users": 0,
        }

    def _work(session):
        active_window = _active_contest_window(session)
        if active_window is None:
            return None, []
        season_start, season_end = active_window
        agg_local = session.execute(
            text(
                """
                SELECT
                  COUNT(*) AS total_scores,
                  AVG(total_score) AS average_total_score,
                  AVG(weighted_score) AS average_weighted_score,
                  AVG(confidence) AS average_confidence,
                  COALESCE(SUM(needs_human_review), 0) AS needs_review_count,
                  COALESCE(SUM(weighted_score), 0) AS weighted_score_sum,
                  COUNT(DISTINCT s.user_id) AS distinct_users
                FROM scores s
                INNER JOIN submissions sub ON sub.id = s.submission_id
                WHERE sub.created_at >= :season_start AND sub.created_at <= :season_end
                """
            ),
            {"season_start": season_start, "season_end": season_end},
        ).mappings().one()
        agent_rows_local = session.execute(
            text(
                """
                SELECT agent, COUNT(*) AS c
                FROM scores s
                INNER JOIN submissions sub ON sub.id = s.submission_id
                WHERE sub.created_at >= :season_start AND sub.created_at <= :season_end
                GROUP BY agent
                ORDER BY c DESC
                """
            ),
            {"season_start": season_start, "season_end": season_end},
        ).mappings().all()
        return agg_local, agent_rows_local
    agg, agent_rows = run_in_transaction(_work, operation="content_analysis.analytics_overview_scores")
    if agg is None:
        return {
            "total_scores": 0,
            "by_agent": {},
            "average_total_score": None,
            "average_weighted_score": None,
            "average_confidence": None,
            "needs_review_count": 0,
            "weighted_score_sum": 0.0,
            "distinct_users": 0,
        }

    by_agent: dict[str, int] = {}
    for r in agent_rows:
        agent = str(r["agent"] or "")
        if not agent:
            continue
        by_agent[agent] = int(r["c"] or 0)

    return {
        "total_scores": int(agg["total_scores"] or 0),
        "by_agent": by_agent,
        "average_total_score": float(agg["average_total_score"]) if agg["average_total_score"] is not None else None,
        "average_weighted_score": float(agg["average_weighted_score"]) if agg["average_weighted_score"] is not None else None,
        "average_confidence": float(agg["average_confidence"]) if agg["average_confidence"] is not None else None,
        "needs_review_count": int(agg["needs_review_count"] or 0),
        "weighted_score_sum": float(agg["weighted_score_sum"] or 0),
        "distinct_users": int(agg["distinct_users"] or 0),
    }


@guarded_service("content_analysis.list_user_scores_by_email")
def list_user_scores_by_email(email: str, *, limit: int = 10) -> list[dict[str, Any]]:
    """Latest score rows for one user (for admin charts)."""
    if engine() is None:
        return []
    e = (email or "").strip().lower()
    if not e:
        return []
    limit = max(1, min(int(limit), 10))
    with session_scope() as session:
        active_window = _active_contest_window(session)
    if active_window is None:
        return []
    season_start, season_end = active_window
    q = text(
        """
        SELECT
          s.id, s.agent, s.relevance, s.creativity, s.clarity, s.impact, s.total_score, s.weighted_score,
          s.confidence, s.uncertainty_reason, s.needs_human_review, s.reasoning, s.evaluated_at,
          s.submission_id, s.user_id, u.email AS user_email
        FROM scores s
        INNER JOIN submissions sub ON sub.id = s.submission_id
        JOIN users u ON u.id = s.user_id
        WHERE LOWER(u.email) = :email
          AND sub.created_at >= :season_start
          AND sub.created_at <= :season_end
        ORDER BY s.evaluated_at DESC, s.id DESC
        LIMIT :limit
        """
    )
    rows = run_in_transaction(
        lambda session: session.execute(
            q,
            {
                "email": e,
                "limit": limit,
                "season_start": season_start,
                "season_end": season_end,
            },
        ).mappings().all(),
        operation="content_analysis.list_user_scores_by_email",
    )
    out: list[dict[str, Any]] = [_row_to_score_dict(r) for r in rows]
    return out


@guarded_service("content_analysis.list_score_highlights")
def list_score_highlights(*, limit: int = 20, offset: int = 0) -> tuple[list[dict[str, Any]], int]:
    """
    Global highlights across users:
      - TOP_SCORE row per user
      - NEEDS_REVIEW row per user (latest flagged)
    """
    if engine() is None:
        return [], 0
    limit = max(1, min(int(limit), 100))
    offset = max(0, int(offset))
    with session_scope() as session:
        active_window = _active_contest_window(session)
    if active_window is None:
        return [], 0
    season_start, season_end = active_window

    # MySQL 8 window functions.
    q = text(
        """
        WITH top_score AS (
          SELECT *
          FROM (
            SELECT
              s.id, s.agent, s.relevance, s.creativity, s.clarity, s.impact, s.total_score, s.weighted_score,
              s.confidence, s.uncertainty_reason, s.needs_human_review, s.reasoning, s.evaluated_at,
              s.submission_id, s.user_id, u.email AS user_email,
              'TOP_SCORE' AS highlight_kind,
              ROW_NUMBER() OVER (
                PARTITION BY s.user_id
                ORDER BY s.weighted_score DESC, s.total_score DESC, s.evaluated_at DESC, s.id DESC
              ) AS rn
            FROM scores s
            INNER JOIN submissions sub ON sub.id = s.submission_id
            JOIN users u ON u.id = s.user_id
            WHERE sub.created_at >= :season_start AND sub.created_at <= :season_end
          ) x
          WHERE x.rn = 1
        ),
        needs_review AS (
          SELECT *
          FROM (
            SELECT
              s.id, s.agent, s.relevance, s.creativity, s.clarity, s.impact, s.total_score, s.weighted_score,
              s.confidence, s.uncertainty_reason, s.needs_human_review, s.reasoning, s.evaluated_at,
              s.submission_id, s.user_id, u.email AS user_email,
              'NEEDS_REVIEW' AS highlight_kind,
              ROW_NUMBER() OVER (
                PARTITION BY s.user_id
                ORDER BY s.evaluated_at DESC, s.id DESC
              ) AS rn
            FROM scores s
            INNER JOIN submissions sub ON sub.id = s.submission_id
            JOIN users u ON u.id = s.user_id
            WHERE s.needs_human_review = 1
              AND sub.created_at >= :season_start
              AND sub.created_at <= :season_end
          ) y
          WHERE y.rn = 1
        ),
        combined AS (
          SELECT * FROM top_score
          UNION ALL
          SELECT * FROM needs_review
        )
        SELECT *
        FROM combined
        ORDER BY evaluated_at DESC, id DESC
        LIMIT :limit OFFSET :offset
        """
    )
    count_q = text(
        """
        WITH top_score AS (
          SELECT user_id
          FROM (
            SELECT s.user_id,
                   ROW_NUMBER() OVER (
                     PARTITION BY s.user_id
                     ORDER BY s.weighted_score DESC, s.total_score DESC, s.evaluated_at DESC, s.id DESC
                   ) AS rn
            FROM scores s
            INNER JOIN submissions sub ON sub.id = s.submission_id
            WHERE sub.created_at >= :season_start AND sub.created_at <= :season_end
          ) x
          WHERE rn = 1
        ),
        needs_review AS (
          SELECT user_id
          FROM (
            SELECT s.user_id,
                   ROW_NUMBER() OVER (
                     PARTITION BY s.user_id
                     ORDER BY s.evaluated_at DESC, s.id DESC
                   ) AS rn
            FROM scores s
            WHERE s.needs_human_review = 1
              AND EXISTS (
                SELECT 1
                FROM submissions sub
                WHERE sub.id = s.submission_id
                  AND sub.created_at >= :season_start
                  AND sub.created_at <= :season_end
              )
          ) y
          WHERE rn = 1
        )
        SELECT (SELECT COUNT(*) FROM top_score) + (SELECT COUNT(*) FROM needs_review) AS c
        """
    )

    def _work(session):
        total_local = int(
            session.execute(
                count_q,
                {"season_start": season_start, "season_end": season_end},
            ).mappings().one()["c"]
            or 0
        )
        rows_local = session.execute(
            q,
            {
                "limit": limit,
                "offset": offset,
                "season_start": season_start,
                "season_end": season_end,
            },
        ).mappings().all()
        return total_local, rows_local
    total, rows = run_in_transaction(_work, operation="content_analysis.list_score_highlights")

    out: list[dict[str, Any]] = [_row_to_score_dict(r) for r in rows]
    return out, total


def _weighted_from_scores(relevance: int, creativity: int, clarity: int, impact: int) -> float:
    # Same normalized scale as existing rows (0..10 typical). Keep 3-decimals in DB.
    return round((relevance + creativity + clarity + impact) / 4.0, 3)


@guarded_service("content_analysis.update_score_human_review")
def update_score_human_review(
    *,
    score_id: int,
    reviewer: str,
    scores: dict[str, int],
    reasoning: dict[str, str],
) -> dict[str, Any] | None:
    """Apply human review, append history/audit, and return updated score detail."""
    if engine() is None:
        return None
    sid = int(score_id)
    new_relevance = int(scores["relevance"])
    new_creativity = int(scores["creativity"])
    new_clarity = int(scores["clarity"])
    new_impact = int(scores["impact"])
    new_total = new_relevance + new_creativity + new_clarity + new_impact
    new_weighted = _weighted_from_scores(new_relevance, new_creativity, new_clarity, new_impact)
    new_reasoning = {
        "impact": str(reasoning["impact"]).strip(),
        "clarity": str(reasoning["clarity"]).strip(),
        "relevance": str(reasoning["relevance"]).strip(),
        "creativity": str(reasoning["creativity"]).strip(),
    }

    fetch_q = text(
        """
        SELECT
          s.id, s.agent, s.relevance, s.creativity, s.clarity, s.impact, s.total_score, s.weighted_score,
          s.confidence, s.uncertainty_reason, s.needs_human_review,
          s.reasoning, s.evaluated_at, s.submission_id, s.user_id, u.email AS user_email,
          sub.text_answer AS submission_text
        FROM scores s
        LEFT JOIN users u ON u.id = s.user_id
        LEFT JOIN submissions sub ON sub.id = s.submission_id
        WHERE s.id = :score_id
        LIMIT 1
        """
    )
    update_q = text(
        """
        UPDATE scores
        SET
          agent = 'human',
          relevance = :relevance,
          creativity = :creativity,
          clarity = :clarity,
          impact = :impact,
          total_score = :total_score,
          weighted_score = :weighted_score,
          confidence = :confidence,
          needs_human_review = 0,
          uncertainty_reason = '',
          reasoning = :reasoning_json
        WHERE id = :score_id
        """
    )
    insert_history_q = text(
        """
        INSERT INTO score_review_history
          (score_id, previous_row_json, updated_row_json, reviewer)
        VALUES
          (:score_id, :previous_row_json, :updated_row_json, :reviewer)
        """
    )
    insert_audit_q = text(
        """
        INSERT INTO audit_logs_adjudiction
          (entry_id, agent_name, action, input, output)
        VALUES
          (:entry_id, 'human', 'human_review', :input_json, :output_json)
        """
    )

    def _work(session):
        row = session.execute(fetch_q, {"score_id": sid}).mappings().one_or_none()
        if row is None:
            return None

        previous_snapshot = dict(_row_to_score_dict(row))
        previous_snapshot["submission_text"] = str(row.get("submission_text") or "")

        session.execute(
            update_q,
            {
                "score_id": sid,
                "relevance": new_relevance,
                "creativity": new_creativity,
                "clarity": new_clarity,
                "impact": new_impact,
                "total_score": new_total,
                "weighted_score": new_weighted,
                "confidence": 1.0,
                "reasoning_json": json.dumps(new_reasoning),
            },
        )

        updated_row = session.execute(fetch_q, {"score_id": sid}).mappings().one()
        updated_snapshot = dict(_row_to_score_dict(updated_row))
        updated_snapshot["submission_text"] = str(updated_row.get("submission_text") or "")

        session.execute(
            insert_history_q,
            {
                "score_id": sid,
                "previous_row_json": json.dumps(previous_snapshot),
                "updated_row_json": json.dumps(updated_snapshot),
                "reviewer": reviewer,
            },
        )

        output_payload = {
            "valid": True,
            "errors": [],
            "scores": {
                "impact": new_impact,
                "clarity": new_clarity,
                "relevance": new_relevance,
                "creativity": new_creativity,
            },
            "reasoning": new_reasoning,
        }
        session.execute(
            insert_audit_q,
            {
                "entry_id": sid,
                "input_json": json.dumps({"text": str(row.get("submission_text") or "")}),
                "output_json": json.dumps(output_payload),
            },
        )
        return True
    wrote = run_in_transaction(_work, operation="content_analysis.update_score_human_review")
    if not wrote:
        return None
    return get_score_detail(sid)


@guarded_service("content_analysis.get_score_review_history")
def get_score_review_history(score_id: int) -> list[dict[str, Any]]:
    if engine() is None:
        return []
    q = text(
        """
        SELECT id, score_id, previous_row_json, updated_row_json, reviewer, created_at
        FROM score_review_history
        WHERE score_id = :score_id
        ORDER BY id DESC
        """
    )
    rows = run_in_transaction(
        lambda session: session.execute(q, {"score_id": int(score_id)}).mappings().all(),
        operation="content_analysis.get_score_review_history",
    )
    out: list[dict[str, Any]] = []
    for r in rows:
        prev = r.get("previous_row_json")
        upd = r.get("updated_row_json")
        try:
            prev_json = prev if isinstance(prev, dict) else json.loads(str(prev or "{}"))
        except Exception:
            prev_json = {}
        try:
            upd_json = upd if isinstance(upd, dict) else json.loads(str(upd or "{}"))
        except Exception:
            upd_json = {}
        out.append(
            {
                "id": int(r["id"]),
                "score_id": int(r["score_id"]),
                "previous_row_json": prev_json,
                "updated_row_json": upd_json,
                "reviewer": str(r["reviewer"]),
                "created_at": r["created_at"].isoformat() if r.get("created_at") else None,
            }
        )
    return out

