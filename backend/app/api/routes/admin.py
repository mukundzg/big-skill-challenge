"""Admin console API (bootstrap, login, admin user management)."""

from __future__ import annotations

import os
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
# Multipart parts from `request.form()` are Starlette UploadFile; FastAPI's UploadFile is a different class.
from starlette.datastructures import UploadFile

from app.schemas.admin import (
    AdminEmailsBody,
    AdminListResponse,
    AdminLoginBody,
    AdminUserRow,
    AnalyticsAttemptsResponse,
    AnalyticsSummaryResponse,
    AttemptAnalyticsRow,
    BootstrapVerifyBody,
    ContestSettingCreateBody,
    ContestSettingRow,
    ContestSettingsResponse,
    ContestSettingSeasonBody,
    ContestSettingShortlistBody,
    ContentAnalysisScoresResponse,
    CreatedAdminCredentials,
    OkResponse,
    QuizSettingsResponse,
    QuizSettingsUpdateBody,
    QuestionBanksResponse,
    QuestionBankRow,
    QuestionBankConfirmGeminiResponse,
    QuestionBankUploadBatchResponse,
    QuestionBankUploadItemResult,
    RegisterAdminsResponse,
    ScoreDetailResponse,
    ScoreReviewHistoryResponse,
    ScoreReviewHistoryRow,
    ScoreReviewUpdateBody,
    ScoreReviewUpdateResponse,
    ScoreHighlightsResponse,
    ShortlistScoresResponse,
    SetupStatusResponse,
    ScoresSummary,
    TokenResponse,
    UserScoresResponse,
)
from app.core.app_logger import log_info
from app.services import admin_service
from app.services.content_analysis_service import (
    analytics_overview_scores,
    get_score_detail,
    get_score_review_history,
    list_scores,
    list_shortlisted_scores,
    list_score_highlights,
    list_user_scores_by_email,
    scores_summary,
    update_score_human_review,
)
from app.services.quiz_service import get_quiz_settings_admin, update_quiz_settings_row
from app.services.question_bank_service import (
    cancel_pending_question_bank,
    confirm_question_bank_gemini,
    list_question_banks,
    pending_question_bank_pdf_path,
    upload_question_bank,
)

router = APIRouter(prefix="/admin", tags=["admin"])
_bearer = HTTPBearer(auto_error=False)


def _auth_header(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> str:
    if creds is None or not creds.credentials:
        raise HTTPException(status_code=401, detail="Authorization required")
    return creds.credentials


@router.get("/setup-status", response_model=SetupStatusResponse)
def setup_status():
    return SetupStatusResponse(needs_bootstrap=admin_service.needs_bootstrap())


@router.post("/bootstrap/request-code")
def bootstrap_request_code():
    try:
        admin_service.request_bootstrap_code()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True}


@router.post("/bootstrap/verify", response_model=TokenResponse)
def bootstrap_verify(body: BootstrapVerifyBody):
    try:
        token = admin_service.verify_bootstrap_code(body.code.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return TokenResponse(access_token=token)


def _resolve_register_token(raw: str) -> tuple[str, bool]:
    """Returns (mode, token) where mode is 'bootstrap' or 'admin'."""
    try:
        payload = admin_service.decode_token(raw)
    except Exception as e:
        raise HTTPException(status_code=401, detail="Invalid token") from e
    typ = payload.get("typ")
    if typ == "bootstrap":
        return "bootstrap", raw
    if typ == "admin":
        return "admin", raw
    raise HTTPException(status_code=401, detail="Invalid token")


@router.post("/admins/register", response_model=RegisterAdminsResponse)
def register_admins_bootstrap(
    body: AdminEmailsBody,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
):
    """First-time registration: Authorization: Bearer <bootstrap token>."""
    if creds is None or not creds.credentials:
        raise HTTPException(status_code=401, detail="Bootstrap token required")
    try:
        admin_service.assert_bootstrap_token(creds.credentials)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    if not admin_service.needs_bootstrap():
        raise HTTPException(status_code=400, detail="Bootstrap already completed; use admin login")
    emails = [str(e) for e in body.emails]
    try:
        created = admin_service.create_admin_users(emails)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return RegisterAdminsResponse(
        created=[CreatedAdminCredentials(email=c["email"], password=c["password"]) for c in created]
    )


@router.post("/login", response_model=TokenResponse)
def admin_login(body: AdminLoginBody):
    try:
        token = admin_service.admin_login(body.email, body.password)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return TokenResponse(access_token=token)


@router.get("/admins", response_model=AdminListResponse)
def list_admins(token: Annotated[str, Depends(_auth_header)]):
    try:
        admin_service.assert_admin_token(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    rows = admin_service.list_admins(include_deleted=False)
    return AdminListResponse(
        admins=[
            AdminUserRow(
                id=r.id,
                email=r.email,
                is_active=r.is_active,
                is_deleted=r.is_deleted,
                created_at=r.created_at,
            )
            for r in rows
        ]
    )


@router.post("/admins", response_model=RegisterAdminsResponse)
def add_admins(
    body: AdminEmailsBody,
    token: Annotated[str, Depends(_auth_header)],
):
    try:
        admin_service.assert_admin_token(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    emails = [str(e) for e in body.emails]
    try:
        created = admin_service.create_admin_users(emails)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return RegisterAdminsResponse(
        created=[CreatedAdminCredentials(email=c["email"], password=c["password"]) for c in created]
    )


@router.post("/admins/{user_id}/disable", response_model=OkResponse)
def disable_admin_user(
    user_id: int,
    token: Annotated[str, Depends(_auth_header)],
):
    try:
        actor = admin_service.assert_admin_token(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    try:
        admin_service.disable_admin(user_id, actor)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return OkResponse(ok=True)


@router.get("/contest-settings", response_model=ContestSettingsResponse)
def list_contest_settings(
    token: Annotated[str, Depends(_auth_header)],
    include_deleted: bool = False,
):
    try:
        admin_service.assert_admin_token(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    rows = admin_service.list_contest_settings(include_deleted=include_deleted)
    return ContestSettingsResponse(settings=[ContestSettingRow(**r.__dict__) for r in rows])


@router.get("/question-banks", response_model=QuestionBanksResponse)
def list_question_banks_admin(token: Annotated[str, Depends(_auth_header)]):
    try:
        admin_service.assert_admin_token(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    rows = list_question_banks()
    return QuestionBanksResponse(rows=[QuestionBankRow(**r) for r in rows])


def _question_bank_upload_max_batch() -> int:
    raw = os.environ.get("QUESTION_BANK_UPLOAD_MAX_BATCH", "50").strip()
    try:
        n = int(raw)
    except ValueError:
        return 50
    return max(1, min(n, 200))


@router.post("/question-banks/upload", response_model=QuestionBankUploadBatchResponse)
async def upload_question_bank_admin(
    request: Request,
    token: Annotated[str, Depends(_auth_header)],
):
    """Upload one or many PDFs. Use form field `files` (repeatable) or legacy `upload` (single).

    PDFs are processed **sequentially** (queued) so memory and DB work stay bounded.
    """
    try:
        actor = admin_service.assert_admin_token(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e

    form = await request.form()
    queue: list[UploadFile] = []
    for part in form.getlist("files"):
        if isinstance(part, UploadFile):
            queue.append(part)
    if not queue:
        single = form.get("upload")
        if isinstance(single, UploadFile):
            queue.append(single)
    if not queue:
        raise HTTPException(
            status_code=400,
            detail="Send one or more PDFs using form field files (repeatable) or upload (single)",
        )
    max_batch = _question_bank_upload_max_batch()
    if len(queue) > max_batch:
        raise HTTPException(
            status_code=400,
            detail=f"At most {max_batch} PDFs per request",
        )

    items: list[QuestionBankUploadItemResult] = []
    succeeded = 0
    failed = 0
    total = len(queue)
    log_info(
        "Admin API: question bank upload queue starting",
        queue_total=total,
        actor_user_id=actor,
    )
    allow_pending_gemini = total == 1
    for position, uf in enumerate(queue, start=1):
        name = (uf.filename or "").strip() or "unknown.pdf"
        if not name.lower().endswith(".pdf"):
            items.append(
                QuestionBankUploadItemResult(
                    original_file_name=name,
                    success=False,
                    error="Only PDF uploads are supported",
                )
            )
            failed += 1
            log_info(
                "Admin API: question bank queue skip non-PDF",
                position=position,
                queue_total=total,
                file_name=name,
            )
            continue
        try:
            log_info(
                "Admin API: question bank queue item started",
                position=position,
                queue_total=total,
                file_name=name,
                actor_user_id=actor,
            )
            raw = await uf.read()
            log_info(
                "Admin API: question bank upload request body read",
                file_name=name,
                bytes=len(raw),
                actor_user_id=actor,
            )
            uo = upload_question_bank(
                file_name=name,
                content=raw,
                actor_user_id=actor,
                allow_pending_gemini=allow_pending_gemini,
            )
            if uo.pending_gemini and uo.pending_id:
                items.append(
                    QuestionBankUploadItemResult(
                        original_file_name=name,
                        success=False,
                        needs_gemini_confirmation=True,
                        pending_id=uo.pending_id,
                        gemini_prompt_reason=uo.gemini_prompt_reason,
                    )
                )
                failed += 1
                log_info(
                    "Admin API: question bank upload awaiting Gemini confirmation",
                    file_name=name,
                    pending_id=uo.pending_id,
                    actor_user_id=actor,
                )
                continue
            if uo.ok and uo.result is not None:
                out = uo.result
                log_info(
                    "Admin API: question bank upload completed",
                    file_id=out.file_id,
                    file_name=out.file_name,
                    inserted_questions=out.inserted_questions,
                    deduped_questions=out.deduped_questions,
                    used_ollama=out.used_ollama,
                    used_gemini=out.used_gemini,
                )
                items.append(
                    QuestionBankUploadItemResult(
                        original_file_name=name,
                        success=True,
                        file_id=out.file_id,
                        file_name=out.file_name,
                        inserted_questions=out.inserted_questions,
                        deduped_questions=out.deduped_questions,
                        used_ollama=out.used_ollama,
                        used_gemini=out.used_gemini,
                    )
                )
                succeeded += 1
            else:
                failed += 1
                items.append(
                    QuestionBankUploadItemResult(
                        original_file_name=name,
                        success=False,
                        error=uo.error_message or "Upload failed",
                        suggest_upload_individually=uo.suggest_upload_individually,
                    )
                )
                log_info(
                    "Admin API: question bank queue item failed",
                    position=position,
                    queue_total=total,
                    file_name=name,
                    error=uo.error_message,
                )
        except ValueError as e:
            failed += 1
            items.append(
                QuestionBankUploadItemResult(
                    original_file_name=name,
                    success=False,
                    error=str(e),
                )
            )
            log_info(
                "Admin API: question bank queue item failed",
                position=position,
                queue_total=total,
                file_name=name,
                error=str(e),
            )
        except RuntimeError as e:
            failed += 1
            items.append(
                QuestionBankUploadItemResult(
                    original_file_name=name,
                    success=False,
                    error=str(e),
                )
            )
            log_info(
                "Admin API: question bank queue item failed",
                position=position,
                queue_total=total,
                file_name=name,
                error=str(e),
            )

    log_info(
        "Admin API: question bank upload queue finished",
        queue_total=total,
        succeeded=succeeded,
        failed=failed,
        actor_user_id=actor,
    )
    return QuestionBankUploadBatchResponse(items=items, succeeded=succeeded, failed=failed)


@router.get("/question-banks/pending/{pending_id}/pdf")
def get_pending_question_bank_pdf(
    pending_id: str,
    token: Annotated[str, Depends(_auth_header)],
):
    try:
        admin_service.assert_admin_token(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    try:
        path = pending_question_bank_pdf_path(pending_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail="Pending upload not found") from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return FileResponse(
        str(path),
        media_type="application/pdf",
        filename="preview.pdf",
        headers={"Content-Disposition": 'inline; filename="preview.pdf"'},
    )


@router.post("/question-banks/pending/{pending_id}/confirm-gemini", response_model=QuestionBankConfirmGeminiResponse)
def confirm_pending_question_bank_gemini(
    pending_id: str,
    token: Annotated[str, Depends(_auth_header)],
):
    try:
        actor = admin_service.assert_admin_token(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    try:
        result = confirm_question_bank_gemini(pending_id=pending_id, actor_user_id=actor)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail="Pending upload not found") from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return QuestionBankConfirmGeminiResponse(
        file_id=result.file_id,
        file_name=result.file_name,
        inserted_questions=result.inserted_questions,
        deduped_questions=result.deduped_questions,
        used_ollama=result.used_ollama,
        used_gemini=result.used_gemini,
    )


@router.delete("/question-banks/pending/{pending_id}", response_model=OkResponse)
def delete_pending_question_bank_admin(
    pending_id: str,
    token: Annotated[str, Depends(_auth_header)],
):
    try:
        admin_service.assert_admin_token(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    try:
        cancel_pending_question_bank(pending_id=pending_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail="Pending upload not found") from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return OkResponse(ok=True)


@router.post("/contest-settings", response_model=ContestSettingRow)
def add_contest_setting(
    body: ContestSettingCreateBody,
    token: Annotated[str, Depends(_auth_header)],
):
    try:
        actor = admin_service.assert_admin_token(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    try:
        row = admin_service.add_contest_setting(
            subject_name=body.subject_name,
            subject_description=body.subject_description,
            is_active=body.is_active,
            season_start_date=body.season_start_date,
            season_end_date=body.season_end_date,
            shortlist_threshold=body.shortlist_threshold,
            allow_repeat_users=body.allow_repeat_users,
            actor_user_id=actor,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return ContestSettingRow(**row.__dict__)


@router.patch("/contest-settings/{setting_id}/season", response_model=ContestSettingRow)
def update_contest_setting_season(
    setting_id: int,
    body: ContestSettingSeasonBody,
    token: Annotated[str, Depends(_auth_header)],
):
    try:
        actor = admin_service.assert_admin_token(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    try:
        row = admin_service.update_contest_setting_season(
            setting_id=setting_id,
            season_start_date=body.season_start_date,
            season_end_date=body.season_end_date,
            actor_user_id=actor,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return ContestSettingRow(**row.__dict__)


@router.patch("/contest-settings/{setting_id}/shortlist-threshold", response_model=ContestSettingRow)
def update_contest_setting_shortlist(
    setting_id: int,
    body: ContestSettingShortlistBody,
    token: Annotated[str, Depends(_auth_header)],
):
    try:
        actor = admin_service.assert_admin_token(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    try:
        row = admin_service.update_contest_setting_shortlist(
            setting_id=setting_id,
            shortlist_threshold=body.shortlist_threshold,
            allow_repeat_users=body.allow_repeat_users,
            actor_user_id=actor,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return ContestSettingRow(**row.__dict__)


@router.post("/contest-settings/{setting_id}/deactivate", response_model=OkResponse)
def deactivate_contest_setting(
    setting_id: int,
    token: Annotated[str, Depends(_auth_header)],
):
    try:
        actor = admin_service.assert_admin_token(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    try:
        admin_service.deactivate_contest_setting(setting_id=setting_id, actor_user_id=actor)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return OkResponse(ok=True)


@router.get("/quiz-settings", response_model=QuizSettingsResponse)
def admin_get_quiz_settings(token: Annotated[str, Depends(_auth_header)]):
    try:
        admin_service.assert_admin_token(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    try:
        d = get_quiz_settings_admin()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return QuizSettingsResponse(**d)


@router.put("/quiz-settings", response_model=QuizSettingsResponse)
def admin_put_quiz_settings(
    body: QuizSettingsUpdateBody,
    token: Annotated[str, Depends(_auth_header)],
):
    try:
        admin_service.assert_admin_token(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    if (
        body.max_attempts is None
        and body.time_per_question_seconds is None
        and body.marks_per_question is None
        and body.questions_per_attempt is None
    ):
        raise HTTPException(status_code=400, detail="Provide at least one field to update")
    try:
        d = update_quiz_settings_row(
            max_attempts=body.max_attempts,
            time_per_question_seconds=body.time_per_question_seconds,
            marks_per_question=body.marks_per_question,
            questions_per_attempt=body.questions_per_attempt,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return QuizSettingsResponse(**d)


@router.get("/analytics/summary", response_model=AnalyticsSummaryResponse)
def admin_analytics_summary(token: Annotated[str, Depends(_auth_header)]):
    try:
        admin_service.assert_admin_token(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    s = analytics_overview_scores()
    return AnalyticsSummaryResponse(
        total_scores=s["total_scores"],
        by_agent=s["by_agent"],
        average_total_score=s["average_total_score"],
        average_weighted_score=s["average_weighted_score"],
        average_confidence=s.get("average_confidence"),
        needs_review_count=int(s.get("needs_review_count") or 0),
        weighted_score_sum=s["weighted_score_sum"],
        distinct_users=s["distinct_users"],
    )


@router.get("/analytics/attempts", response_model=AnalyticsAttemptsResponse)
def admin_analytics_attempts(
    token: Annotated[str, Depends(_auth_header)],
    limit: int = 50,
    offset: int = 0,
    status: str | None = None,
):
    try:
        admin_service.assert_admin_token(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    # Keep the query param name `status` for backward compatibility with existing frontend requests.
    rows, total = list_scores(limit=limit, offset=offset, agent=status)
    trimmed = []
    for r in rows:
        trimmed.append(
            {
                "id": r.get("id"),
                "user_email": r.get("user_email") or "",
                "agent": r.get("agent") or "",
                "relevance": r.get("relevance"),
                "creativity": r.get("creativity"),
                "clarity": r.get("clarity"),
                "impact": r.get("impact"),
                "total_score": r.get("total_score"),
                "weighted_score": r.get("weighted_score"),
                "confidence": r.get("confidence"),
                "needs_human_review": r.get("needs_human_review", False),
                "evaluated_at": r.get("evaluated_at"),
            }
        )
    return AnalyticsAttemptsResponse(
        total=total,
        limit=limit,
        offset=offset,
        rows=[AttemptAnalyticsRow(**r) for r in trimmed],
    )


@router.get("/content-analysis/scores", response_model=ContentAnalysisScoresResponse)
def admin_content_analysis_scores(
    token: Annotated[str, Depends(_auth_header)],
    limit: int = 50,
    offset: int = 0,
    agent: str | None = None,
    user_id: int | None = None,
    submission_id: int | None = None,
):
    try:
        admin_service.assert_admin_token(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e

    summary = scores_summary(agent=agent, user_id=user_id, submission_id=submission_id)
    rows, total = list_scores(
        limit=limit,
        offset=offset,
        agent=agent,
        user_id=user_id,
        submission_id=submission_id,
    )
    return ContentAnalysisScoresResponse(
        total=total,
        limit=max(1, min(limit, 200)),
        offset=max(0, offset),
        summary=ScoresSummary(**summary),
        rows=rows,
    )


@router.get("/content-analysis/shortlist-scores", response_model=ShortlistScoresResponse)
def admin_content_analysis_shortlist_scores(
    token: Annotated[str, Depends(_auth_header)],
    limit: int = 50,
    offset: int = 0,
):
    """Top ``shortlist_threshold`` percent of scores (by weighted score), from the active contest setting."""
    try:
        admin_service.assert_admin_token(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    result = list_shortlisted_scores(limit=limit, offset=offset)
    if result is None:
        raise HTTPException(
            status_code=400,
            detail="No active contest setting. Configure one under Contest settings and mark it active.",
        )
    rows, total, meta = result
    lim = max(1, min(limit, 200))
    off = max(0, offset)
    return ShortlistScoresResponse(
        total=total,
        limit=lim,
        offset=off,
        threshold_percent=meta["threshold_percent"],
        repeat_users=bool(meta["repeat_users"]),
        total_scores_in_pool=meta["total_scores_in_pool"],
        shortlist_size=meta["shortlist_size"],
        rows=rows,
    )


@router.get("/content-analysis/scores/{score_id}", response_model=ScoreDetailResponse)
def admin_content_analysis_score_detail(
    score_id: int,
    token: Annotated[str, Depends(_auth_header)],
):
    try:
        admin_service.assert_admin_token(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    row = get_score_detail(score_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Score row not found")
    return ScoreDetailResponse(**row)


@router.get("/content-analysis/scores/{score_id}/history", response_model=ScoreReviewHistoryResponse)
def admin_content_analysis_score_history(
    score_id: int,
    token: Annotated[str, Depends(_auth_header)],
):
    try:
        admin_service.assert_admin_token(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    rows = get_score_review_history(score_id)
    return ScoreReviewHistoryResponse(score_id=score_id, rows=[ScoreReviewHistoryRow(**r) for r in rows])


@router.put("/content-analysis/scores/{score_id}/review", response_model=ScoreReviewUpdateResponse)
def admin_content_analysis_score_review_update(
    score_id: int,
    body: ScoreReviewUpdateBody,
    token: Annotated[str, Depends(_auth_header)],
):
    try:
        admin_service.assert_admin_token(token)
        payload = admin_service.decode_token(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    reviewer = str(payload.get("email") or payload.get("sub") or "human")

    row = update_score_human_review(
        score_id=score_id,
        reviewer=reviewer,
        scores={
            "relevance": body.scores.relevance,
            "creativity": body.scores.creativity,
            "clarity": body.scores.clarity,
            "impact": body.scores.impact,
        },
        reasoning={
            "impact": body.reasoning.impact,
            "clarity": body.reasoning.clarity,
            "relevance": body.reasoning.relevance,
            "creativity": body.reasoning.creativity,
        },
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Score row not found")
    return ScoreReviewUpdateResponse(score=ScoreDetailResponse(**row))


@router.get("/analytics/user-scores", response_model=UserScoresResponse)
def admin_analytics_user_scores(
    email: str,
    token: Annotated[str, Depends(_auth_header)],
    limit: int = 10,
):
    try:
        admin_service.assert_admin_token(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    rows = list_user_scores_by_email(email=email, limit=limit)
    return UserScoresResponse(email=email, limit=max(1, min(limit, 10)), rows=rows)


@router.get("/analytics/score-highlights", response_model=ScoreHighlightsResponse)
def admin_analytics_score_highlights(
    token: Annotated[str, Depends(_auth_header)],
    limit: int = 20,
    offset: int = 0,
):
    try:
        admin_service.assert_admin_token(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    rows, total = list_score_highlights(limit=limit, offset=offset)
    lim = max(1, min(limit, 100))
    off = max(0, offset)
    return ScoreHighlightsResponse(total=total, limit=lim, offset=off, rows=rows)
