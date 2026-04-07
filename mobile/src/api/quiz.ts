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
};

export type QuizStartResult = {
  ok: boolean;
  attempt_id: number | null;
  attempt_number: number | null;
  total_questions: number | null;
  first_question: {
    index: number;
    question: string;
    options: string[];
  } | null;
  time_per_question_seconds: number | null;
  marks_per_question: number | null;
  error?: string | null;
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

export async function startQuizAttempt(email: string): Promise<QuizStartResult> {
  try {
    return await apiPost<{ email: string }, QuizStartResult>('/quiz/start', { email });
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
