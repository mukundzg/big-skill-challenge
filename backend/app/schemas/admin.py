"""Admin API request/response models."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, EmailStr, Field


class SetupStatusResponse(BaseModel):
    needs_bootstrap: bool


class BootstrapVerifyBody(BaseModel):
    code: str = Field(..., min_length=4, max_length=32)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class AdminEmailsBody(BaseModel):
    emails: list[EmailStr] = Field(..., min_length=1)


class CreatedAdminCredentials(BaseModel):
    email: str
    password: str


class RegisterAdminsResponse(BaseModel):
    created: list[CreatedAdminCredentials]


class AdminLoginBody(BaseModel):
    email: EmailStr
    password: str


class AdminUserRow(BaseModel):
    id: int
    email: str
    is_active: bool
    is_deleted: bool
    created_at: str | None = None


class AdminListResponse(BaseModel):
    admins: list[AdminUserRow]


class OkResponse(BaseModel):
    ok: bool = True


class QuizSettingsResponse(BaseModel):
    id: int
    max_attempts: int
    time_per_question_seconds: int
    marks_per_question: int
    questions_per_attempt: int
    created_at: str | None = None
    updated_at: str | None = None


class QuizSettingsUpdateBody(BaseModel):
    max_attempts: int | None = Field(default=None, ge=1)
    time_per_question_seconds: int | None = Field(default=None, ge=5)
    marks_per_question: int | None = Field(default=None, ge=1)
    questions_per_attempt: int | None = Field(default=None, ge=1, le=100)


class AnalyticsSummaryResponse(BaseModel):
    total_scores: int
    by_agent: dict[str, int]
    average_total_score: float | None
    average_weighted_score: float | None
    average_confidence: float | None = None
    needs_review_count: int = 0
    weighted_score_sum: float
    distinct_users: int


class AttemptAnalyticsRow(BaseModel):
    id: int
    user_email: str
    agent: str
    relevance: int
    creativity: int
    clarity: int
    impact: int
    total_score: int
    weighted_score: float
    confidence: float | None = None
    needs_human_review: bool = False
    evaluated_at: str | None = None


class AnalyticsAttemptsResponse(BaseModel):
    total: int
    limit: int
    offset: int
    rows: list[AttemptAnalyticsRow]


class ScoreRow(BaseModel):
    id: int
    agent: str
    relevance: int
    creativity: int
    clarity: int
    impact: int
    total_score: int
    weighted_score: float
    confidence: float | None = None
    uncertainty_reason: str = ""
    needs_human_review: bool = False
    reasoning: dict | None = None
    evaluated_at: str | None = None
    submission_id: int
    user_id: int
    user_email: str = ""
    highlight_kind: str | None = None


class ScoresSummary(BaseModel):
    count: int
    avg: dict | None = None
    min: dict | None = None
    max: dict | None = None


class ContentAnalysisScoresResponse(BaseModel):
    total: int
    limit: int
    offset: int
    summary: ScoresSummary
    rows: list[ScoreRow]


class ScoreDetailResponse(ScoreRow):
    submission_text: str = ""
    submission_word_count: int | None = None


class UserScoresResponse(BaseModel):
    email: str
    limit: int
    rows: list[ScoreRow]


class ScoreHighlightsResponse(BaseModel):
    total: int
    limit: int
    offset: int
    rows: list[ScoreRow]


class ShortlistScoresResponse(BaseModel):
    total: int
    limit: int
    offset: int
    threshold_percent: int
    repeat_users: bool
    total_scores_in_pool: int
    shortlist_size: int
    rows: list[ScoreRow]


class ReviewScoresBody(BaseModel):
    relevance: int = Field(..., ge=0, le=10)
    creativity: int = Field(..., ge=0, le=10)
    clarity: int = Field(..., ge=0, le=10)
    impact: int = Field(..., ge=0, le=10)


class ReviewReasoningBody(BaseModel):
    impact: str = Field(..., min_length=1)
    clarity: str = Field(..., min_length=1)
    relevance: str = Field(..., min_length=1)
    creativity: str = Field(..., min_length=1)


class ScoreReviewUpdateBody(BaseModel):
    scores: ReviewScoresBody
    reasoning: ReviewReasoningBody


class ScoreReviewHistoryRow(BaseModel):
    id: int
    score_id: int
    previous_row_json: dict
    updated_row_json: dict
    reviewer: str
    created_at: str | None = None


class ScoreReviewHistoryResponse(BaseModel):
    score_id: int
    rows: list[ScoreReviewHistoryRow]


class ScoreReviewUpdateResponse(BaseModel):
    ok: Literal[True] = True
    score: ScoreDetailResponse


class ContestSettingCreateBody(BaseModel):
    subject_name: str = Field(..., min_length=2, max_length=255)
    subject_description: str | None = Field(default=None, max_length=1000)
    is_active: bool = False
    season_start_date: date | None = None
    season_end_date: date | None = None
    shortlist_threshold: int = Field(default=10, ge=1, le=100)
    allow_repeat_users: bool = False


class ContestSettingSeasonBody(BaseModel):
    season_start_date: date | None = None
    season_end_date: date | None = None


class ContestSettingShortlistBody(BaseModel):
    shortlist_threshold: int = Field(..., ge=1, le=100)
    allow_repeat_users: bool = False


class ContestSettingRow(BaseModel):
    id: int
    subject_name: str
    subject_description: str | None = None
    is_active: bool
    is_deleted: bool
    season_start: str | None = None
    season_end: str | None = None
    shortlist_threshold: int
    allow_repeat_users: bool
    created_at: str | None = None
    updated_at: str | None = None


class ContestSettingsResponse(BaseModel):
    settings: list[ContestSettingRow]


class QuestionBankRow(BaseModel):
    id: int
    file_name: str
    created_at: str | None = None
    created_by: int | None = None
    updated_at: str | None = None
    updated_by: int | None = None
    is_deleted: bool
    question_count: int = 0


class QuestionBanksResponse(BaseModel):
    rows: list[QuestionBankRow]


class QuestionBankUploadItemResult(BaseModel):
    """One PDF in a batch upload (processed sequentially in queue order)."""

    original_file_name: str
    success: bool
    file_id: int | None = None
    file_name: str | None = None
    inserted_questions: int = 0
    deduped_questions: int = 0
    used_ollama: bool = False
    used_gemini: bool = False
    error: str | None = None
    needs_gemini_confirmation: bool = False
    pending_id: str | None = None
    gemini_prompt_reason: str | None = None
    suggest_upload_individually: bool = False


class QuestionBankConfirmGeminiResponse(BaseModel):
    ok: Literal[True] = True
    file_id: int
    file_name: str
    inserted_questions: int
    deduped_questions: int
    used_ollama: bool = False
    used_gemini: bool = True


class QuestionBankUploadBatchResponse(BaseModel):
    ok: Literal[True] = True
    items: list[QuestionBankUploadItemResult]
    succeeded: int
    failed: int
