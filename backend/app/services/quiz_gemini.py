"""PDF text extraction + Gemini JSON quiz generation (see sample.py)."""

from __future__ import annotations

import json
import os
import random
import re
import hashlib
from pathlib import Path
from typing import Any

import pypdf
from google import genai
from google.genai import types

from app.core.app_logger import log_error, log_info, log_warn
from app.services.redis_cache import get_redis_client

REPO_ROOT = Path(__file__).resolve().parents[3]
QBANKS_DIR = REPO_ROOT / "qbanks"

MAX_TEXT_CHARS = 12000

_QUIZ_PROMPT_VERSION = "v1"


def _cache_ttl_seconds() -> int:
    raw = os.environ.get("QUIZ_CACHE_TTL_SECONDS", "604800").strip() or "604800"
    try:
        return max(60, int(raw))
    except Exception:
        return 604800


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _quiz_cache_key(*, pdf_sha256: str, model: str) -> str:
    # Include model + prompt version to avoid cross-model / cross-prompt pollution.
    return f"quiz:pdf:{pdf_sha256}:model:{model}:prompt:{_QUIZ_PROMPT_VERSION}"


def _cache_get_raw_questions(cache_key: str) -> list[dict[str, Any]] | None:
    r = get_redis_client()
    if r is None:
        return None
    try:
        raw = r.get(cache_key)
        if not raw:
            return None
        data = json.loads(raw)
        if not isinstance(data, list):
            return None
        return [x for x in data if isinstance(x, dict)]
    except Exception as e:
        log_warn("Redis cache read failed; continuing without cache", exc=e)
        return None


def _cache_set_raw_questions(cache_key: str, raw_questions: list[dict[str, Any]]) -> None:
    r = get_redis_client()
    if r is None:
        return
    try:
        r.setex(cache_key, _cache_ttl_seconds(), json.dumps(raw_questions))
    except Exception as e:
        log_warn("Redis cache write failed; continuing without cache", exc=e)


def _normalize_extracted_pdf_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _strip_markdown_json_fence(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        lines = s.split("\n")
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        s = "\n".join(lines).strip()
    return s


def _extract_balanced_json_array(s: str) -> str | None:
    """Find first top-level `[` ... `]` slice respecting strings (handles stray prose around JSON)."""
    start = s.find("[")
    if start == -1:
        return None
    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(s)):
        c = s[i]
        if in_string:
            if escape:
                escape = False
            elif c == "\\":
                escape = True
            elif c == '"':
                in_string = False
            continue
        if c == '"':
            in_string = True
        elif c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                return s[start : i + 1]
    return None


def _coerce_to_question_list(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    if isinstance(data, dict):
        for key in ("questions", "items", "quiz", "data"):
            v = data.get(key)
            if isinstance(v, list):
                return [x for x in v if isinstance(x, dict)]
    raise ValueError("JSON must be an array of question objects, or an object with a 'questions' array")


def parse_json_quiz_from_model_text(raw: str) -> list[dict[str, Any]]:
    """
    Parse Gemini output into a list of question dicts.
    Handles: strict JSON, markdown fences, leading/trailing prose, wrapper objects.
    """
    text = raw.strip()
    if text.startswith("\ufeff"):
        text = text[1:]
    text = _strip_markdown_json_fence(text)

    last_err: Exception | None = None
    for candidate in (text, _extract_balanced_json_array(text) or ""):
        if not candidate:
            continue
        candidate = candidate.strip()
        try:
            data = json.loads(candidate)
            return _coerce_to_question_list(data)
        except (json.JSONDecodeError, ValueError, TypeError) as e:
            last_err = e
            continue

    raise ValueError("Could not parse JSON quiz from model response") from last_err


def _api_key() -> str:
    return os.environ.get("GEM_KEY", "").strip() or os.environ.get("GOOGLE_API_KEY", "").strip()


def gemini_model_name() -> str:
    return os.environ.get("QUIZ_GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"


def _gemini_preflight_timeout_ms() -> int:
    """Milliseconds for genai HttpOptions.timeout (preflight ping only)."""
    raw = os.environ.get("GEMINI_PREFLIGHT_TIMEOUT_MS", "20000").strip() or "20000"
    try:
        return max(3000, int(raw))
    except ValueError:
        return 20000


def verify_gemini_service_ready() -> tuple[bool, str | None]:
    """
    Lightweight ping: same API key + model as quiz generation.
    Returns (True, None) if the model accepts a minimal request, else (False, error message).
    """
    key = _api_key()
    if not key:
        return False, "GEM_KEY (or GOOGLE_API_KEY) is not set"

    try:
        timeout_ms: int = _gemini_preflight_timeout_ms()
        client = genai.Client(
            api_key=key,
            http_options=types.HttpOptions(timeout=timeout_ms),
        )
        response = client.models.generate_content(
            model=gemini_model_name(),
            contents='Reply with exactly the single word "OK" and nothing else.',
            config=types.GenerateContentConfig(max_output_tokens=32),
        )
        text = (response.text or "").strip()
        if not text:
            return False, "Gemini returned an empty response (check model name and billing)"
        return True, None
    except Exception as e:
        log_error(
            "Gemini readiness check failed (model ping)",
            exc=e,
            model=gemini_model_name(),
        )
        return False, str(e)


def extract_text_from_pdf(pdf_path: Path) -> str:
    try:
        reader = pypdf.PdfReader(str(pdf_path))
        if getattr(reader, "is_encrypted", False):
            if reader.decrypt("") == 0:
                raise RuntimeError(
                    "PDF is password-protected; use an unencrypted copy or set the password in code"
                )
        parts: list[str] = []
        for page in reader.pages:
            t = page.extract_text()
            if t:
                parts.append(t.strip())
        if not parts:
            return ""
        combined = "\n\n".join(parts)
        normalized = _normalize_extracted_pdf_text(combined)
        return normalized[:MAX_TEXT_CHARS]
    except Exception as e:
        log_error(
            "PDF text extraction failed (pypdf read or corrupt PDF)",
            exc=e,
            pdf_path=str(pdf_path.resolve()),
        )
        raise


def generate_quiz_json(
    raw_text: str,
    *,
    pdf_path: str | None = None,
) -> list[dict[str, Any]]:
    key = _api_key()
    if not key:
        raise RuntimeError("GEM_KEY (or GOOGLE_API_KEY) is not set in the environment")

    try:
        client = genai.Client(api_key=key)

        prompt = f"""
The following text contains questions and their correct answers.
1. Identify each question and its correct answer.
2. For every question, create 3 additional plausible but incorrect multiple-choice options (distractors).
3. Output ONLY a single valid JSON array (no markdown, no code fences, no prose before or after).
4. Use straight double quotes in JSON. Escape any double quotes inside strings with backslash.

Schema for each element:
[
  {{
    "question": "The text of the question",
    "options": ["Correct Answer", "Distractor 1", "Distractor 2", "Distractor 3"],
    "answer": "Correct Answer"
  }}
]

Text to process:
{raw_text}
"""

        response = client.models.generate_content(
            model=gemini_model_name(),
            contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
        text = (response.text or "").strip()
        if not text:
            raise RuntimeError("Gemini returned empty response body")

        data = parse_json_quiz_from_model_text(text)

        if not data:
            raise RuntimeError("Gemini returned no questions after parsing")
        log_info(
            "Gemini quiz JSON parsed successfully",
            pdf_path=pdf_path or "unknown",
            question_count=len(data),
        )
        return data
    except Exception as e:
        log_error(
            "Gemini quiz JSON generation failed (parse or API error)",
            exc=e,
            pdf_path=pdf_path or "unknown",
            model=gemini_model_name(),
            raw_text_chars=len(raw_text),
        )
        raise


def shuffle_questions_for_attempt(raw_questions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Shuffle options per question; store correct_index in shuffled order."""
    out: list[dict[str, Any]] = []
    for q in raw_questions:
        question = str(q.get("question", "")).strip()
        answer = str(q.get("answer", "")).strip()
        options = q.get("options")
        if not isinstance(options, list) or len(options) < 2:
            continue
        opts = [str(o).strip() for o in options]
        if answer not in opts:
            continue
        random.shuffle(opts)
        correct_index = opts.index(answer)
        out.append(
            {
                "question": question,
                "options": opts,
                "correct_index": correct_index,
            }
        )
    return out


def load_and_build_quiz(pdf_path: Path) -> list[dict[str, Any]]:
    pstr = str(pdf_path.resolve())
    model = gemini_model_name()

    raw_list: list[dict[str, Any]] | None = None
    cache_key: str | None = None
    try:
        pdf_sha = _sha256_file(pdf_path)
        cache_key = _quiz_cache_key(pdf_sha256=pdf_sha, model=model)
        raw_list = _cache_get_raw_questions(cache_key)
        if raw_list is not None:
            log_info(
                "Quiz loaded from Redis cache",
                pdf_path=pstr,
                model=model,
                question_count=len(raw_list),
            )
    except Exception as e:
        # Hashing/cache should never block quiz generation.
        log_warn(
            "Quiz cache precheck failed; continuing without cache",
            exc=e,
            pdf_path=pstr,
            model=model,
        )

    if raw_list is None:
        raw = extract_text_from_pdf(pdf_path)
        if not raw.strip():
            log_warn("No text extracted from PDF (empty or unreadable)", pdf_path=pstr)
            raise RuntimeError("No text extracted from PDF")
        raw_list = generate_quiz_json(raw, pdf_path=pstr)
        if cache_key:
            _cache_set_raw_questions(cache_key, raw_list)
            log_info(
                "Quiz stored in Redis cache",
                pdf_path=pstr,
                model=model,
                question_count=len(raw_list),
            )
    try:
        return shuffle_questions_for_attempt(raw_list)
    except Exception as e:
        log_error("shuffle_questions_for_attempt failed", exc=e, pdf_path=pstr)
        raise
