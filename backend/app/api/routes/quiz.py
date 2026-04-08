"""Quiz dashboard and attempt flows."""

from fastapi import APIRouter, HTTPException, Request

from app.audit import AuditAction, record, request_context
from app.schemas.quiz import (
    EmailBody,
    QuizAnswerBody,
    QuizAnswerResponse,
    QuizDashboardResponse,
    QuizQuestionBody,
    QuizStartResponse,
    QuizTimeoutBody,
    QuizTimeoutResponse,
)
from app.services.quiz_service import (
    get_dashboard_stats,
    get_question_for_attempt,
    get_settings,
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
    )


@router.get("/settings")
def quiz_settings_public():
    return get_settings()


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
