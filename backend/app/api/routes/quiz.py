"""Quiz dashboard and attempt flows."""

from fastapi import APIRouter, HTTPException, Request

from app.audit import AuditAction, record, request_context
from app.schemas.quiz import (
    EmailBody,
    QuizAnswerBody,
    QuizAnswerResponse,
    QuizDashboardResponse,
    QuizEntriesResponse,
    QuizEntryRow,
    QuizShortlistResultResponse,
    QuizQuestionBody,
    QuizResumeResponse,
    QuizStartResponse,
    QuizTimeoutBody,
    QuizTimeoutResponse,
)
from app.services.quiz_service import (
    get_dashboard_stats,
    get_question_for_attempt,
    get_user_shortlist_result,
    list_user_entries,
    get_settings,
    get_resumable_attempt,
    record_payment_success,
    start_attempt,
    submit_answer,
    timeout_attempt,
)
from app.services.user_service import get_user_by_email
from app.services.verification_service import normalize_email

router = APIRouter(prefix="/quiz", tags=["quiz"])


def _user_id_or_404(email: str) -> int:
    email = normalize_email(email)
    user = get_user_by_email(email)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if getattr(user, "is_deleted", False):
        raise HTTPException(status_code=403, detail="Account not available")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account inactive")
    return int(user.id)


@router.post("/dashboard", response_model=QuizDashboardResponse)
def quiz_dashboard(body: EmailBody):
    uid = _user_id_or_404(body.email)
    stats = get_dashboard_stats(uid)
    return QuizDashboardResponse(
        max_attempts=stats["max_attempts"],
        time_per_question_seconds=stats["time_per_question_seconds"],
        marks_per_question=stats["marks_per_question"],
        attempts_used=stats["attempts_used"],
        attempts_remaining=stats["attempts_remaining"],
        total_correct_answers=stats["total_correct_answers"],
        total_score=stats["total_score"],
        shortlisted=int(stats.get("shortlisted") or 0),
        contest_is_active=stats.get("contest_is_active", False),
        contest_season_end=stats.get("contest_season_end"),
        has_resumable_attempt=bool(stats.get("has_resumable_attempt") or False),
        resumable_attempt_id=stats.get("resumable_attempt_id"),
        resume_question_index=stats.get("resume_question_index"),
        resume_total_questions=stats.get("resume_total_questions"),
        resume_source_file_id=stats.get("resume_source_file_id"),
        resume_source_file_name=stats.get("resume_source_file_name"),
    )


@router.post("/my-entries", response_model=QuizEntriesResponse)
def quiz_my_entries(body: EmailBody):
    uid = _user_id_or_404(body.email)
    rows = list_user_entries(uid, limit=50)
    return QuizEntriesResponse(rows=[QuizEntryRow(**r) for r in rows])


@router.post("/shortlist-result", response_model=QuizShortlistResultResponse)
def quiz_shortlist_result(body: EmailBody):
    uid = _user_id_or_404(body.email)
    row = get_user_shortlist_result(uid)
    if row is None:
        raise HTTPException(status_code=404, detail="No shortlisted result available")
    return QuizShortlistResultResponse(**row)


@router.get("/settings")
def quiz_settings_public():
    return get_settings()


@router.post("/payment-success")
def quiz_payment_success(body: EmailBody, request: Request):
    uid = _user_id_or_404(body.email)
    ok = record_payment_success(uid)
    if not ok:
        raise HTTPException(status_code=400, detail="Cannot accept payment for an inactive contest")
    meta = request_context(request)
    meta["email"] = normalize_email(body.email)
    record(AuditAction.QUIZ_PAYMENT_SUCCESS, user_id=uid, metadata=meta)
    return {"ok": True}


@router.post("/start", response_model=QuizStartResponse)
def quiz_start(body: EmailBody, request: Request):
    uid = _user_id_or_404(body.email)
    result = start_attempt(uid)
    if not result.ok:
        raise HTTPException(status_code=400, detail=result.error or "Cannot start attempt")
    meta = request_context(request)
    meta["email"] = normalize_email(body.email)
    meta["attempt_id"] = result.attempt_id
    record(
        AuditAction.QUIZ_ATTEMPT_STARTED,
        user_id=uid,
        metadata=meta,
    )
    return QuizStartResponse(
        ok=True,
        attempt_id=result.attempt_id,
        attempt_number=result.attempt_number,
        total_questions=result.total_questions,
        first_question=result.first_question,
        time_per_question_seconds=result.time_seconds,
        marks_per_question=result.marks_per_question,
        source_file_id=result.source_file_id,
        source_file_name=result.source_file_name,
    )


@router.post("/question")
def quiz_question(body: QuizQuestionBody):
    uid = _user_id_or_404(body.email)
    q = get_question_for_attempt(body.attempt_id, uid, body.question_index)
    if q is None:
        raise HTTPException(status_code=404, detail="Question not available")
    settings = get_settings()
    return {**q, "time_per_question_seconds": settings["time_per_question_seconds"]}


@router.post("/answer", response_model=QuizAnswerResponse)
def quiz_answer(body: QuizAnswerBody, request: Request):
    uid = _user_id_or_404(body.email)
    out = submit_answer(body.attempt_id, uid, body.question_index, body.selected_option_index)
    if not out.get("ok"):
        raise HTTPException(status_code=400, detail=out.get("error", "Bad request"))
    if out.get("finished"):
        meta = request_context(request)
        meta["email"] = normalize_email(body.email)
        meta["attempt_id"] = body.attempt_id
        meta["score"] = out.get("score")
        meta["correct_answers"] = out.get("correct_answers")
        oc = out.get("outcome")
        if oc == "success":
            record(
                AuditAction.QUIZ_ATTEMPT_FINISHED,
                user_id=uid,
                metadata=meta,
            )
        elif oc == "wrong_exit":
            meta["question_index"] = body.question_index
            record(
                AuditAction.QUIZ_ATTEMPT_WRONG_EXIT,
                user_id=uid,
                metadata=meta,
            )
    return QuizAnswerResponse(
        ok=True,
        finished=bool(out.get("finished")),
        outcome=out.get("outcome"),
        correct_answers=out.get("correct_answers"),
        total_questions=out.get("total_questions"),
        score=out.get("score"),
        next_question=out.get("next_question"),
    )


@router.post("/timeout", response_model=QuizTimeoutResponse)
def quiz_timeout(body: QuizTimeoutBody, request: Request):
    uid = _user_id_or_404(body.email)
    out = timeout_attempt(body.attempt_id, uid)
    if not out.get("ok"):
        raise HTTPException(status_code=400, detail=out.get("error", "Bad request"))
    meta = request_context(request)
    meta["email"] = normalize_email(body.email)
    meta["attempt_id"] = body.attempt_id
    meta["score"] = out.get("score")
    meta["correct_answers"] = out.get("correct_answers")
    meta["outcome"] = "timeout"
    record(AuditAction.QUIZ_TIMEOUT, user_id=uid, metadata=meta)
    return QuizTimeoutResponse(
        ok=True,
        correct_answers=out.get("correct_answers"),
        total_questions=out.get("total_questions"),
        score=out.get("score"),
    )


@router.post("/resume", response_model=QuizResumeResponse)
def quiz_resume(body: EmailBody):
    uid = _user_id_or_404(body.email)
    out = get_resumable_attempt(uid)
    return QuizResumeResponse(
        ok=out.ok,
        has_resumable_attempt=out.has_resumable_attempt,
        attempt_id=out.attempt_id,
        attempt_number=out.attempt_number,
        total_questions=out.total_questions,
        current_question_index=out.current_question_index,
        current_question=out.current_question,
        time_per_question_seconds=out.time_seconds,
        marks_per_question=out.marks_per_question,
        source_file_id=out.source_file_id,
        source_file_name=out.source_file_name,
    )
