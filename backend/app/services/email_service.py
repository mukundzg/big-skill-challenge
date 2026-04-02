"""Email delivery logic for verification flows."""

from __future__ import annotations

import os
import smtplib
from email.mime.text import MIMEText

from mailjet_rest import Client


def verification_email_bypass_enabled() -> bool:
    raw = os.environ.get("VERIFICATION_EMAIL_BYPASS", "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def log_bypass_code(email: str, code: str) -> None:
    print(
        f"\n[VERIFICATION EMAIL BYPASS] email={email} code={code}\n",
        flush=True,
    )


def send_email(to_addr: str, subject: str, body: str) -> None:
    provider = os.environ.get("SMTP_PROVIDER", "").strip().lower()
    print(f"Sending email with provider {provider}")
    if provider == "mailjet":
        _send_email_mailjet(to_addr, subject, body)
        return

    host = os.environ.get("SMTP_HOST")
    if not host and provider == "inbox":
        host = "smtp.inbox.com"
    if not host:
        print(f"[dev] verification code for {to_addr}: {body.strip()}")
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


def _send_email_mailjet(to_addr: str, subject: str, body: str) -> None:
    print(f"Sending email to {to_addr} with subject {subject} and body {body}")
    api_key = os.environ.get("MJ_APIKEY_PUBLIC", "").strip()
    api_secret = os.environ.get("MJ_APIKEY_PRIVATE", "").strip()
    from_email = os.environ.get("MJ_FROM_EMAIL", "").strip()
    from_name = os.environ.get("MJ_FROM_NAME", "Verification").strip()

    if not api_key or not api_secret or not from_email:
        raise RuntimeError(
            "Mailjet requires MJ_APIKEY_PUBLIC, MJ_APIKEY_PRIVATE, and MJ_FROM_EMAIL"
        )

    mailjet = Client(auth=(api_key, api_secret), version="v3.1")
    data = {
        "Messages": [
            {
                "From": {
                    "Email": from_email,
                    "Name": from_name,
                },
                "To": [
                    {
                        "Email": to_addr,
                        "Name": to_addr,
                    }
                ],
                "Subject": subject,
                "TextPart": body,
                "HTMLPart": f"<p>{body.replace(chr(10), '<br/>')}</p>",
            }
        ]
    }
    result = mailjet.send.create(data=data)
    if result.status_code >= 400:
        raise RuntimeError(f"Mailjet send failed: {result.status_code} {result.json()}")
    _validate_mailjet_response(result.json(), to_addr)


def _validate_mailjet_response(payload: object, expected_to_email: str) -> None:
    if not isinstance(payload, dict):
        raise RuntimeError("Mailjet response is not a JSON object")

    messages = payload.get("Messages")
    if not isinstance(messages, list) or not messages:
        raise RuntimeError("Mailjet response missing non-empty 'Messages' list")

    first = messages[0]
    if not isinstance(first, dict):
        raise RuntimeError("Mailjet response 'Messages[0]' is not an object")

    status = str(first.get("Status", "")).strip().lower()
    if status != "success":
        errors = first.get("Errors")
        if errors:
            raise RuntimeError(f"Mailjet send failed with errors: {errors}")
        raise RuntimeError(f"Mailjet send failed with status='{first.get('Status')}'")

    to_items = first.get("To")
    if not isinstance(to_items, list) or not to_items:
        raise RuntimeError("Mailjet response missing non-empty 'To' list")

    expected_lower = expected_to_email.strip().lower()
    matched_item = None
    for item in to_items:
        if not isinstance(item, dict):
            continue
        email = str(item.get("Email", "")).strip().lower()
        if email == expected_lower:
            matched_item = item
            break

    if not matched_item:
        raise RuntimeError(
            "Mailjet response does not include expected recipient in 'To' list"
        )

    missing_fields = [
        field
        for field in ("MessageID", "MessageUUID", "MessageHref")
        if not matched_item.get(field)
    ]
    if missing_fields:
        raise RuntimeError(
            f"Mailjet response for recipient missing fields: {', '.join(missing_fields)}"
        )
