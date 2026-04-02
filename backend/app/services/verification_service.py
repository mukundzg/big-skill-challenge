"""Verification code generation and validation actions."""

from __future__ import annotations

import secrets
import string
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

CODE_ALPHABET = string.ascii_uppercase + string.digits
CODE_LEN = 7
CODE_TTL = timedelta(minutes=15)

# email (lowercase) -> (code, expires_at_utc)
_codes: dict[str, tuple[str, datetime]] = {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def generate_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LEN))


def store_code(email: str, code: str) -> None:
    _codes[email] = (code, _now() + CODE_TTL)


def normalize_email(email: str) -> str:
    return email.lower().strip()


def normalize_code(code: str) -> str:
    return code.strip().upper().replace(" ", "")


def verify_or_raise(email: str, submitted_code: str) -> bool:
    raw = normalize_code(submitted_code)
    if len(raw) != CODE_LEN or any(ch not in CODE_ALPHABET for ch in raw):
        raise HTTPException(status_code=400, detail="Invalid code format")

    entry = _codes.get(email)
    if not entry:
        raise HTTPException(status_code=400, detail="No code for this email. Request a new one.")

    stored, expires_at = entry
    if _now() > expires_at:
        del _codes[email]
        raise HTTPException(status_code=400, detail="Code expired. Request a new one.")

    if secrets.compare_digest(stored, raw):
        del _codes[email]
        return True

    raise HTTPException(status_code=400, detail="Incorrect code")
