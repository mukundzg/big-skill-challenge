"""Auth endpoints for code request and verification."""

from fastapi import APIRouter, HTTPException, Request

from app.audit import AuditAction, record, request_context
from app.db import database_required, is_database_configured
from app.schemas.auth import (
    ConsentBody,
    ConsentResponse,
    ConsentStatusBody,
    ConsentStatusResponse,
    LogoutBody,
    LogoutResponse,
    RequestCodeBody,
    VerifyBody,
    VerifyResponse,
)
from app.services.email_service import (
    log_bypass_code,
    send_email,
    verification_email_bypass_enabled,
)
from app.services.user_service import (
    get_consent_status,
    logout_user,
    record_user_consent,
    upsert_verified_user,
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


@router.post("/verify", response_model=VerifyResponse)
def verify(body: VerifyBody, request: Request):
    email = normalize_email(body.email)
    verify_or_raise(email, body.code)
    if database_required() and not is_database_configured():
        raise HTTPException(
            status_code=503,
            detail="Database is required but not configured. Set DATABASE_URL or MYSQL_HOST/MYSQL_DB in backend/.env",
        )
    result = upsert_verified_user(email)
    if result is None:
        return VerifyResponse(
            ok=True,
            user_id=None,
            email=email,
            is_verified=True,
            is_active=True,
            next_screen="home",
            has_consent=None,
        )
    meta = request_context(request)
    meta.update(
        {
            "email": result.email,
            "next_screen": result.next_screen,
            "is_new_user": result.is_new_user,
        }
    )
    record(AuditAction.LOGIN, user_id=result.user_id, metadata=meta)
    return VerifyResponse(
        ok=True,
        user_id=result.user_id,
        email=result.email,
        is_verified=result.is_verified,
        is_active=result.is_active,
        next_screen=result.next_screen,
        has_consent=result.has_consent,
    )


@router.post("/logout", response_model=LogoutResponse)
def logout(body: LogoutBody, request: Request):
    email = normalize_email(body.email)
    outcome = logout_user(email)
    if outcome.no_database:
        return LogoutResponse(
            ok=True,
            user_id=None,
            email=email,
            is_active=False,
            message="Database not configured; is_active not updated server-side.",
        )
    if outcome.not_found:
        raise HTTPException(status_code=404, detail="User not found")
    meta = request_context(request)
    meta["email"] = email
    record(AuditAction.LOGOUT, user_id=outcome.user_id, metadata=meta)
    return LogoutResponse(
        ok=True,
        user_id=outcome.user_id,
        email=outcome.email,
        is_active=outcome.is_active,
    )


@router.post("/consent-status", response_model=ConsentStatusResponse)
def consent_status(body: ConsentStatusBody):
    email = normalize_email(body.email)
    status = get_consent_status(email)
    if status is None:
        return ConsentStatusResponse(has_consent=False)
    return ConsentStatusResponse(has_consent=status)


@router.post("/consent", response_model=ConsentResponse)
def record_consent(body: ConsentBody, request: Request):
    email = normalize_email(body.email)
    outcome = record_user_consent(email)
    if outcome.no_database:
        return ConsentResponse(ok=False, message="Database not configured")
    if outcome.not_found:
        raise HTTPException(status_code=404, detail="User not found")
    if outcome.inactive:
        raise HTTPException(status_code=403, detail="Account inactive")
    if not outcome.already_recorded and outcome.user_id is not None:
        meta = request_context(request)
        meta["email"] = outcome.email or email
        record(AuditAction.CONSENT_ACCEPTED, user_id=outcome.user_id, metadata=meta)
    return ConsentResponse(ok=True)
