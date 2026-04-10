"""Database engine/session helpers (sync SQLAlchemy) with MySQL connection pool."""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Callable, Iterator, TypeVar

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.app_logger import log_error

T = TypeVar("T")


def _database_url() -> str | None:
    # Preferred single-setting configuration:
    #   mysql+pymysql://user:pass@host:3306/dbname?charset=utf8mb4
    url = os.environ.get("DATABASE_URL", "").strip()
    if url:
        return url

    # Optional component-style configuration.
    host = os.environ.get("MYSQL_HOST", "").strip()
    db = os.environ.get("MYSQL_DB", "").strip()
    user = os.environ.get("MYSQL_USER", "").strip()
    password = os.environ.get("MYSQL_PASSWORD", "").strip()
    port = os.environ.get("MYSQL_PORT", "").strip() or "3306"

    if not host or not db:
        return None

    auth = ""
    if user:
        auth = user
        if password:
            auth += f":{password}"
        auth += "@"

    return f"mysql+pymysql://{auth}{host}:{port}/{db}?charset=utf8mb4"


def is_database_configured() -> bool:
    """True if DATABASE_URL or MYSQL_HOST+MYSQL_DB (etc.) is set — not a live connection test."""
    return _database_url() is not None


def database_required() -> bool:
    """When true, auth routes that persist users must have a configured database."""
    raw = os.environ.get("DATABASE_REQUIRED", "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def test_database_connection() -> tuple[bool, str | None]:
    """Try SELECT 1. Returns (ok, error_message)."""
    init_engine()
    eng = _ENGINE
    if eng is None:
        return False, "No DATABASE_URL or MYSQL_HOST/MYSQL_DB in environment"
    try:
        with eng.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True, None
    except Exception as e:
        return False, str(e)


def _pool_kwargs() -> dict:
    return {
        "pool_pre_ping": True,
        "pool_size": int(os.environ.get("MYSQL_POOL_SIZE", "5")),
        "max_overflow": int(os.environ.get("MYSQL_MAX_OVERFLOW", "10")),
        "pool_recycle": int(os.environ.get("MYSQL_POOL_RECYCLE", "3600")),
    }


_ENGINE = None
_SessionLocal = None


def _assert_required_tables() -> None:
    eng = _ENGINE
    if eng is None:
        return
    required_tables = ("score_review_history", "audit_logs_adjudiction")
    try:
        with eng.connect() as conn:
            db_name = conn.execute(text("SELECT DATABASE()")).scalar()
            if not db_name:
                raise RuntimeError("No active database selected")
            for table_name in required_tables:
                exists = conn.execute(
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
                    raise RuntimeError(
                        f"Required table '{table_name}' is missing. "
                        "Create required tables via migrations before startup."
                    )
    except Exception as e:
        log_error("Required DB table validation failed", exc=e)
        raise


def init_engine() -> None:
    global _ENGINE, _SessionLocal

    if _ENGINE is not None and _SessionLocal is not None:
        return

    url = _database_url()
    if not url:
        return

    try:
        _ENGINE = create_engine(url, **_pool_kwargs())
        _SessionLocal = sessionmaker(bind=_ENGINE, autoflush=False, autocommit=False)
        _assert_required_tables()
    except Exception as e:
        log_error("Database engine initialization failed", exc=e)
        _ENGINE = None
        _SessionLocal = None
        raise


def engine():
    init_engine()
    return _ENGINE


@contextmanager
def session_scope() -> Iterator[Session]:
    init_engine()
    if _SessionLocal is None:
        raise RuntimeError(
            "Database is not configured. Set DATABASE_URL or MYSQL_HOST/MYSQL_DB (and optionally MYSQL_USER/MYSQL_PASSWORD)."
        )

    session: Session = _SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def run_in_transaction(work: Callable[[Session], T], *, operation: str = "db_operation") -> T:
    """
    Generic transactional wrapper for service-layer DB writes/reads.
    Commits on success, rolls back automatically on error via session_scope().
    """
    try:
        with session_scope() as session:
            return work(session)
    except Exception as e:
        log_error("Database transaction failed", exc=e, operation=operation)
        raise
