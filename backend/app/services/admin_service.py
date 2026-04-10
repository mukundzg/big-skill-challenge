"""Admin bootstrap, JWT auth, and admin user CRUD."""

from __future__ import annotations

import hashlib
import os
import secrets
import string
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt
from sqlalchemy import func, select

from app.core.service_guard import guarded_service
from app.db import engine, session_scope
from app.models import ContentSubject, Role, User
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


@dataclass
class ContentSubjectRow:
    id: int
    subject_name: str
    subject_description: str | None
    is_active: bool
    is_deleted: bool
    created_at: str | None
    updated_at: str | None


@guarded_service("admin.list_content_subjects")
def list_content_subjects(include_deleted: bool = False) -> list[ContentSubjectRow]:
    if engine() is None:
        return []
    with session_scope() as session:
        q = select(ContentSubject)
        if not include_deleted:
            q = q.where(ContentSubject.is_deleted.is_(False))
        rows = session.execute(q.order_by(ContentSubject.id.desc())).scalars().all()
        out: list[ContentSubjectRow] = []
        for r in rows:
            out.append(
                ContentSubjectRow(
                    id=int(r.id),
                    subject_name=r.subject_name,
                    subject_description=r.subject_description,
                    is_active=bool(r.is_active),
                    is_deleted=bool(r.is_deleted),
                    created_at=r.created_at.isoformat() if r.created_at else None,
                    updated_at=r.updated_at.isoformat() if r.updated_at else None,
                )
            )
        return out


@guarded_service("admin.add_content_subject")
def add_content_subject(
    subject_name: str,
    subject_description: str | None,
    is_active: bool,
    actor_user_id: int | None,
) -> ContentSubjectRow:
    if engine() is None:
        raise RuntimeError("Database not configured")
    name = subject_name.strip()
    if not name:
        raise ValueError("subject_name is required")
    with session_scope() as session:
        existing_name = session.execute(
            select(ContentSubject).where(
                ContentSubject.subject_name == name,
                ContentSubject.is_deleted.is_(False),
            )
        ).scalar_one_or_none()
        if existing_name is not None:
            raise ValueError("Subject already exists")

        # Explicit single-active check while adding.
        if is_active:
            active_existing = session.execute(
                select(ContentSubject).where(
                    ContentSubject.is_active.is_(True),
                    ContentSubject.is_deleted.is_(False),
                )
            ).scalar_one_or_none()
            if active_existing is not None:
                raise ValueError(
                    f"Active subject already exists: '{active_existing.subject_name}'. "
                    "Soft-delete/deactivate it before adding another active subject."
                )

        row = ContentSubject(
            subject_name=name,
            subject_description=subject_description.strip() if subject_description else None,
            is_active=bool(is_active),
            is_deleted=False,
            created_by=actor_user_id,
            updated_by=actor_user_id,
        )
        session.add(row)
        session.flush()
        return ContentSubjectRow(
            id=int(row.id),
            subject_name=row.subject_name,
            subject_description=row.subject_description,
            is_active=bool(row.is_active),
            is_deleted=bool(row.is_deleted),
            created_at=row.created_at.isoformat() if row.created_at else None,
            updated_at=row.updated_at.isoformat() if row.updated_at else None,
        )


@guarded_service("admin.soft_delete_content_subject")
def soft_delete_content_subject(subject_id: int, actor_user_id: int | None) -> None:
    if engine() is None:
        raise RuntimeError("Database not configured")
    with session_scope() as session:
        row = session.get(ContentSubject, subject_id)
        if row is None or bool(row.is_deleted):
            raise ValueError("Subject not found")
        row.is_deleted = True
        row.is_active = False
        row.updated_by = actor_user_id
        session.flush()


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
