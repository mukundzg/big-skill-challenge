"""PDF text extraction + Gemini JSON quiz generation (see sample.py)."""

from __future__ import annotations

import json
import os
import random
from pathlib import Path
from typing import Any

import google.generativeai as genai
import pypdf

REPO_ROOT = Path(__file__).resolve().parents[3]
QBANKS_DIR = REPO_ROOT / "qbanks"

MAX_TEXT_CHARS = 12000


def _api_key() -> str:
    return os.environ.get("GEM_KEY", "").strip() or os.environ.get("GOOGLE_API_KEY", "").strip()


def gemini_model_name() -> str:
    return os.environ.get("QUIZ_GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"


def verify_gemini_service_ready() -> tuple[bool, str | None]:
    """
    Lightweight ping: same API key + model as quiz generation.
    Returns (True, None) if the model accepts a minimal request, else (False, error message).
    """
    key = _api_key()
    if not key:
        return False, "GEM_KEY (or GOOGLE_API_KEY) is not set"

    try:
        genai.configure(api_key=key)
        model = genai.GenerativeModel(gemini_model_name())
        response = model.generate_content(
            'Reply with exactly the single word "OK" and nothing else.',
            generation_config={"max_output_tokens": 32},
        )
        text = (response.text or "").strip()
        if not text:
            return False, "Gemini returned an empty response (check model name and billing)"
        return True, None
    except Exception as e:
        return False, str(e)


def extract_text_from_pdf(pdf_path: Path) -> str:
    reader = pypdf.PdfReader(str(pdf_path))
    text = ""
    for page in reader.pages:
        t = page.extract_text()
        if t:
            text += t
    return text[:MAX_TEXT_CHARS]


def generate_quiz_json(raw_text: str) -> list[dict[str, Any]]:
    key = _api_key()
    if not key:
        raise RuntimeError("GEM_KEY (or GOOGLE_API_KEY) is not set in the environment")

    genai.configure(api_key=key)
    model = genai.GenerativeModel(gemini_model_name())

    prompt = f"""
The following text contains questions and their correct answers.
1. Identify each question and its correct answer.
2. For every question, create 3 additional plausible but incorrect multiple-choice options (distractors).
3. Return the result strictly as a valid JSON array of objects.

JSON Structure:
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

    response = model.generate_content(
        prompt,
        generation_config={"response_mime_type": "application/json"},
    )
    text = response.text or ""
    data = json.loads(text)
    if not isinstance(data, list) or not data:
        raise RuntimeError("Gemini returned no questions")
    return data


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
    raw = extract_text_from_pdf(pdf_path)
    if not raw.strip():
        raise RuntimeError("No text extracted from PDF")
    raw_list = generate_quiz_json(raw)
    return shuffle_questions_for_attempt(raw_list)
