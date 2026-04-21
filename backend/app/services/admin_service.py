"""Admin bootstrap, JWT auth, and admin user CRUD."""

from __future__ import annotations

import hashlib
import math
import os
import secrets
import string
import time
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

import bcrypt
import jwt
from sqlalchemy import func, select, text

from app.core.service_guard import guarded_service
from app.db import engine, session_scope
from app.models import ContestSetting, Role, User
from app.services.verification_service import normalize_email

ADMIN_ROLE_NAME = "admin"
BOOTSTRAP_TOKEN_MINUTES = 30
ADMIN_TOKEN_HOURS = 12
BOOTSTRAP_CODE_TTL_SEC = 600
CODE_LENGTH = 8

_admin_role_id: int | None = None
_bootstrap_code_hash: str | None = None
_bootstrap_expires_at: float | None = None


def _jwt_secret() -> str:
    s = os.environ.get("ADMIN_JWT_SECRET", "").strip()
    if not s:
        return "dev-insecure-admin-jwt-secret-change-me"
    return s


def _hash_plain(code: str) -> str:
    return hashlib.sha256(code.strip().upper().encode("utf-8")).hexdigest()


@guarded_service("admin.get_admin_role_id")
def get_admin_role_id() -> int | None:
    global _admin_role_id
    if _admin_role_id is not None:
        return _admin_role_id
    if engine() is None:
        return None
    with session_scope() as session:
        rid = session.execute(
            select(Role.id).where(Role.role_name == ADMIN_ROLE_NAME)
        ).scalar_one_or_none()
        if rid is None:
            return None
        _admin_role_id = int(rid)
        return _admin_role_id


@guarded_service("admin.count_active_admins")
def count_active_admins() -> int:
    if engine() is None:
        return 0
    rid = get_admin_role_id()
    if rid is None:
        return 0
    with session_scope() as session:
        n = session.execute(
            select(func.count())
            .select_from(User)
            .where(
                User.role_id == rid,
                User.is_deleted.is_(False),
            )
        ).scalar_one()
        return int(n or 0)


def needs_bootstrap() -> bool:
    return count_active_admins() == 0


@guarded_service("admin.request_bootstrap_code")
def request_bootstrap_code() -> None:
    """Generate one-time code, store hash, print plaintext to server console."""
    if not needs_bootstrap():
        raise ValueError("Bootstrap is not required (admins already exist).")
    global _bootstrap_code_hash, _bootstrap_expires_at
    alphabet = string.ascii_uppercase + string.digits
    plain = "".join(secrets.choice(alphabet) for _ in range(CODE_LENGTH))
    _bootstrap_code_hash = _hash_plain(plain)
    _bootstrap_expires_at = time.monotonic() + BOOTSTRAP_CODE_TTL_SEC
    print(
        f"\n[ADMIN BOOTSTRAP] Paste this code in the admin console (expires in {BOOTSTRAP_CODE_TTL_SEC // 60} min): {plain}\n",
        flush=True,
    )


@guarded_service("admin.verify_bootstrap_code")
def verify_bootstrap_code(code: str) -> str:
    global _bootstrap_code_hash, _bootstrap_expires_at
    if not needs_bootstrap():
        raise ValueError("Bootstrap is not required.")
    if not _bootstrap_code_hash or _bootstrap_expires_at is None:
        raise ValueError("No bootstrap code was requested. Load the admin page to generate one.")
    if time.monotonic() > _bootstrap_expires_at:
        _bootstrap_code_hash = None
        _bootstrap_expires_at = None
        raise ValueError("Bootstrap code expired. Reload the admin page to get a new code.")
    if _hash_plain(code) != _bootstrap_code_hash:
        raise ValueError("Invalid bootstrap code.")
    _bootstrap_code_hash = None
    _bootstrap_expires_at = None
    now = datetime.now(timezone.utc)
    payload = {
        "typ": "bootstrap",
        "exp": now + timedelta(minutes=BOOTSTRAP_TOKEN_MINUTES),
        "iat": now,
    }
    return jwt.encode(payload, _jwt_secret(), algorithm="HS256")


@guarded_service("admin.decode_token")
def decode_token(raw: str) -> dict[str, Any]:
    return jwt.decode(raw, _jwt_secret(), algorithms=["HS256"])


def _random_password() -> str:
    return secrets.token_urlsafe(14)


def _hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, stored_hash: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), stored_hash.encode("utf-8"))
    except ValueError:
        return False


@guarded_service("admin.create_admin_users")
def create_admin_users(emails: list[str]) -> list[dict[str, str]]:
    """
    Create admin users with random passwords. Returns [{email, password}, ...] once.
    """
    if engine() is None:
        raise RuntimeError("Database not configured")
    rid = get_admin_role_id()
    if rid is None:
        raise RuntimeError("Admin role missing in DB; run sql/004_admin_users.sql")

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    with session_scope() as session:
        for raw in emails:
            email = normalize_email(raw)
            if not email or email in seen:
                continue
            seen.add(email)
            existing = session.execute(select(User).where(User.email == email)).scalar_one_or_none()
            pwd = _random_password()
            ph = _hash_password(pwd)
            if existing is not None:
                er = int(existing.role_id or 0)
                if not existing.is_deleted and er != rid:
                    raise ValueError(f"Email already in use: {email}")
                existing.is_deleted = False
                existing.is_active = True
                existing.is_verified = True
                existing.role_id = rid
                existing.password_hash = ph
                if existing.consent_accepted_at is None:
                    existing.consent_accepted_at = now
                session.flush()
                out.append({"email": email, "password": pwd})
                continue

            session.add(
                User(
                    email=email,
                    is_verified=True,
                    is_active=True,
                    is_deleted=False,
                    role_id=rid,
                    password_hash=ph,
                    consent_accepted_at=now,
                )
            )
            session.flush()
            out.append({"email": email, "password": pwd})
    return out


@guarded_service("admin.admin_login")
def admin_login(email: str, password: str) -> str:
    if engine() is None:
        raise RuntimeError("Database not configured")
    rid = get_admin_role_id()
    if rid is None:
        raise RuntimeError("Admin role missing")
    email = normalize_email(email)
    with session_scope() as session:
        user = session.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if user is None or user.is_deleted:
            raise ValueError("Invalid email or password")
        if int(user.role_id or 0) != rid:
            raise ValueError("Invalid email or password")
        if not user.password_hash or not verify_password(password, user.password_hash):
            raise ValueError("Invalid email or password")
        if not user.is_active:
            raise ValueError("Account disabled")
        uid = int(user.id)
        em = user.email
    now = datetime.now(timezone.utc)
    payload = {
        "typ": "admin",
        "sub": str(uid),
        "email": em,
        "exp": now + timedelta(hours=ADMIN_TOKEN_HOURS),
        "iat": now,
    }
    return jwt.encode(payload, _jwt_secret(), algorithm="HS256")


@dataclass
class AdminListRow:
    id: int
    email: str
    is_active: bool
    is_deleted: bool
    created_at: str | None


def _start_of_day(d: date) -> datetime:
    return datetime.combine(d, time.min)


def _end_of_day(d: date) -> datetime:
    return datetime.combine(d, time(23, 59, 59))


def _season_datetimes(
    season_start_date: date | None, season_end_date: date | None
) -> tuple[datetime | None, datetime | None]:
    start = _start_of_day(season_start_date) if season_start_date is not None else None
    end = _end_of_day(season_end_date) if season_end_date is not None else None
    if start is not None and end is not None and end < start:
        raise ValueError("Season end date must be on or after season start date.")
    return start, end


@dataclass
class ContestSettingRow:
    id: int
    subject_name: str
    subject_description: str | None
    is_active: bool
    is_deleted: bool
    season_start: str | None
    season_end: str | None
    shortlist_threshold: int
    allow_repeat_users: bool
    shortlist_announced: bool
    winner_announced: bool
    created_at: str | None
    updated_at: str | None


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


def _announce_flags_by_setting(session) -> dict[int, tuple[bool, bool]]:
    _ensure_contest_result_table(session)
    rows = session.execute(
        text(
            """
            SELECT
              contest_setting_id,
              MAX(CASE WHEN status IN ('SHORTLISTED', 'WINNER') THEN 1 ELSE 0 END) AS shortlist_announced,
              MAX(CASE WHEN status = 'WINNER' THEN 1 ELSE 0 END) AS winner_announced
            FROM contest_entry_results
            GROUP BY contest_setting_id
            """
        )
    ).mappings().all()
    return {
        int(r["contest_setting_id"]): (
            bool(int(r["shortlist_announced"] or 0)),
            bool(int(r["winner_announced"] or 0)),
        )
        for r in rows
    }


@guarded_service("admin.list_contest_settings")
def list_contest_settings(include_deleted: bool = False) -> list[ContestSettingRow]:
    if engine() is None:
        return []
    with session_scope() as session:
        flags = _announce_flags_by_setting(session)
        q = select(ContestSetting)
        if not include_deleted:
            q = q.where(ContestSetting.is_deleted.is_(False))
        rows = session.execute(q.order_by(ContestSetting.id.desc())).scalars().all()
        out: list[ContestSettingRow] = []
        for r in rows:
            out.append(
                ContestSettingRow(
                    id=int(r.id),
                    subject_name=r.subject_name,
                    subject_description=r.subject_description,
                    is_active=bool(r.is_active),
                    is_deleted=bool(r.is_deleted),
                    season_start=r.season_start.isoformat() if r.season_start else None,
                    season_end=r.season_end.isoformat() if r.season_end else None,
                    shortlist_threshold=max(1, min(int(r.shortlist_threshold or 10), 100)),
                    allow_repeat_users=bool(r.allow_repeat_users),
                    shortlist_announced=flags.get(int(r.id), (False, False))[0],
                    winner_announced=flags.get(int(r.id), (False, False))[1],
                    created_at=r.created_at.isoformat() if r.created_at else None,
                    updated_at=r.updated_at.isoformat() if r.updated_at else None,
                )
            )
        return out


@guarded_service("admin.add_contest_setting")
def add_contest_setting(
    subject_name: str,
    subject_description: str | None,
    is_active: bool,
    season_start_date: date | None,
    season_end_date: date | None,
    shortlist_threshold: int,
    allow_repeat_users: bool,
    actor_user_id: int | None,
) -> ContestSettingRow:
    if engine() is None:
        raise RuntimeError("Database not configured")
    name = subject_name.strip()
    if not name:
        raise ValueError("subject_name is required")
    season_start, season_end = _season_datetimes(season_start_date, season_end_date)
    st = max(1, min(int(shortlist_threshold), 100))
    with session_scope() as session:
        existing_name = session.execute(
            select(ContestSetting).where(
                ContestSetting.subject_name == name,
                ContestSetting.is_deleted.is_(False),
            )
        ).scalar_one_or_none()
        if existing_name is not None:
            raise ValueError("Subject already exists")

        # Explicit single-active check while adding.
        if is_active:
            active_existing = session.execute(
                select(ContestSetting).where(
                    ContestSetting.is_active.is_(True),
                    ContestSetting.is_deleted.is_(False),
                )
            ).scalar_one_or_none()
            if active_existing is not None:
                raise ValueError(
                    f"Active subject already exists: '{active_existing.subject_name}'. "
                    "Deactivate it before adding another active subject."
                )

        row = ContestSetting(
            subject_name=name,
            subject_description=subject_description.strip() if subject_description else None,
            is_active=bool(is_active),
            is_deleted=False,
            season_start=season_start,
            season_end=season_end,
            shortlist_threshold=st,
            allow_repeat_users=bool(allow_repeat_users),
            created_by=actor_user_id,
            updated_by=actor_user_id,
        )
        session.add(row)
        session.flush()
        return ContestSettingRow(
            id=int(row.id),
            subject_name=row.subject_name,
            subject_description=row.subject_description,
            is_active=bool(row.is_active),
            is_deleted=bool(row.is_deleted),
            season_start=row.season_start.isoformat() if row.season_start else None,
            season_end=row.season_end.isoformat() if row.season_end else None,
            shortlist_threshold=max(1, min(int(row.shortlist_threshold or 10), 100)),
            allow_repeat_users=bool(row.allow_repeat_users),
            shortlist_announced=False,
            winner_announced=False,
            created_at=row.created_at.isoformat() if row.created_at else None,
            updated_at=row.updated_at.isoformat() if row.updated_at else None,
        )


@guarded_service("admin.update_contest_setting_season")
def update_contest_setting_season(
    setting_id: int,
    season_start_date: date | None,
    season_end_date: date | None,
    actor_user_id: int | None,
) -> ContestSettingRow:
    if engine() is None:
        raise RuntimeError("Database not configured")
    season_start, season_end = _season_datetimes(season_start_date, season_end_date)
    with session_scope() as session:
        row = session.get(ContestSetting, setting_id)
        if row is None or bool(row.is_deleted):
            raise ValueError("Contest setting not found")
        row.season_start = season_start
        row.season_end = season_end
        row.updated_by = actor_user_id
        session.flush()
        flags = _announce_flags_by_setting(session).get(int(row.id), (False, False))
        return ContestSettingRow(
            id=int(row.id),
            subject_name=row.subject_name,
            subject_description=row.subject_description,
            is_active=bool(row.is_active),
            is_deleted=bool(row.is_deleted),
            season_start=row.season_start.isoformat() if row.season_start else None,
            season_end=row.season_end.isoformat() if row.season_end else None,
            shortlist_threshold=max(1, min(int(row.shortlist_threshold or 10), 100)),
            allow_repeat_users=bool(row.allow_repeat_users),
            shortlist_announced=flags[0],
            winner_announced=flags[1],
            created_at=row.created_at.isoformat() if row.created_at else None,
            updated_at=row.updated_at.isoformat() if row.updated_at else None,
        )


@guarded_service("admin.update_contest_setting_shortlist")
def update_contest_setting_shortlist(
    setting_id: int,
    shortlist_threshold: int,
    allow_repeat_users: bool,
    actor_user_id: int | None,
) -> ContestSettingRow:
    if engine() is None:
        raise RuntimeError("Database not configured")
    st = max(1, min(int(shortlist_threshold), 100))
    with session_scope() as session:
        row = session.get(ContestSetting, setting_id)
        if row is None or bool(row.is_deleted):
            raise ValueError("Contest setting not found")
        row.shortlist_threshold = st
        row.allow_repeat_users = bool(allow_repeat_users)
        row.updated_by = actor_user_id
        session.flush()
        flags = _announce_flags_by_setting(session).get(int(row.id), (False, False))
        return ContestSettingRow(
            id=int(row.id),
            subject_name=row.subject_name,
            subject_description=row.subject_description,
            is_active=bool(row.is_active),
            is_deleted=bool(row.is_deleted),
            season_start=row.season_start.isoformat() if row.season_start else None,
            season_end=row.season_end.isoformat() if row.season_end else None,
            shortlist_threshold=st,
            allow_repeat_users=bool(row.allow_repeat_users),
            shortlist_announced=flags[0],
            winner_announced=flags[1],
            created_at=row.created_at.isoformat() if row.created_at else None,
            updated_at=row.updated_at.isoformat() if row.updated_at else None,
        )


@guarded_service("admin.deactivate_contest_setting")
def deactivate_contest_setting(setting_id: int, actor_user_id: int | None) -> None:
    if engine() is None:
        raise RuntimeError("Database not configured")
    with session_scope() as session:
        row = session.get(ContestSetting, setting_id)
        if row is None or bool(row.is_deleted):
            raise ValueError("Contest setting not found")
        row.is_deleted = True
        row.is_active = False
        row.updated_by = actor_user_id
        session.flush()


def _get_shortlist_rows_for_setting(session, setting_id: int) -> tuple[list[dict[str, Any]], bool]:
    base = session.execute(
        text(
            """
            SELECT shortlist_threshold, allow_repeat_users, season_end
            FROM contest_settings
            WHERE id = :setting_id AND is_active = 1 AND is_deleted = 0
            LIMIT 1
            """
        ),
        {"setting_id": int(setting_id)},
    ).mappings().one_or_none()
    if base is None:
        raise ValueError("Only active contest can be announced")
    season_end = base.get("season_end")
    if season_end is None:
        raise ValueError("Set a season end date before announcing shortlist")
    if season_end > datetime.now():
        raise ValueError("Shortlist can be announced only after contest end time")

    existing_flags = _announce_flags_by_setting(session).get(int(setting_id), (False, False))
    if existing_flags[0]:
        raise ValueError("Shortlist already announced for this contest")

    threshold = max(1, min(int(base["shortlist_threshold"] or 10), 100))
    repeat_users = bool(base["allow_repeat_users"])

    total_scores = int(session.execute(text("SELECT COUNT(*) FROM scores")).scalar() or 0)
    if total_scores <= 0:
        return [], repeat_users
    k = min(total_scores, max(1, math.ceil(total_scores * threshold / 100.0)))

    if repeat_users:
        rows = session.execute(
            text(
                """
                WITH ranked AS (
                  SELECT s.id AS score_id, s.submission_id, s.user_id,
                         ROW_NUMBER() OVER (
                           ORDER BY s.weighted_score DESC, s.total_score DESC, s.evaluated_at DESC, s.id DESC
                         ) AS rn
                  FROM scores s
                )
                SELECT score_id, submission_id, user_id, rn
                FROM ranked
                WHERE rn <= :k
                ORDER BY rn ASC
                """
            ),
            {"k": int(k)},
        ).mappings().all()
    else:
        rows = session.execute(
            text(
                """
                WITH per_user AS (
                  SELECT s.id AS score_id, s.submission_id, s.user_id,
                         s.weighted_score, s.total_score, s.evaluated_at,
                         ROW_NUMBER() OVER (
                           PARTITION BY s.user_id
                           ORDER BY s.weighted_score DESC, s.total_score DESC, s.evaluated_at DESC, s.id DESC
                         ) AS user_rn
                  FROM scores s
                ),
                ranked AS (
                  SELECT score_id, submission_id, user_id,
                         ROW_NUMBER() OVER (
                           ORDER BY weighted_score DESC, total_score DESC, evaluated_at DESC, score_id DESC
                         ) AS rn
                  FROM per_user
                  WHERE user_rn = 1
                )
                SELECT score_id, submission_id, user_id, rn
                FROM ranked
                WHERE rn <= :k
                ORDER BY rn ASC
                """
            ),
            {"k": int(k)},
        ).mappings().all()

    return [dict(r) for r in rows], repeat_users


@guarded_service("admin.announce_contest_shortlist")
def announce_contest_shortlist(
    *,
    setting_id: int,
    actor_user_id: int | None,
) -> dict[str, Any]:
    if engine() is None:
        raise RuntimeError("Database not configured")
    with session_scope() as session:
        _ensure_contest_result_table(session)
        rows, repeat_users = _get_shortlist_rows_for_setting(session, setting_id)
        if not rows:
            raise ValueError("No scores available to shortlist")

        insert_q = text(
            """
            INSERT INTO contest_entry_results (
              contest_setting_id, score_id, submission_id, attempt_id, user_id, status, rank_position
            )
            SELECT
              :setting_id, :score_id, :submission_id, s.attempt_id, :user_id, 'SHORTLISTED', :rank_position
            FROM submissions s
            WHERE s.id = :submission_id
            ON DUPLICATE KEY UPDATE
              submission_id = VALUES(submission_id),
              attempt_id = VALUES(attempt_id),
              user_id = VALUES(user_id),
              status = 'SHORTLISTED',
              rank_position = VALUES(rank_position)
            """
        )
        for r in rows:
            session.execute(
                insert_q,
                {
                    "setting_id": int(setting_id),
                    "score_id": int(r["score_id"]),
                    "submission_id": int(r["submission_id"]),
                    "user_id": int(r["user_id"]),
                    "rank_position": int(r["rn"]),
                },
            )
        session.flush()
        return {
            "ok": True,
            "shortlisted_count": len(rows),
            "repeat_users": repeat_users,
            "winner_announced": False,
            "updated_by": actor_user_id,
        }


@guarded_service("admin.announce_contest_winner")
def announce_contest_winner(
    *,
    setting_id: int,
    actor_user_id: int | None,
) -> dict[str, Any]:
    if engine() is None:
        raise RuntimeError("Database not configured")
    with session_scope() as session:
        _ensure_contest_result_table(session)
        row = session.execute(
            text(
                """
                SELECT id, is_active, is_deleted
                FROM contest_settings
                WHERE id = :setting_id
                LIMIT 1
                """
            ),
            {"setting_id": int(setting_id)},
        ).mappings().one_or_none()
        if row is None or not bool(row["is_active"]) or bool(row["is_deleted"]):
            raise ValueError("Only active contest can announce winner")
        flags = _announce_flags_by_setting(session).get(int(setting_id), (False, False))
        if not flags[0]:
            raise ValueError("Announce shortlist before announcing winner")
        if flags[1]:
            raise ValueError("Winner already announced for this contest")

        winner = session.execute(
            text(
                """
                SELECT id, score_id, submission_id, user_id
                FROM contest_entry_results
                WHERE contest_setting_id = :setting_id AND status = 'SHORTLISTED'
                ORDER BY rank_position ASC, id ASC
                LIMIT 1
                """
            ),
            {"setting_id": int(setting_id)},
        ).mappings().one_or_none()
        if winner is None:
            raise ValueError("No shortlisted entries available to announce winner")
        session.execute(
            text(
                """
                UPDATE contest_entry_results
                SET status = CASE WHEN id = :winner_id THEN 'WINNER' ELSE status END
                WHERE contest_setting_id = :setting_id
                """
            ),
            {"winner_id": int(winner["id"]), "setting_id": int(setting_id)},
        )
        session.flush()
        return {
            "ok": True,
            "winner_score_id": int(winner["score_id"]),
            "winner_submission_id": int(winner["submission_id"]),
            "winner_user_id": int(winner["user_id"]),
            "updated_by": actor_user_id,
        }


@guarded_service("admin.list_admins")
def list_admins(include_deleted: bool = False) -> list[AdminListRow]:
    rid = get_admin_role_id()
    if rid is None or engine() is None:
        return []
    with session_scope() as session:
        q = select(User).where(User.role_id == rid)
        if not include_deleted:
            q = q.where(User.is_deleted.is_(False))
        rows = session.execute(q.order_by(User.id)).scalars().all()
        out: list[AdminListRow] = []
        for u in rows:
            ca = u.created_at
            out.append(
                AdminListRow(
                    id=int(u.id),
                    email=u.email,
                    is_active=bool(u.is_active),
                    is_deleted=bool(u.is_deleted),
                    created_at=ca.isoformat() if ca else None,
                )
            )
        return out


@guarded_service("admin.disable_admin")
def disable_admin(user_id: int, actor_user_id: int) -> None:
    if user_id == actor_user_id:
        raise ValueError("You cannot disable your own account")
    rid = get_admin_role_id()
    if rid is None or engine() is None:
        raise RuntimeError("Database error")
    with session_scope() as session:
        user = session.get(User, user_id)
        if user is None or int(user.role_id or 0) != rid:
            raise ValueError("User not found or not an admin")
        user.is_deleted = True
        user.is_active = False
        session.flush()


@guarded_service("admin.assert_bootstrap_token")
def assert_bootstrap_token(token: str) -> None:
    payload = decode_token(token)
    if payload.get("typ") != "bootstrap":
        raise ValueError("Invalid bootstrap token")


@guarded_service("admin.assert_admin_token")
def assert_admin_token(token: str) -> int:
    payload = decode_token(token)
    if payload.get("typ") != "admin":
        raise ValueError("Invalid admin token")
    sub = payload.get("sub")
    if not sub:
        raise ValueError("Invalid admin token")
    return int(sub)
