from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, List
from uuid import uuid4

from app.services.content_resolver.agents import RubricAgent
from app.services.content_resolver.audit import AuditLogger
from app.services.content_resolver.logging_utils import app_log, app_log_debug
from app.services.content_resolver.models import AuditLog, Entry, EvaluationSummary, RUBRIC_KEYS, ScoreResult
from app.services.content_resolver.storage import InMemoryStore
from app.services.content_resolver.tools import aggregate_scores, cross_check, load_rubric, rank_results, validate_input_entry


class EvaluationOrchestrator:
    def __init__(
        self,
        rubric_path: str,
        subject_name: str,
        subject_description: str | None = None,
        weights: Dict[str, float] | None = None,
        shortlist_n: int = 5,
        enable_cross_check: bool = True,
    ) -> None:
        self.rubric_path = rubric_path
        self.subject_name = subject_name
        self.subject_description = subject_description
        self.weights = weights or {k: 0.25 for k in RUBRIC_KEYS}
        self.shortlist_n = shortlist_n
        self.enable_cross_check = enable_cross_check
        self.audit = AuditLogger()
        self.store = InMemoryStore()
        self.rubric = load_rubric(rubric_path)
        self._submissions_payload: List[Dict[str, Any]] = []
        self.uncertainty_threshold = 0.60
        self.crosscheck_diff_threshold = 2

    def _build_agents(self) -> List[RubricAgent]:
        return [
            RubricAgent(
                name="primary_scorer",
                seed=11,
                rubric=self.rubric,
                audit_logger=self.audit,
                subject_name=self.subject_name,
                subject_description=self.subject_description,
            ),
            RubricAgent(
                name="consistency_checker",
                seed=29,
                rubric=self.rubric,
                audit_logger=self.audit,
                subject_name=self.subject_name,
                subject_description=self.subject_description,
            ),
        ]

    def evaluate_entries(self, raw_entries: List[Dict[str, Any]]) -> EvaluationSummary:
        app_log("orchestrator", f"received {len(raw_entries)} entries for evaluation")
        agents = self._build_agents()
        consistency_hits = 0
        consistency_total = 0
        valid_entries = 0

        for item in raw_entries:
            attempt_id = int(item["attempt_id"])
            text = str(item["entry"])
            app_log_debug("orchestrator", f"entry received: attempt_id={attempt_id}, text_len={len(text)}")
            is_valid, message, word_count = validate_input_entry(text)
            app_log_debug(
                "orchestrator",
                f"entry validation: attempt_id={attempt_id}, valid={is_valid}, word_count={word_count}, reason={message}",
            )
            self.audit.log(
                AuditLog(
                    entry_id=attempt_id,
                    agent_name="input_validator",
                    action="validate_entry",
                    input={"text": text},
                    output={"valid": is_valid, "message": message, "word_count": word_count},
                )
            )
            if not is_valid:
                app_log_debug("orchestrator", f"entry skipped: attempt_id={attempt_id}, reason={message}")
                continue
            valid_entries += 1

            entry = Entry(id=attempt_id, text=text)
            self.store.save_entry(entry)

            primary = agents[0].evaluate(entry)
            scores = primary["scores"]
            reasoning = primary["reasoning"]
            app_log_debug(
                "orchestrator",
                f"primary scores: attempt_id={attempt_id}, relevance={scores['relevance']}, creativity={scores['creativity']}, clarity={scores['clarity']}, impact={scores['impact']}",
            )

            consistency_data: Dict[str, Any] = {"is_consistent": True, "differences": {}}
            if self.enable_cross_check:
                secondary = agents[1].evaluate(entry)
                consistency_data = cross_check(scores, secondary["scores"], tolerance=2)
                consistency_total += 1
                if consistency_data["is_consistent"]:
                    consistency_hits += 1
                self.audit.log(
                    AuditLog(
                        entry_id=entry.id,
                        agent_name="cross_check_tool",
                        action="compare_scores",
                        input={"primary": scores, "secondary": secondary["scores"]},
                        output=consistency_data,
                    )
                )

            total, weighted = aggregate_scores(scores=scores, weights=self.weights)
            max_diff = 0
            if consistency_data["differences"]:
                max_diff = max(v["difference"] for v in consistency_data["differences"].values())
            confidence = max(0.0, min(1.0, 0.92 - (0.12 * max_diff)))
            uncertainty_reasons: List[str] = []
            if max_diff > self.crosscheck_diff_threshold:
                uncertainty_reasons.append(
                    f"cross-check disagreement exceeded threshold: max_diff={max_diff}, threshold={self.crosscheck_diff_threshold}"
                )
            if confidence < self.uncertainty_threshold:
                uncertainty_reasons.append(
                    f"confidence below threshold: confidence={confidence:.2f}, threshold={self.uncertainty_threshold:.2f}"
                )
            needs_human_review = len(uncertainty_reasons) > 0
            score_row = ScoreResult(
                attempt_id=entry.id,
                agent="agentic",
                relevance=scores["relevance"],
                creativity=scores["creativity"],
                clarity=scores["clarity"],
                impact=scores["impact"],
                total_score=total,
                weighted_score=weighted,
                confidence=round(confidence, 3),
                uncertainty_reason="; ".join(uncertainty_reasons),
                needs_human_review=needs_human_review,
                reasoning=reasoning,
            )
            self.store.save_score(score_row)
            app_log_debug(
                "orchestrator",
                f"score saved: attempt_id={attempt_id}, total={total}, weighted={weighted}, needs_human_review={needs_human_review}",
            )
            self.audit.log(
                AuditLog(
                    entry_id=entry.id,
                    agent_name="aggregation_tool",
                    action="compute_totals",
                    input={"scores": scores, "weights": self.weights},
                    output={"total_score": total, "weighted_score": weighted, "consistency": consistency_data},
                )
            )

        ranked, shortlisted = rank_results(self.store.get_scores(), shortlist_n=self.shortlist_n)
        app_log(
            "orchestrator",
            f"validation complete: {valid_entries} valid, {len(raw_entries) - valid_entries} invalid",
        )
        run_id = str(uuid4())
        self.store.save_shortlist(run_id=run_id, shortlisted=shortlisted)
        self.audit.log(
            AuditLog(
                entry_id=0,
                agent_name="ranking_tool",
                action="rank_and_shortlist",
                input={"entries_evaluated": len(self.store.get_scores()), "shortlist_n": self.shortlist_n},
                output={"run_id": run_id, "shortlisted_attempt_ids": [x.attempt_id for x in shortlisted]},
            )
        )

        consistency_report = {
            "enabled": self.enable_cross_check,
            "checks_run": consistency_total,
            "consistent_count": consistency_hits,
            "consistency_rate": round((consistency_hits / consistency_total), 3) if consistency_total else 1.0,
        }
        app_log(
            "orchestrator",
            f"ranking done: ranked={len(ranked)}, shortlisted={len(shortlisted)}, consistency_rate={consistency_report['consistency_rate']}",
        )
        return EvaluationSummary(ranked_scores=ranked, shortlisted=shortlisted, consistency_report=consistency_report)

    def export_db_payload(self) -> Dict[str, Any]:
        return {
            "scores": [asdict(x) for x in self.store.scores.values()],
            "audit_logs": self.audit.export_rows(),
            "rubric_source": str(Path(self.rubric_path)),
        }

