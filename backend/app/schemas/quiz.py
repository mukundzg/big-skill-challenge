"""Quiz API schemas."""

from pydantic import BaseModel, EmailStr, Field


class EmailBody(BaseModel):
    email: EmailStr


class QuizQuestionPublic(BaseModel):
    """One MCQ as returned to clients (e.g. React Native); options are shuffled per attempt."""

    index: int = Field(..., ge=0, description="0-based index within this attempt")
    question: str
    options: list[str] = Field(..., min_length=4, max_length=4)


class QuizDashboardResponse(BaseModel):
    max_attempts: int
    time_per_question_seconds: int
    marks_per_question: int
    attempts_used: int
    attempts_remaining: int
    total_correct_answers: int
    total_score: float
    contest_is_active: bool = False
    contest_season_end: str | None = None


class QuizEntryRow(BaseModel):
    attempt_id: int
    attempt_number: int
    reference: str
    status: str
    status_label: str
    submitted_at: str | None = None
    word_count: int | None = None


class QuizEntriesResponse(BaseModel):
    rows: list[QuizEntryRow]


class QuizStartResponse(BaseModel):
    ok: bool = True
    attempt_id: int | None = None
    attempt_number: int | None = None
    total_questions: int | None = None
    first_question: QuizQuestionPublic | None = None
    time_per_question_seconds: int | None = None
    marks_per_question: int | None = None
    source_file_id: int | None = Field(
        default=None,
        description="Question bank `files.id` this attempt was drawn from (DB-backed questions).",
    )
    source_file_name: str | None = Field(
        default=None,
        description="Stored question-bank filename (metadata; PDF may have been deleted after upload).",
    )
    error: str | None = None


class QuizQuestionBody(BaseModel):
    email: EmailStr
    attempt_id: int = Field(..., ge=1)
    question_index: int = Field(..., ge=0)


class QuizAnswerBody(BaseModel):
    email: EmailStr
    attempt_id: int = Field(..., ge=1)
    question_index: int = Field(..., ge=0)
    selected_option_index: int = Field(..., ge=0, le=3)


class QuizAnswerResponse(BaseModel):
    ok: bool
    finished: bool = False
    outcome: str | None = Field(
        default=None,
        description="When finished: success | wrong_exit",
    )
    correct_answers: int | None = None
    total_questions: int | None = None
    score: float | None = None
    next_question: QuizQuestionPublic | None = None
    error: str | None = None


class QuizTimeoutBody(BaseModel):
    email: EmailStr
    attempt_id: int = Field(..., ge=1)


class QuizTimeoutResponse(BaseModel):
    ok: bool
    correct_answers: int | None = None
    total_questions: int | None = None
    score: float | None = None
    error: str | None = None
