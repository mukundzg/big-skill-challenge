"""Quiz API schemas."""

from pydantic import BaseModel, EmailStr, Field


class EmailBody(BaseModel):
    email: EmailStr


class QuizDashboardResponse(BaseModel):
    max_attempts: int
    time_per_question_seconds: int
    marks_per_question: int
    attempts_used: int
    attempts_remaining: int
    total_correct_answers: int
    total_score: float


class QuizStartResponse(BaseModel):
    ok: bool = True
    attempt_id: int | None = None
    attempt_number: int | None = None
    total_questions: int | None = None
    first_question: dict | None = None
    time_per_question_seconds: int | None = None
    marks_per_question: int | None = None
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
    next_question: dict | None = None
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
