"""User persistence actions."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.service_guard import guarded_service
from app.db import engine, session_scope
from app.models import User


@guarded_service("user.get_user_by_email")
def get_user_by_email(email: str, *, include_deleted: bool = False) -> User | None:
    if engine() is None:
        return None
    with session_scope() as session:
        q = select(User).where(User.email == email)
        if not include_deleted:
            q = q.where(User.is_deleted.is_(False))
        user = session.execute(q).scalar_one_or_none()
        if user is None:
            return None
        # Detach before commit() in session_scope — otherwise instances expire and
        # accessing attributes after return raises DetachedInstanceError.
        session.expunge(user)
        return user


@dataclass(frozen=True)
class VerifiedUserResult:
    user_id: int
    email: str
    is_verified: bool
    is_active: bool
    next_screen: str
    is_new_user: bool
    has_consent: bool


@dataclass(frozen=True)
class LogoutOutcome:
    """Result of logout: distinguish no DB, missing user, or success."""

    no_database: bool = False
    not_found: bool = False
    user_id: int | None = None
    email: str | None = None
    is_active: bool = False


@dataclass(frozen=True)
class ConsentOutcome:
    """Recording app consent on the user row."""

    ok: bool = False
    no_database: bool = False
    not_found: bool = False
    inactive: bool = False
    user_id: int | None = None
    email: str | None = None
    already_recorded: bool = False


def _next_screen(is_active: bool) -> str:
    # Client: route to home when account is active; otherwise show a non-home flow.
    return "home" if is_active else "inactive"


@guarded_service("user.upsert_verified_user")
def upsert_verified_user(email: str) -> VerifiedUserResult | None:
    """Insert or update user after successful email verification (login)."""
    if engine() is None:
        return None

    with session_scope() as session:
        existing = session.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if existing is not None and getattr(existing, "is_deleted", False):
            has_consent = existing.consent_accepted_at is not None
            return VerifiedUserResult(
                user_id=int(existing.id),
                email=existing.email,
                is_verified=bool(existing.is_verified),
                is_active=False,
                next_screen=_next_screen(False),
                is_new_user=False,
                has_consent=has_consent,
            )
        is_new_user = existing is None
        if existing is None:
            user = User(
                email=email,
                is_verified=True,
                is_active=True,
            )
            session.add(user)
            session.flush()
        else:
            existing.is_verified = True
            existing.is_active = True
            user = existing
            session.flush()

        has_consent = user.consent_accepted_at is not None

        return VerifiedUserResult(
            user_id=int(user.id),
            email=user.email,
            is_verified=bool(user.is_verified),
            is_active=bool(user.is_active),
            next_screen=_next_screen(bool(user.is_active)),
            is_new_user=is_new_user,
            has_consent=has_consent,
        )


@guarded_service("user.logout_user")
def logout_user(email: str) -> LogoutOutcome:
    """Mark user as logged out: sets is_active to False (logged-in flag)."""
    if engine() is None:
        return LogoutOutcome(no_database=True)

    with session_scope() as session:
        user = session.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if user is None:
            return LogoutOutcome(not_found=True)

        user.is_active = False
        session.flush()

        return LogoutOutcome(
            user_id=int(user.id),
            email=user.email,
            is_active=bool(user.is_active),
        )


@guarded_service("user.get_consent_status")
def get_consent_status(email: str) -> bool | None:
    """None if DB unavailable; True/False if user has recorded consent."""
    if engine() is None:
        return None
    with session_scope() as session:
        user = session.execute(
            select(User).where(User.email == email, User.is_deleted.is_(False))
        ).scalar_one_or_none()
        if user is None:
            return False
        return user.consent_accepted_at is not None


@guarded_service("user.record_user_consent")
def record_user_consent(email: str) -> ConsentOutcome:
    """Set consent_accepted_at if not already set. User must exist and be active."""
    if engine() is None:
        return ConsentOutcome(no_database=True)

    with session_scope() as session:
        user = session.execute(
            select(User).where(User.email == email, User.is_deleted.is_(False))
        ).scalar_one_or_none()
        if user is None:
            return ConsentOutcome(not_found=True)
        if not user.is_active:
            return ConsentOutcome(inactive=True)
        if user.consent_accepted_at is not None:
            return ConsentOutcome(
                ok=True,
                user_id=int(user.id),
                email=user.email,
                already_recorded=True,
            )
        user.consent_accepted_at = datetime.now(timezone.utc).replace(tzinfo=None)
        session.flush()
        return ConsentOutcome(
            ok=True,
            user_id=int(user.id),
            email=user.email,
            already_recorded=False,
        )
