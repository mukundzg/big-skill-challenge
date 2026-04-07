"""Pydantic schemas for auth endpoints."""

from pydantic import BaseModel, EmailStr, Field


class RequestCodeBody(BaseModel):
    email: EmailStr


class VerifyBody(BaseModel):
    email: EmailStr
    code: str


class VerifyResponse(BaseModel):
    ok: bool = True
    user_id: int | None = None
    email: str | None = None
    is_verified: bool = True
    is_active: bool = True
    next_screen: str = Field(
        ...,
        description='Client navigation hint: "home" when is_active, else "inactive".',
    )
    has_consent: bool | None = Field(
        default=None,
        description="True if app consent is already stored for this user (skip consent UI).",
    )


class LogoutBody(BaseModel):
    email: EmailStr


class LogoutResponse(BaseModel):
    ok: bool = True
    user_id: int | None = None
    email: str | None = None
    is_active: bool = False
    message: str | None = Field(
        default=None,
        description="When DB is not configured, logout is a no-op for persistence.",
    )


class ConsentBody(BaseModel):
    email: EmailStr


class ConsentResponse(BaseModel):
    ok: bool = True
    message: str | None = None


class ConsentStatusBody(BaseModel):
    email: EmailStr


class ConsentStatusResponse(BaseModel):
    has_consent: bool
