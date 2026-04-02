"""
Pre-startup checks: run before the ASGI app is created so the server only starts
when required dependencies are reachable.

Add new checks by implementing a function that returns PreflightResult and
appending it to PREFLIGHT_CHECKS.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass

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
    Run preflight checks and raise RuntimeError if any fail.
    If SKIP_PREFLIGHT_CHECKS is set, logs a warning and returns without checking.
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

    failed = [r for r in results if not r.ok]
    if not failed:
        print("[preflight] All checks passed.\n", flush=True)
        return

    parts = [f"{r.name}: {r.detail}" for r in failed]
    raise RuntimeError("Startup preflight failed: " + "; ".join(parts))
