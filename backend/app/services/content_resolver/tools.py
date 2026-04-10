from __future__ import annotations

import json
import random
import re
from typing import Any, Dict, Iterable, List, Tuple

from app.services.content_resolver.models import Entry, RUBRIC_KEYS, ScoreResult


WORD_RE = re.compile(r"\b[\w'-]+\b")


def validate_input_entry(entry_text: str, min_words: int = 25, max_words: int = 25) -> Tuple[bool, str, int]:
    words = WORD_RE.findall(entry_text.strip())
    count = len(words)
    if count < min_words or count > max_words:
        return False, f"Entry must contain exactly {min_words} words", count
    return True, "Valid entry", count


def validate_score_payload(scores: Dict[str, int], reasoning: Dict[str, str]) -> Tuple[bool, List[str]]:
    errors: List[str] = []
    for key in RUBRIC_KEYS:
        value = scores.get(key)
        if value is None or not isinstance(value, int) or not (1 <= value <= 10):
            errors.append(f"{key} score must be integer in range 1..10")
        r = reasoning.get(key, "")
        if not isinstance(r, str) or len(r.strip()) < 8:
            errors.append(f"{key} reasoning must be present")
    return len(errors) == 0, errors


def load_rubric(path: str) -> Dict[str, str]:
    with open(path, "r", encoding="utf-8") as f:
        rubric = json.load(f)
    for key in RUBRIC_KEYS:
        if key not in rubric:
            raise ValueError(f"Missing rubric key: {key}")
    return rubric


def aggregate_scores(scores: Dict[str, int], weights: Dict[str, float]) -> Tuple[int, float]:
    total = sum(scores[k] for k in RUBRIC_KEYS)
    weighted = sum(scores[k] * weights.get(k, 0.0) for k in RUBRIC_KEYS)
    return total, round(weighted, 3)


def rank_results(results: Iterable[ScoreResult], shortlist_n: int = 5) -> Tuple[List[ScoreResult], List[ScoreResult]]:
    ranked = sorted(
        results,
        key=lambda x: (x.weighted_score, x.total_score, x.impact, x.creativity),
        reverse=True,
    )
    return ranked, ranked[:shortlist_n]


def cross_check(first: Dict[str, int], second: Dict[str, int], tolerance: int = 2) -> Dict[str, Any]:
    diffs = {}
    for key in RUBRIC_KEYS:
        a, b = first[key], second[key]
        gap = abs(a - b)
        if gap > tolerance:
            diffs[key] = {"primary": a, "secondary": b, "difference": gap}
    return {"is_consistent": len(diffs) == 0, "differences": diffs}


def heuristic_score(
    entry: Entry,
    rubric: Dict[str, str],
    agent_seed: int,
    subject_name: str,
    subject_description: str | None = None,
) -> Tuple[Dict[str, int], Dict[str, str]]:
    """
    Deterministic-ish heuristic scoring for MVP.
    Replace with LLM/API call in master app integration.
    """
    randomizer = random.Random(agent_seed + entry.id)
    words = WORD_RE.findall(entry.text)
    word_count = len(words)
    punctuation = len(re.findall(r"[,.!?;:]", entry.text))
    lowered = [w.lower() for w in words]
    unique_ratio = len(set(lowered)) / max(word_count, 1)
    urgency_terms = [w for w in ("must", "now", "future", "change", "urgent", "collapse") if w in lowered]
    sentiment_push = 1 if urgency_terms else 0
    topic_terms = [w for w in ("nature", "climate", "ecosystems", "biodiversity", "humans", "planet") if w in lowered]
    subject_tokens = {
        w.lower()
        for w in WORD_RE.findall(subject_name + " " + (subject_description or ""))
        if len(w) > 3
    }
    subject_hits = sorted(set(lowered).intersection(subject_tokens))
    subject_boost = 1 if subject_hits else -1

    relevance = min(10, max(1, 5 + (word_count == 25) + subject_boost + randomizer.randint(-1, 2)))
    creativity = min(10, max(1, int(4 + unique_ratio * 8) + randomizer.randint(-1, 1)))
    clarity = min(10, max(1, 6 + (punctuation > 1) + randomizer.randint(-2, 1)))
    impact = min(10, max(1, 5 + sentiment_push + randomizer.randint(-1, 2)))

    scores = {
        "relevance": relevance,
        "creativity": creativity,
        "clarity": clarity,
        "impact": impact,
    }

    reasoning = {
        "relevance": (
            f"Subject '{subject_name}' alignment via tokens {subject_hits[:4] or ['none']} "
            f"plus topical cues {topic_terms[:3] or ['general-topic']}; {rubric['relevance']} (score {relevance})."
        ),
        "creativity": (
            f"Lexical uniqueness ratio is {unique_ratio:.2f} with varied phrasing, "
            f"supporting {rubric['creativity']} (score {creativity})."
        ),
        "clarity": (
            f"Sentence uses {punctuation} punctuation marks across {word_count} words, "
            f"informing readability under {rubric['clarity']} (score {clarity})."
        ),
        "impact": (
            f"Detected urgency terms {urgency_terms[:3] or ['none']} and assertive tone, "
            f"guiding {rubric['impact']} (score {impact})."
        ),
    }
    return scores, reasoning

