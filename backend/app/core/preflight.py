"""
Pre-startup checks: run from FastAPI lifespan startup (see app.main) so importing
`app.main` does not block on network/DB. The server only accepts traffic after
checks pass (unless SKIP_PREFLIGHT_CHECKS is set).

Add new checks by implementing a function that returns PreflightResult and
appending it to PREFLIGHT_CHECKS.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Callable
from dataclasses import dataclass

from app.core.app_logger import log_error, log_info
from app.db import is_database_configured, test_database_connection


@dataclass(frozen=True)
class PreflightResult:
    """Outcome of a single check."""

    name: str
    ok: bool
    detail: str | None = None


def preflight_checks_disabled() -> bool:
    """Skip all preflight checks (local dev only; do not use in production)."""
    raw = os.environ.get("SKIP_PREFLIGHT_CHECKS", "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def check_database() -> PreflightResult:
    """Ensure MySQL env is set and a connection + SELECT 1 succeeds."""
    if not is_database_configured():
        return PreflightResult(
            name="database",
            ok=False,
            detail="Not configured: set DATABASE_URL or MYSQL_HOST + MYSQL_DB (and MYSQL_USER / MYSQL_PASSWORD if needed) in backend/.env",
        )
    ok, err = test_database_connection()
    if ok:
        return PreflightResult(name="database", ok=True, detail=None)
    return PreflightResult(
        name="database",
        ok=False,
        detail=err or "Connection failed",
    )


def skip_gemini_preflight() -> bool:
    """Skip Gemini readiness when you only need auth/DB locally without a key."""
    raw = os.environ.get("SKIP_GEMINI_PREFLIGHT", "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def check_gemini() -> PreflightResult:
    """Ensure GEM_KEY works and QUIZ_GEMINI_MODEL accepts a minimal request."""
    if skip_gemini_preflight():
        return PreflightResult(
            name="gemini",
            ok=True,
            detail="skipped (SKIP_GEMINI_PREFLIGHT)",
        )
    from app.services.quiz_gemini import verify_gemini_service_ready

    ok, err = verify_gemini_service_ready()
    if ok:
        return PreflightResult(name="gemini", ok=True, detail=None)
    return PreflightResult(name="gemini", ok=False, detail=err or "Gemini check failed")


# Future examples (uncomment and implement when needed):
# def check_redis() -> PreflightResult: ...
# def check_object_storage() -> PreflightResult: ...

PREFLIGHT_CHECKS: tuple[Callable[[], PreflightResult], ...] = (
    check_database,
    check_gemini,
)


def run_preflight() -> list[PreflightResult]:
    """Run all registered checks in order."""
    return [fn() for fn in PREFLIGHT_CHECKS]


def assert_preflight_passes() -> None:
    """
    Run preflight checks. If any fail: log errors (already emitted per check + summary), then
    terminate the process with exit code 1.
    If SKIP_PREFLIGHT_CHECKS is set, returns without checking.
    """
    if preflight_checks_disabled():
        print(
            "\n[preflight] SKIP_PREFLIGHT_CHECKS is enabled — startup checks were skipped.\n",
            flush=True,
        )
        return

    results = run_preflight()
    for r in results:
        line = f"[preflight] {r.name}: {'OK' if r.ok else 'FAIL'}"
        if r.detail:
            line += f" — {r.detail}"
        print(line, flush=True)
        if not r.ok:
            log_error(
                "Preflight check failed — fix configuration or set SKIP_* flags for local dev",
                check=r.name,
                detail=r.detail or "(no detail)",
            )

    failed = [r for r in results if not r.ok]
    if not failed:
        print("[preflight] All checks passed.\n", flush=True)
        log_info("Preflight: all checks passed")
        return

    parts = [f"{r.name}: {r.detail}" for r in failed]
    summary = "; ".join(parts)
    log_error(
        "Startup aborted: preflight failed (see prior log lines per check)",
        summary=summary,
    )
    sys.exit(1)
