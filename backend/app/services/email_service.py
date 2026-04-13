"""Email delivery logic for verification flows (SMTP only)."""

from __future__ import annotations

import os
import smtplib
from email.mime.text import MIMEText

from app.core.app_logger import log_error, log_info


def verification_email_bypass_enabled() -> bool:
    raw = os.environ.get("VERIFICATION_EMAIL_BYPASS", "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def log_bypass_code(email: str, code: str) -> None:
    log_info("Verification email bypass enabled; code issued (dev mode)", email=email)
    print(
        f"\n[VERIFICATION EMAIL BYPASS] email={email} code={code}\n",
        flush=True,
    )


def send_email(to_addr: str, subject: str, body: str) -> None:
    provider = os.environ.get("SMTP_PROVIDER", "").strip().lower()
    try:
        host = os.environ.get("SMTP_HOST")
        if not host:
            if provider == "inbox":
                host = "smtp.inbox.com"
            elif provider == "gmail":
                host = "smtp.gmail.com"
        if not host:
            print(f"[dev] verification code for {to_addr}: {body.strip()}")
            log_info("Verification email skipped (no SMTP host); code printed to console", email=to_addr)
            return

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
            raise RuntimeError("SMTP_SECURITY must be one of: starttls, ssl, none")

        smtp_client = smtplib.SMTP_SSL(host, port) if security == "ssl" else smtplib.SMTP(host, port)
        with smtp_client as smtp:
            if security == "starttls":
                smtp.starttls()
            if user and password:
                smtp.login(user, password)
            smtp.sendmail(from_addr, [to_addr], msg.as_string())
        log_info("Verification email sent (SMTP)", email=to_addr, host=host, subject=subject)
    except Exception as e:
        log_error(
            "Failed to send verification email",
            exc=e,
            email=to_addr,
            subject=subject,
            provider=provider or "smtp",
        )
        raise
