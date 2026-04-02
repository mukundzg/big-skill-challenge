"""Auth endpoints for code request and verification."""

from fastapi import APIRouter

from app.schemas.auth import RequestCodeBody, VerifyBody
from app.services.email_service import (
    log_bypass_code,
    send_email,
    verification_email_bypass_enabled,
)
from app.services.verification_service import (
    generate_code,
    normalize_email,
    store_code,
    verify_or_raise,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/request-code")
def request_code(body: RequestCodeBody):
    print(f"Requesting code for {body.email}")
    email = normalize_email(body.email)
    code = generate_code()
    store_code(email, code)

    if verification_email_bypass_enabled():
        log_bypass_code(email, code)
    else:
        send_email(
            email,
            "Your verification code",
            f"Your code is: {code}\n\nIt expires in 15 minutes.",
        )
    return {"ok": True}


@router.post("/verify")
def verify(body: VerifyBody):
    email = normalize_email(body.email)
    verify_or_raise(email, body.code)
    return {"ok": True}
