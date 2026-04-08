"""Verification code generation and validation actions."""

from __future__ import annotations

import secrets
import string
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from app.core.app_logger import log_warn
from app.core.service_guard import guarded_service

CODE_ALPHABET = string.ascii_uppercase + string.digits
CODE_LEN = 7
CODE_TTL = timedelta(minutes=15)

# email (lowercase) -> (code, expires_at_utc)
_codes: dict[str, tuple[str, datetime]] = {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


@guarded_service("verification.generate_code")
def generate_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LEN))


@guarded_service("verification.store_code")
def store_code(email: str, code: str) -> None:
    _codes[email] = (code, _now() + CODE_TTL)


@guarded_service("verification.normalize_email")
def normalize_email(email: str) -> str:
    return email.lower().strip()


@guarded_service("verification.normalize_code")
def normalize_code(code: str) -> str:
    return code.strip().upper().replace(" ", "")


@guarded_service("verification.verify_or_raise")
def verify_or_raise(email: str, submitted_code: str) -> bool:
    raw = normalize_code(submitted_code)
    if len(raw) != CODE_LEN or any(ch not in CODE_ALPHABET for ch in raw):
        log_warn("Email verification rejected: invalid code format", email=email)
        raise HTTPException(status_code=400, detail="Invalid code format")

    entry = _codes.get(email)
    if not entry:
        log_warn("Email verification rejected: no pending code for email", email=email)
        raise HTTPException(status_code=400, detail="No code for this email. Request a new one.")

    stored, expires_at = entry
    if _now() > expires_at:
        del _codes[email]
        log_warn("Email verification rejected: code expired", email=email)
        raise HTTPException(status_code=400, detail="Code expired. Request a new one.")

    if secrets.compare_digest(stored, raw):
        del _codes[email]
        return True

    log_warn("Email verification rejected: incorrect code", email=email)
    raise HTTPException(status_code=400, detail="Incorrect code")
