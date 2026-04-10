"""Entry evaluation pipeline (batched submit + async evaluation)."""

from __future__ import annotations

from fastapi import APIRouter

from app.schemas.content_eval import EvaluateRequest, SubmitRequest
from app.services.content_resolver.endpoint_service import (
    get_evaluation_result,
    get_evaluation_status,
    get_submission_status,
    submit_entries_for_evaluation,
    submit_single_entry,
)

router = APIRouter(prefix="/entry-evaluation", tags=["entry-evaluation"])


@router.post("/evaluate")
def evaluate(payload: EvaluateRequest):
    entries = [
        {"user_id": payload.user_id, "attempt_id": e.attempt_id, "entry": e.entry}
        for e in payload.entries
    ]
    return submit_entries_for_evaluation(entries)


@router.post("/submit")
def submit(payload: SubmitRequest):
    return submit_single_entry(
        {"user_id": payload.user_id, "attempt_id": payload.attempt_id, "entry": payload.entry}
    )


@router.get("/submit/{submission_id}")
def submit_status(submission_id: str):
    return get_submission_status(submission_id)


@router.get("/evaluate/{job_id}/result")
def evaluation_result(job_id: str):
    return get_evaluation_result(job_id)


@router.get("/evaluate/{job_id}")
def evaluation_status(job_id: str):
    return get_evaluation_status(job_id)
