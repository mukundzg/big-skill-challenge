from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List


RUBRIC_KEYS = ("relevance", "creativity", "clarity", "impact")


def utc_now() -> datetime:
    return datetime.now(tz=timezone.utc)


@dataclass(slots=True)
class Entry:
    id: int
    text: str
    created_at: datetime = field(default_factory=utc_now)


@dataclass(slots=True)
class ScoreResult:
    attempt_id: int
    agent: str
    relevance: int
    creativity: int
    clarity: int
    impact: int
    total_score: int
    weighted_score: float
    confidence: float
    uncertainty_reason: str
    needs_human_review: bool
    reasoning: Dict[str, str]
    evaluated_at: datetime = field(default_factory=utc_now)


@dataclass(slots=True)
class AuditLog:
    entry_id: int
    agent_name: str
    action: str
    input: Dict[str, Any]
    output: Dict[str, Any]
    created_at: datetime = field(default_factory=utc_now)


@dataclass(slots=True)
class EvaluationSummary:
    ranked_scores: List[ScoreResult]
    shortlisted: List[ScoreResult]
    consistency_report: Dict[str, Any]

