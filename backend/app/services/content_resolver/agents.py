from __future__ import annotations

from dataclasses import dataclass
from typing import Dict

from app.services.content_resolver.audit import AuditLogger
from app.services.content_resolver.models import AuditLog, Entry
from app.services.content_resolver.tools import heuristic_score, validate_score_payload


@dataclass(slots=True)
class RubricAgent:
    name: str
    seed: int
    rubric: Dict[str, str]
    audit_logger: AuditLogger
    subject_name: str
    subject_description: str | None = None

    def evaluate(self, entry: Entry) -> Dict[str, Dict]:
        scores, reasoning = heuristic_score(
            entry=entry,
            rubric=self.rubric,
            agent_seed=self.seed,
            subject_name=self.subject_name,
            subject_description=self.subject_description,
        )
        valid, errors = validate_score_payload(scores=scores, reasoning=reasoning)
        result = {
            "scores": scores,
            "reasoning": reasoning,
            "valid": valid,
            "errors": errors,
        }
        self.audit_logger.log(
            AuditLog(
                entry_id=entry.id,
                agent_name=self.name,
                action="evaluate_entry",
                input={
                    "text": entry.text,
                    "subject_name": self.subject_name,
                    "subject_description": self.subject_description,
                },
                output=result,
            )
        )
        return result

