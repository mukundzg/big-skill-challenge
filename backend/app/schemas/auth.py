"""Pydantic schemas for auth endpoints."""

from pydantic import BaseModel, EmailStr


class RequestCodeBody(BaseModel):
    email: EmailStr


class VerifyBody(BaseModel):
    email: EmailStr
    code: str
