from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple
from urllib import error, request

from app.services.content_resolver.tools import aggregate_scores, validate_score_payload


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def llm_review_enabled() -> bool:
    return _env_bool("ENABLE_LLM_REVIEW", False)


def _utc_now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def review_with_openai(
    entry_text: str,
    rubric: Dict[str, str],
    weights: Dict[str, float],
    subject_name: str,
    subject_description: str | None = None,
    baseline_scores: Optional[Dict[str, Any]] = None,
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()
    if not api_key:
        return None, "OPENAI_API_KEY missing while ENABLE_LLM_REVIEW=true"

    prompt = {
        "task": "Evaluate a 25-word entry against rubric dimensions with integer scores 1..10.",
        "entry_text": entry_text,
        "subject_name": subject_name,
        "subject_description": subject_description,
        "rubric": rubric,
        "baseline_agentic_scores": baseline_scores,
        "response_schema": {
            "scores": {"relevance": "int 1..10", "creativity": "int 1..10", "clarity": "int 1..10", "impact": "int 1..10"},
            "reasoning": {
                "relevance": "short text",
                "creativity": "short text",
                "clarity": "short text",
                "impact": "short text",
            },
        },
        "rules": [
            "Return JSON only.",
            "No markdown.",
            "Reasoning text required for each dimension.",
        ],
    }

    body = {
        "model": model,
        "temperature": 0.1,
        "messages": [
            {"role": "system", "content": "You are a strict rubric evaluator that returns valid JSON only."},
            {"role": "user", "content": json.dumps(prompt, ensure_ascii=True, default=str)},
        ],
        "response_format": {"type": "json_object"},
    }
    req = request.Request(
        url="https://api.openai.com/v1/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        return None, f"OpenAI HTTP error {exc.code}: {detail}"
    except Exception as exc:  # noqa: BLE001
        return None, f"OpenAI request failed: {exc}"

    try:
        content = payload["choices"][0]["message"]["content"]
        parsed = json.loads(content)
        scores = parsed["scores"]
        reasoning = parsed["reasoning"]
        valid, errors = validate_score_payload(scores=scores, reasoning=reasoning)
        if not valid:
            return None, f"LLM output failed validation: {errors}"
        total, weighted = aggregate_scores(scores=scores, weights=weights)
        return {
            "agent": "llm",
            "relevance": int(scores["relevance"]),
            "creativity": int(scores["creativity"]),
            "clarity": int(scores["clarity"]),
            "impact": int(scores["impact"]),
            "total_score": total,
            "weighted_score": weighted,
            "reasoning": reasoning,
            "evaluated_at": _utc_now_iso(),
            "model": model,
        }, None
    except Exception as exc:  # noqa: BLE001
        return None, f"LLM parse failed: {exc}"

