import { AuthApiError } from './auth';
import { ApiError, apiPost } from './client';

export type QuizDashboard = {
  max_attempts: number;
  time_per_question_seconds: number;
  marks_per_question: number;
  attempts_used: number;
  attempts_remaining: number;
  total_correct_answers: number;
  total_score: number;
  shortlisted: number;
  contest_is_active?: boolean;
  contest_season_end?: string | null;
  has_resumable_attempt?: boolean;
  resumable_attempt_id?: number | null;
  resume_question_index?: number | null;
  resume_total_questions?: number | null;
  resume_source_file_id?: number | null;
  resume_source_file_name?: string | null;
};

export type QuizStartResult = {
  ok: boolean;
  attempt_id: number | null;
  attempt_number: number | null;
  total_questions: number | null;
  /** First question from DB-backed question bank; same shape as `next_question` on /quiz/answer */
  first_question: {
    index: number;
    question: string;
    options: string[];
  } | null;
  time_per_question_seconds: number | null;
  marks_per_question: number | null;
  /** `files.id` for the question bank used for this attempt */
  source_file_id?: number | null;
  /** Stored bank filename (metadata) */
  source_file_name?: string | null;
  error?: string | null;
};

export type QuizResumeResult = {
  ok: boolean;
  has_resumable_attempt: boolean;
  attempt_id: number | null;
  attempt_number: number | null;
  total_questions: number | null;
  current_question_index: number | null;
  current_question: {
    index: number;
    question: string;
    options: string[];
  } | null;
  time_per_question_seconds: number | null;
  marks_per_question: number | null;
  source_file_id?: number | null;
  source_file_name?: string | null;
};

export type QuizAnswerResult = {
  ok: boolean;
  finished: boolean;
  /** Present when finished: success = all correct; wrong_exit = wrong option */
  outcome?: string | null;
  correct_answers?: number | null;
  total_questions?: number | null;
  score?: number | null;
  next_question?: {
    index: number;
    question: string;
    options: string[];
  } | null;
};

export async function fetchQuizDashboard(email: string): Promise<QuizDashboard> {
  try {
    return await apiPost<{ email: string }, QuizDashboard>('/quiz/dashboard', { email });
  } catch (e) {
    if (e instanceof ApiError) throw AuthApiError.fromApiError(e);
    throw e;
  }
}

export type QuizEntry = {
  attempt_id: number;
  attempt_number: number;
  reference: string;
  status: string;
  status_label: string;
  submitted_at: string | null;
  word_count: number | null;
};

export type QuizShortlistResult = {
  status: string;
  status_label: string;
  reference: string;
  prompt: string;
  submission_text: string;
  word_count: number | null;
  submitted_at: string | null;
  rank_position: number | null;
  total_shortlisted: number;
  total_entries: number;
  weighted_score: number | null;
  total_score: number | null;
  engine_name: string;
  engine_description: string;
  engine_model_version: string | null;
  rubric_breakdown: Array<{
    label: string;
    score: number;
    max: number;
    color: string;
  }>;
  next_steps: string[];
  audit_trail: Array<{
    event: string;
    timestamp: string;
  }>;
};

type QuizEntriesResponse = {
  rows: QuizEntry[];
};

export async function fetchMyEntries(email: string): Promise<QuizEntry[]> {
  try {
    const res = await apiPost<{ email: string }, QuizEntriesResponse>('/quiz/my-entries', { email });
    return Array.isArray(res.rows) ? res.rows : [];
  } catch (e) {
    if (e instanceof ApiError) throw AuthApiError.fromApiError(e);
    throw e;
  }
}

export async function fetchShortlistResult(email: string): Promise<QuizShortlistResult> {
  try {
    return await apiPost<{ email: string }, QuizShortlistResult>('/quiz/shortlist-result', { email });
  } catch (e) {
    if (e instanceof ApiError) throw AuthApiError.fromApiError(e);
    throw e;
  }
}

export async function startQuizAttempt(email: string): Promise<QuizStartResult> {
  try {
    return await apiPost<{ email: string }, QuizStartResult>('/quiz/start', { email });
  } catch (e) {
    if (e instanceof ApiError) throw AuthApiError.fromApiError(e);
    throw e;
  }
}

export async function fetchQuizResume(email: string): Promise<QuizResumeResult> {
  try {
    return await apiPost<{ email: string }, QuizResumeResult>('/quiz/resume', { email });
  } catch (e) {
    if (e instanceof ApiError) throw AuthApiError.fromApiError(e);
    throw e;
  }
}

export async function submitQuizAnswer(
  email: string,
  attemptId: number,
  questionIndex: number,
  selectedOptionIndex: number,
): Promise<QuizAnswerResult> {
  try {
    return await apiPost<
      {
        email: string;
        attempt_id: number;
        question_index: number;
        selected_option_index: number;
      },
      QuizAnswerResult
    >('/quiz/answer', {
      email,
      attempt_id: attemptId,
      question_index: questionIndex,
      selected_option_index: selectedOptionIndex,
    });
  } catch (e) {
    if (e instanceof ApiError) throw AuthApiError.fromApiError(e);
    throw e;
  }
}

export type QuizTimeoutResponse = {
  ok: boolean;
  correct_answers?: number | null;
  total_questions?: number | null;
  score?: number | null;
  error?: string | null;
};

export async function submitQuizTimeout(email: string, attemptId: number): Promise<QuizTimeoutResponse> {
  try {
    return await apiPost<{ email: string; attempt_id: number }, QuizTimeoutResponse>('/quiz/timeout', {
      email,
      attempt_id: attemptId,
    });
  } catch (e) {
    if (e instanceof ApiError) throw AuthApiError.fromApiError(e);
    throw e;
  }
}

export type CreativeSubmissionResponse = {
  submission_id: string;
  status: 'buffered' | string;
};

export async function submitCreativeEntry(
  userId: number,
  attemptId: number,
  entry: string,
): Promise<CreativeSubmissionResponse> {
  try {
    return await apiPost<
      { user_id: number; attempt_id: number; entry: string },
      CreativeSubmissionResponse
    >('/entry-evaluation/submit', {
      user_id: userId,
      attempt_id: attemptId,
      entry,
    });
  } catch (e) {
    if (e instanceof ApiError) throw AuthApiError.fromApiError(e);
    throw e;
  }
}
