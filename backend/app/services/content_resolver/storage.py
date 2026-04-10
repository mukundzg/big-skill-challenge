from __future__ import annotations

from dataclasses import asdict
from typing import Any, Dict, List

from app.services.content_resolver.models import Entry, ScoreResult


class InMemoryStore:
    """MVP storage and cache; swap for Redis/DB adapters later."""

    def __init__(self) -> None:
        self.entries: Dict[int, Entry] = {}
        self.scores: Dict[int, ScoreResult] = {}
        self.shortlists: List[Dict[str, Any]] = []

    def save_entry(self, entry: Entry) -> None:
        self.entries[entry.id] = entry

    def save_score(self, score: ScoreResult) -> None:
        self.scores[score.attempt_id] = score

    def save_shortlist(self, run_id: str, shortlisted: List[ScoreResult]) -> None:
        self.shortlists.append(
            {
                "run_id": run_id,
                "attempt_ids": [item.attempt_id for item in shortlisted],
                "scores": [asdict(item) for item in shortlisted],
            }
        )

    def get_scores(self) -> List[ScoreResult]:
        return list(self.scores.values())

