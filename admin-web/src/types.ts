export type AdminRow = {
  id: number;
  email: string;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string | null;
};

export type QuizSettings = {
  id: number;
  max_attempts: number;
  time_per_question_seconds: number;
  marks_per_question: number;
  created_at: string | null;
  updated_at: string | null;
};

export type AnalyticsSummary = {
  total_scores: number;
  by_agent: Record<string, number>;
  average_total_score: number | null;
  average_weighted_score: number | null;
  average_confidence: number | null;
  needs_review_count: number;
  weighted_score_sum: number;
  distinct_users: number;
};

export type AttemptRow = {
  id: number;
  user_email: string;
  agent: string;
  relevance: number;
  creativity: number;
  clarity: number;
  impact: number;
  total_score: number;
  weighted_score: number;
  confidence: number | null;
  needs_human_review: boolean;
  evaluated_at: string | null;
};

export type AnalyticsAttempts = {
  total: number;
  limit: number;
  offset: number;
  rows: AttemptRow[];
};

export type ScoreRow = {
  id: number;
  agent: string;
  relevance: number;
  creativity: number;
  clarity: number;
  impact: number;
  total_score: number;
  weighted_score: number;
  confidence: number | null;
  uncertainty_reason: string;
  needs_human_review: boolean;
  reasoning: Record<string, unknown> | null;
  evaluated_at: string | null;
  submission_id: number;
  user_id: number;
  user_email: string;
  highlight_kind: string | null;
};

export type ScoreDetail = ScoreRow & {
  submission_text: string;
  submission_word_count: number | null;
};

export type ScoreReviewHistoryRow = {
  id: number;
  score_id: number;
  previous_row_json: Record<string, unknown>;
  updated_row_json: Record<string, unknown>;
  reviewer: string;
  created_at: string | null;
};

export type ScoreReviewHistoryResponse = {
  score_id: number;
  rows: ScoreReviewHistoryRow[];
};

export type ScoreReviewUpdateBody = {
  scores: {
    impact: number;
    clarity: number;
    relevance: number;
    creativity: number;
  };
  reasoning: {
    impact: string;
    clarity: string;
    relevance: string;
    creativity: string;
  };
};

export type ScoresSummary = {
  count: number;
  avg: {
    relevance: number;
    creativity: number;
    clarity: number;
    impact: number;
    total_score: number;
    weighted_score: number;
  } | null;
  min: { weighted_score: number } | null;
  max: { weighted_score: number } | null;
};

export type ContentAnalysisScores = {
  total: number;
  limit: number;
  offset: number;
  summary: ScoresSummary;
  rows: ScoreRow[];
};

export type UserScoresResponse = {
  email: string;
  limit: number;
  rows: ScoreRow[];
};

export type ScoreHighlightsResponse = {
  total: number;
  limit: number;
  offset: number;
  rows: ScoreRow[];
};
