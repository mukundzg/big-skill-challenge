"""API for email verification codes. Set SMTP_* env vars to send real mail; otherwise the code is printed to the server console."""

from __future__ import annotations

import os
import secrets
import smtplib
import string
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr

_BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(_BACKEND_DIR / ".env")
# Also honors the process environment (Docker, systemd, shell exports, etc.).

CODE_ALPHABET = string.ascii_uppercase + string.digits
CODE_LEN = 7
CODE_TTL = timedelta(minutes=15)


def verification_email_bypass_enabled() -> bool:
    """Controlled only by env (same behavior in every environment).

    Set ``VERIFICATION_EMAIL_BYPASS`` to a truthy value (``1``, ``true``, ``yes``,
    ``on``) to log the code in the server terminal and skip SMTP. Any other
    value or unset → normal delivery (SMTP if ``SMTP_HOST`` is set, else the
    existing ``[dev] verification code...`` console line).
    """
    raw = os.environ.get("VERIFICATION_EMAIL_BYPASS", "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def _log_bypass_code(email: str, code: str) -> None:
    print(
        f"\n[VERIFICATION EMAIL BYPASS] email={email} code={code}\n",
        flush=True,
    )

# email (lowercase) -> (code, expires_at_utc)
_codes: dict[str, tuple[str, datetime]] = {}

app = FastAPI(title="demo-proj auth")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _generate_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LEN))


def _send_email(to_addr: str, subject: str, body: str) -> None:
    provider = os.environ.get("SMTP_PROVIDER", "").strip().lower()
    host = os.environ.get("SMTP_HOST")
    if not host and provider == "inbox":
        # Inbox.com preset; can still be overridden by SMTP_HOST/SMTP_PORT.
        host = "smtp.inbox.com"
    if not host:
        print(f"[dev] verification code for {to_addr}: {body.strip()}")
        return

    if provider == "inbox":
        default_port = "587"
        default_security = "starttls"
    else:
        default_port = "587"
        default_security = "starttls"

    port = int(os.environ.get("SMTP_PORT", default_port))
    security = os.environ.get("SMTP_SECURITY", default_security).strip().lower()
    user = os.environ.get("SMTP_USER", "")
    password = os.environ.get("SMTP_PASSWORD", "")
    from_addr = os.environ.get("SMTP_FROM", user)

    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_addr

    if security not in {"starttls", "ssl", "none"}:
        raise RuntimeError(
            "SMTP_SECURITY must be one of: starttls, ssl, none"
        )

    if security == "ssl":
        smtp_client = smtplib.SMTP_SSL(host, port)
    else:
        smtp_client = smtplib.SMTP(host, port)

    with smtp_client as smtp:
        if security == "starttls":
            smtp.starttls()
        if user and password:
            smtp.login(user, password)
        smtp.sendmail(from_addr, [to_addr], msg.as_string())


class RequestCodeBody(BaseModel):
    email: EmailStr


class VerifyBody(BaseModel):
    email: EmailStr
    code: str


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/auth/request-code")
def request_code(body: RequestCodeBody):
    email = body.email.lower().strip()
    code = _generate_code()
    _codes[email] = (code, _now() + CODE_TTL)
    if verification_email_bypass_enabled():
        _log_bypass_code(email, code)
    else:
        _send_email(
            email,
            "Your verification code",
            f"Your code is: {code}\n\nIt expires in 15 minutes.",
        )
    return {"ok": True}


@app.post("/auth/verify")
def verify(body: VerifyBody):
    email = body.email.lower().strip()
    raw = body.code.strip().upper().replace(" ", "")
    if len(raw) != CODE_LEN or any(c not in CODE_ALPHABET for c in raw):
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
        return {"ok": True}

    raise HTTPException(status_code=400, detail="Incorrect code")
