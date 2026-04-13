"""Request/response models for entry evaluation (content resolver) API."""

from __future__ import annotations

from typing import List

from pydantic import BaseModel, Field


class EvaluateEntryRequest(BaseModel):
    attempt_id: int
    entry: str


class EvaluateRequest(BaseModel):
    user_id: int
    entries: List[EvaluateEntryRequest] = Field(default_factory=list)


class SubmitRequest(BaseModel):
    user_id: int
    attempt_id: int
    entry: str
