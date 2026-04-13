"""Question-bank upload, PDF parsing, dedup, and DB persistence."""

from __future__ import annotations

import json
import os
import random
import re
import secrets
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import func, select

from app.core.app_logger import log_error, log_info, log_warn
from app.core.service_guard import guarded_service
from app.db import engine, session_scope
from app.models import File, QuizQuestion
from app.services.quiz_gemini import extract_question_bank_mcqs_via_gemini, gemini_api_key_configured
from app.services.quiz_service import questions_per_attempt_for_question_bank

REPO_ROOT = Path(__file__).resolve().parents[3]
QBANKS_DIR = REPO_ROOT / "qbanks"
QBANK_PENDING_DIR = QBANKS_DIR / "pending"
PENDING_ID_RE = re.compile(r"^[A-Za-z0-9._-]{16,128}$")


def _remove_qbank_pdf_after_processing(path: Path, *, file_name: str, outcome: str) -> None:
    """Drop temporary upload PDF once text is in DB (or after a failed parse)."""
    try:
        resolved = path.resolve()
        if not resolved.is_file():
            log_warn(
                "Question bank: PDF cleanup skipped (not a file)",
                file_name=file_name,
                path=str(resolved),
                outcome=outcome,
            )
            return
        qb = QBANKS_DIR.resolve()
        if resolved.parent != qb:
            log_warn(
                "Question bank: PDF cleanup skipped (path outside qbanks dir)",
                file_name=file_name,
                path=str(resolved),
                outcome=outcome,
            )
            return
        path.unlink()
        log_info(
            "Question bank: removed uploaded PDF from disk after processing",
            file_name=file_name,
            path=str(resolved),
            outcome=outcome,
        )
    except OSError as e:
        log_warn(
            "Question bank: could not remove uploaded PDF",
            file_name=file_name,
            path=str(path),
            outcome=outcome,
            error=str(e),
        )


@dataclass
class ParsedQuestion:
    question: str
    options: list[str]
    correct_index: int


@dataclass
class UploadQuestionBankResult:
    file_id: int
    file_name: str
    inserted_questions: int
    deduped_questions: int
    used_ollama: bool = False
    used_gemini: bool = False


@dataclass
class QuestionBankUploadOutcome:
    """Result of POST upload: either stored rows, a fatal error, or a pending Gemini confirmation step."""

    ok: bool
    result: UploadQuestionBankResult | None = None
    pending_gemini: bool = False
    pending_id: str | None = None
    gemini_prompt_reason: str | None = None
    error_message: str | None = None
    suggest_upload_individually: bool = False


def _clean_text(s: str) -> str:
    return " ".join((s or "").strip().split())


def _safe_filename(name: str) -> str:
    base = Path(name).name
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", base)
    if not base.lower().endswith(".pdf"):
        base += ".pdf"
    return base[:240]


def _extract_pdf_text(pdf_path: Path) -> tuple[str, int]:
    try:
        import pdfplumber
    except Exception as e:
        raise RuntimeError("pdfplumber is required for question-bank upload parsing") from e
    parts: list[str] = []
    page_count = 0
    with pdfplumber.open(str(pdf_path)) as pdf:
        page_count = len(pdf.pages)
        for page in pdf.pages:
            t = page.extract_text() or ""
            if t.strip():
                parts.append(t.strip())
    return "\n".join(parts), page_count


_Q_SPLIT = re.compile(r"(?:^|\n)\s*(?:Q(?:uestion)?\s*)?(\d+)[\).:\-]\s+", re.IGNORECASE)
# Option lines: A. x / A) x / A: x / A x / A-x / A5 (letter glued to digit). "Answer:" is not matched (no delimiter after A).
_OPT_RE = re.compile(
    r"(?:^|\n)\s*([A-D])(?:(?:[\).:]\s*|\-\s*|\s+)|(?=\d))([^\n]+)",
    re.IGNORECASE,
)
_BULLET_LINE = re.compile(r"^\s*-\s+(.+)$", re.MULTILINE)


def _parse_answer_line(chunk: str) -> str | None:
    """Match 'Answer: …' or 'Correct answer: …' on a line; avoid treating 'Correct…' as letter C."""
    for line in chunk.split("\n"):
        line_st = line.strip()
        m = re.match(r"^(?:Answer|Correct(?:\s+Answer)?)\s*[:\-]\s*(.+)$", line_st, re.IGNORECASE)
        if m:
            return _clean_text(m.group(1))
    return None


def _resolve_correct_index(answer: str | None, options: list[str]) -> int:
    if not answer:
        return 0
    a = answer.strip()
    if len(a) == 1 and a.upper() in "ABCD":
        return "ABCD".index(a.upper())
    al = a.lower()
    for idx, o in enumerate(options):
        if o.lower() == al:
            return idx
    for idx, o in enumerate(options):
        if al in o.lower() or o.lower() in al:
            return idx
    return 0


def _parse_bullet_chunk(chunk: str) -> ParsedQuestion | None:
    """Options as '- option text' lines (common in PDFs); answer line 'Answer: …' matches one option."""
    bullets = _BULLET_LINE.findall(chunk)
    if len(bullets) < 4:
        return None
    options = [_clean_text(b) for b in bullets[:4]]
    first = _BULLET_LINE.search(chunk)
    if not first:
        return None
    q_text = _clean_text(chunk[: first.start()].strip())
    if not q_text:
        return None
    ans = _parse_answer_line(chunk)
    correct_idx = _resolve_correct_index(ans, options)
    return ParsedQuestion(question=q_text, options=options, correct_index=correct_idx)


def _parse_letter_chunk(chunk: str) -> ParsedQuestion | None:
    opts = _OPT_RE.findall(chunk)
    if len(opts) < 4:
        return None
    options_by_letter: dict[str, str] = {}
    for letter, val in opts:
        k = letter.upper()
        if k in ("A", "B", "C", "D") and k not in options_by_letter:
            options_by_letter[k] = _clean_text(val)
    if len(options_by_letter) < 4:
        return None
    head = _OPT_RE.split(chunk, maxsplit=1)[0]
    q_text = _clean_text(head)
    if not q_text:
        return None
    options = [
        options_by_letter["A"],
        options_by_letter["B"],
        options_by_letter["C"],
        options_by_letter["D"],
    ]
    ans = _parse_answer_line(chunk)
    correct_idx = _resolve_correct_index(ans, options)
    return ParsedQuestion(question=q_text, options=options, correct_index=correct_idx)


def _chunk_looks_like_bullet_mcq(chunk: str) -> bool:
    bullets = _BULLET_LINE.findall(chunk)
    if len(bullets) < 4:
        return False
    return bool(re.search(r"(?:Answer|Correct(?:\s+Answer)?)\s*[:\-]", chunk, re.IGNORECASE))


def _parse_single_chunk(chunk: str) -> ParsedQuestion | None:
    pq = _parse_letter_chunk(chunk)
    if pq is not None:
        return pq
    return _parse_bullet_chunk(chunk)


def _parsed_questions_from_gemini_rows(rows: list[dict[str, Any]]) -> list[ParsedQuestion]:
    out: list[ParsedQuestion] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        q_text = _clean_text(str(row.get("question", "")))
        if not q_text:
            continue
        raw_opts = row.get("options")
        if not isinstance(raw_opts, list):
            continue
        options = [_clean_text(str(x)) for x in raw_opts]
        options = [o for o in options if o]
        if len(options) < 2:
            continue
        options = options[:4]
        ci_raw = row.get("correct_index")
        if isinstance(ci_raw, int) and not isinstance(ci_raw, bool):
            correct_idx = max(0, min(len(options) - 1, ci_raw))
        else:
            ans = row.get("correct_answer")
            if ans is None:
                ans = row.get("answer")
            correct_idx = _resolve_correct_index(
                _clean_text(str(ans)) if ans is not None else None,
                options,
            )
        out.append(ParsedQuestion(question=q_text, options=options, correct_index=correct_idx))
    return out


def _parse_questions_from_text(raw: str) -> list[ParsedQuestion]:
    text = raw.replace("\r\n", "\n").replace("\r", "\n")
    hits = list(_Q_SPLIT.finditer(text))
    chunks: list[str] = []
    if not hits:
        t = text.strip()
        if t and _chunk_looks_like_bullet_mcq(t):
            chunks = [t]
    else:
        for i, m in enumerate(hits):
            start = m.end()
            end = hits[i + 1].start() if i + 1 < len(hits) else len(text)
            chunks.append(text[start:end].strip())
    out: list[ParsedQuestion] = []
    for chunk in chunks:
        if not chunk:
            continue
        pq = _parse_single_chunk(chunk)
        if pq is not None:
            out.append(pq)
    return out


def _dedup_indices_sentence_transformers(questions: list[str], threshold: float = 0.9) -> set[int]:
    try:
        from sentence_transformers import SentenceTransformer
        from sklearn.metrics.pairwise import cosine_similarity
    except Exception:
        return set()
    model_name = os.environ.get("QUESTION_DEDUP_EMBED_MODEL", "all-MiniLM-L6-v2")
    model = SentenceTransformer(model_name)
    embeddings = model.encode(questions, convert_to_numpy=True)
    sim = cosine_similarity(embeddings)
    dup: set[int] = set()
    for i in range(len(questions)):
        if i in dup:
            continue
        for j in range(i + 1, len(questions)):
            if sim[i][j] >= threshold:
                dup.add(j)
    return dup


def _dedup_indices_sklearn(questions: list[str], threshold: float = 0.92) -> set[int]:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity

    vec = TfidfVectorizer().fit_transform(questions)
    sim = cosine_similarity(vec)
    dup: set[int] = set()
    for i in range(len(questions)):
        if i in dup:
            continue
        for j in range(i + 1, len(questions)):
            if sim[i][j] >= threshold:
                dup.add(j)
    return dup


def _fallback_decoys_with_ollama(question: str, correct: str) -> list[str] | None:
    try:
        import requests
    except Exception:
        return None
    url = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/") + "/api/generate"
    model = os.environ.get("OLLAMA_MODEL", "llama3")
    prompt = (
        "Generate exactly 3 short, plausible but incorrect decoy answers for this question.\n"
        f"Question: {question}\n"
        f"Correct answer: {correct}\n"
        "Return exactly 3 lines only, no numbering."
    )
    try:
        r = requests.post(
            url,
            json={"model": model, "prompt": prompt, "stream": False},
            timeout=10,
        )
        r.raise_for_status()
        text = str((r.json() or {}).get("response") or "")
        lines = [_clean_text(x) for x in text.splitlines() if _clean_text(x)]
        uniq: list[str] = []
        for line in lines:
            if line.lower() == correct.lower():
                continue
            if line not in uniq:
                uniq.append(line)
            if len(uniq) == 3:
                return uniq
    except Exception:
        return None
    return None


def _ensure_four_options(q: ParsedQuestion, *, file_name: str) -> tuple[ParsedQuestion, bool]:
    """Returns (question, True) if Ollama supplied decoys; else (question, False)."""
    opts = [_clean_text(x) for x in q.options if _clean_text(x)]
    if len(opts) >= 4:
        return q, False
    correct = opts[q.correct_index] if 0 <= q.correct_index < len(opts) else (opts[0] if opts else "")
    log_info(
        "Question bank: fewer than 4 options; trying Ollama decoys",
        file_name=file_name,
        question_preview=(q.question[:120] + "…") if len(q.question) > 120 else q.question,
    )
    decoys = _fallback_decoys_with_ollama(q.question, correct)
    if decoys:
        log_info(
            "Question bank: Ollama returned decoy answers",
            file_name=file_name,
            decoy_count=len(decoys),
        )
        opts = [correct, *decoys]
        random.shuffle(opts)
        cidx = opts.index(correct)
        return ParsedQuestion(question=q.question, options=opts, correct_index=cidx), True
    log_warn(
        "Question bank: Ollama unavailable or failed; using placeholder options",
        file_name=file_name,
    )
    while len(opts) < 4:
        opts.append(f"Option {chr(ord('A') + len(opts))}")
    cidx = min(max(q.correct_index, 0), 3)
    return ParsedQuestion(question=q.question, options=opts[:4], correct_index=cidx), False


def _register_pending_gemini_upload(
    *,
    source_pdf: Path,
    stored_file_name: str,
    original_file_name: str,
    actor_user_id: int | None,
    failure_reason: str,
) -> str:
    QBANK_PENDING_DIR.mkdir(parents=True, exist_ok=True)
    pending_id = secrets.token_urlsafe(32)
    dest_pdf = QBANK_PENDING_DIR / f"{pending_id}.pdf"
    dest_meta = QBANK_PENDING_DIR / f"{pending_id}.json"
    shutil.move(str(source_pdf.resolve()), str(dest_pdf))
    meta = {
        "original_file_name": original_file_name,
        "stored_file_name": stored_file_name,
        "actor_user_id": actor_user_id,
        "failure_reason": failure_reason,
    }
    dest_meta.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    log_info(
        "Question bank: pending Gemini confirmation registered",
        pending_id=pending_id,
        stored_file_name=stored_file_name,
    )
    return pending_id


def _delete_pending_pair(pending_id: str) -> None:
    if not PENDING_ID_RE.match(pending_id):
        return
    for ext in (".pdf", ".json"):
        p = QBANK_PENDING_DIR / f"{pending_id}{ext}"
        try:
            p.unlink(missing_ok=True)
        except OSError:
            pass


def _load_pending_meta(pending_id: str) -> dict[str, Any]:
    if not PENDING_ID_RE.match(pending_id):
        raise ValueError("Invalid pending id")
    meta_path = QBANK_PENDING_DIR / f"{pending_id}.json"
    if not meta_path.is_file():
        raise FileNotFoundError("Unknown or expired pending upload")
    return json.loads(meta_path.read_text(encoding="utf-8"))


def pending_question_bank_pdf_path(pending_id: str) -> Path:
    if not PENDING_ID_RE.match(pending_id):
        raise ValueError("Invalid pending id")
    p = (QBANK_PENDING_DIR / f"{pending_id}.pdf").resolve()
    if p.parent != QBANK_PENDING_DIR.resolve():
        raise ValueError("Invalid pending id")
    if not p.is_file():
        raise FileNotFoundError("Pending PDF missing or expired")
    return p


def _complete_upload_from_parsed(
    *,
    parsed: list[ParsedQuestion],
    stored_file_name: str,
    actor_user_id: int | None,
    min_required: int,
    used_gemini: bool,
) -> UploadQuestionBankResult:
    if not parsed:
        raise ValueError("No questions to store")
    log_info(
        "Question bank: reading from file; questions and answers found",
        file_name=stored_file_name,
        parsed_blocks=len(parsed),
        used_gemini=used_gemini,
    )
    ensured: list[tuple[ParsedQuestion, bool]] = [
        _ensure_four_options(q, file_name=stored_file_name) for q in parsed
    ]
    parsed = [p for p, _ in ensured]
    used_ollama = any(used for _, used in ensured)
    q_texts = [q.question for q in parsed]
    dup_idx = _dedup_indices_sentence_transformers(q_texts)
    if dup_idx:
        dedup_method = "sentence_transformers"
    else:
        try:
            dup_idx = _dedup_indices_sklearn(q_texts)
            dedup_method = "sklearn_tfidf" if dup_idx else "sentence_transformers_then_sklearn"
        except Exception:
            dup_idx = set()
            dedup_method = "sentence_transformers_only_sklearn_failed"
    filtered = [q for i, q in enumerate(parsed) if i not in dup_idx]
    if not filtered:
        raise ValueError("All parsed questions were duplicates")
    log_info(
        "Question bank: deduplication pass",
        file_name=stored_file_name,
        method=dedup_method,
        before=len(parsed),
        duplicates_removed=len(dup_idx),
        after=len(filtered),
    )
    if len(filtered) < min_required:
        raise ValueError(
            f"After deduplication this PDF yields {len(filtered)} distinct question(s), but Quiz settings "
            f"require at least {min_required} (questions per attempt). Add more distinct questions to the PDF "
            f"or lower “Questions per attempt” in Quiz settings."
        )
    filtered = filtered[:min_required]

    with session_scope() as session:
        frow = File(
            file_name=stored_file_name,
            created_by=actor_user_id,
            updated_by=actor_user_id,
            is_deleted=False,
        )
        session.add(frow)
        session.flush()
        fid = int(frow.id)
        log_info(
            "Question bank: inserted files row",
            file_id=fid,
            file_name=stored_file_name,
        )
        inserted = 0
        skipped_incomplete = 0
        for q in filtered:
            correct = q.options[q.correct_index]
            decoys = [opt for i, opt in enumerate(q.options) if i != q.correct_index][:3]
            if len(decoys) < 3:
                skipped_incomplete += 1
                continue
            session.add(
                QuizQuestion(
                    file_id=fid,
                    question_text=q.question,
                    correct_answer=correct,
                    decoy_1=decoys[0],
                    decoy_2=decoys[1],
                    decoy_3=decoys[2],
                    is_active=True,
                    is_deleted=False,
                    created_by=actor_user_id,
                    updated_by=actor_user_id,
                )
            )
            inserted += 1
        if inserted == 0 and filtered:
            log_error(
                "Question bank: no quiz_questions stored after parse (all candidates skipped)",
                file_name=stored_file_name,
                file_id=fid,
                filtered_count=len(filtered),
                skipped_incomplete=skipped_incomplete,
            )
            raise ValueError(
                "No questions could be stored: every parsed question had fewer than 3 decoy answers after processing."
            )
        session.flush()
        if skipped_incomplete:
            log_info(
                "Question bank: skipped questions with fewer than 3 decoys after parsing",
                file_name=stored_file_name,
                file_id=fid,
                skipped_count=skipped_incomplete,
            )
        log_info(
            "Question bank: inserted rows into quiz_questions",
            file_id=fid,
            file_name=stored_file_name,
            rows_inserted=inserted,
            table="quiz_questions",
        )

    log_info(
        "Question bank: upload pipeline finished successfully",
        file_name=stored_file_name,
        file_id=fid,
        questions_stored=inserted,
        deduped_questions=len(dup_idx),
        used_ollama=used_ollama,
        used_gemini=used_gemini,
    )
    return UploadQuestionBankResult(
        file_id=fid,
        file_name=stored_file_name,
        inserted_questions=inserted,
        deduped_questions=len(dup_idx),
        used_ollama=used_ollama,
        used_gemini=used_gemini,
    )


@guarded_service("question_bank.cancel_pending_question_bank")
def cancel_pending_question_bank(*, pending_id: str) -> None:
    if not PENDING_ID_RE.match(pending_id):
        raise ValueError("Invalid pending id")
    _load_pending_meta(pending_id)
    _delete_pending_pair(pending_id)
    log_info("Question bank: pending Gemini upload cancelled", pending_id=pending_id)


@guarded_service("question_bank.confirm_question_bank_gemini")
def confirm_question_bank_gemini(*, pending_id: str, actor_user_id: int | None) -> UploadQuestionBankResult:
    if engine() is None:
        raise RuntimeError("Database not configured")
    if not gemini_api_key_configured():
        raise ValueError("GEM_KEY (or GOOGLE_API_KEY) is not set; Gemini extraction is unavailable.")
    _load_pending_meta(pending_id)
    pdf_path = pending_question_bank_pdf_path(pending_id)
    pdf_bytes = pdf_path.read_bytes()
    meta = _load_pending_meta(pending_id)
    stored_file_name = str(meta.get("stored_file_name") or "upload.pdf")
    min_required = questions_per_attempt_for_question_bank()

    gem_rows: list[dict[str, Any]] = []
    raw = ""
    try:
        raw, _ = _extract_pdf_text(pdf_path)
    except Exception as e:
        log_warn(
            "Question bank: pdfplumber re-read failed before Gemini; will send PDF bytes only",
            file_name=stored_file_name,
            error=str(e),
        )
    if raw.strip():
        try:
            gem_rows = extract_question_bank_mcqs_via_gemini(text=raw, file_name=stored_file_name)
        except Exception as e:
            log_warn(
                "Question bank: Gemini extraction from text failed (confirm flow)",
                file_name=stored_file_name,
                error=str(e),
            )
    if not gem_rows:
        gem_rows = extract_question_bank_mcqs_via_gemini(
            pdf_bytes=pdf_bytes,
            file_name=stored_file_name,
        )
    parsed = _parsed_questions_from_gemini_rows(gem_rows)
    if not parsed:
        raise ValueError("Gemini could not extract any multiple-choice questions from this PDF.")
    try:
        result = _complete_upload_from_parsed(
            parsed=parsed,
            stored_file_name=stored_file_name,
            actor_user_id=actor_user_id,
            min_required=min_required,
            used_gemini=True,
        )
    except Exception:
        raise
    else:
        _delete_pending_pair(pending_id)
    return result


@guarded_service("question_bank.list_question_banks")
def list_question_banks() -> list[dict[str, Any]]:
    if engine() is None:
        return []
    with session_scope() as session:
        rows = session.execute(
            select(File).where(File.is_deleted.is_(False)).order_by(File.created_at.desc(), File.id.desc())
        ).scalars().all()
        out: list[dict[str, Any]] = []
        for f in rows:
            q_count = session.execute(
                select(func.count()).select_from(QuizQuestion).where(
                    QuizQuestion.file_id == f.id,
                    QuizQuestion.is_deleted.is_(False),
                    QuizQuestion.is_active.is_(True),
                )
            ).scalar_one()
            out.append(
                {
                    "id": int(f.id),
                    "file_name": f.file_name,
                    "created_at": f.created_at.isoformat() if f.created_at else None,
                    "created_by": int(f.created_by) if f.created_by is not None else None,
                    "updated_at": f.updated_at.isoformat() if f.updated_at else None,
                    "updated_by": int(f.updated_by) if f.updated_by is not None else None,
                    "is_deleted": bool(f.is_deleted),
                    "question_count": int(q_count or 0),
                }
            )
        return out


def _batch_gemini_blocked_message(*, file_name: str, technical_detail: str) -> str:
    return (
        f"{technical_detail} When several PDFs are uploaded together, each one must succeed with the "
        "built-in extractor. Upload this file alone to preview it and optionally confirm Gemini extraction: "
        f'"{file_name}".'
    )


@guarded_service("question_bank.upload_question_bank")
def upload_question_bank(
    *,
    file_name: str,
    content: bytes,
    actor_user_id: int | None,
    allow_pending_gemini: bool = True,
) -> QuestionBankUploadOutcome:
    if engine() is None:
        raise RuntimeError("Database not configured")
    if not content:
        raise ValueError("Uploaded file is empty")
    log_info(
        "Question bank: upload received",
        original_file_name=file_name,
        bytes=len(content),
        actor_user_id=actor_user_id,
    )
    clean_name = _safe_filename(file_name)
    QBANKS_DIR.mkdir(parents=True, exist_ok=True)

    target = QBANKS_DIR / clean_name
    stem = target.stem
    suffix = target.suffix
    idx = 1
    while target.exists():
        target = QBANKS_DIR / f"{stem}_{idx}{suffix}"
        idx += 1
    target.write_bytes(content)
    log_info(
        "Question bank: PDF saved to disk successfully",
        file_name=target.name,
        path=str(target.resolve()),
        bytes=len(content),
    )

    fin: dict[str, str] = {"outcome": "processing_failed"}
    min_required = questions_per_attempt_for_question_bank()
    try:
        try:
            raw, page_count = _extract_pdf_text(target)
        except Exception as ex:
            msg = f"PDF text extraction failed ({ex.__class__.__name__}): {ex}"
            log_warn(
                "Question bank: pdfplumber extraction failed",
                file_name=target.name,
                error=str(ex),
            )
            if gemini_api_key_configured() and allow_pending_gemini:
                pid = _register_pending_gemini_upload(
                    source_pdf=target,
                    stored_file_name=target.name,
                    original_file_name=file_name,
                    actor_user_id=actor_user_id,
                    failure_reason=msg,
                )
                fin["outcome"] = "pending_gemini"
                return QuestionBankUploadOutcome(
                    ok=False,
                    pending_gemini=True,
                    pending_id=pid,
                    gemini_prompt_reason=msg,
                )
            fin["outcome"] = "failed"
            if gemini_api_key_configured() and not allow_pending_gemini:
                return QuestionBankUploadOutcome(
                    ok=False,
                    error_message=_batch_gemini_blocked_message(file_name=file_name, technical_detail=msg),
                    suggest_upload_individually=True,
                )
            return QuestionBankUploadOutcome(ok=False, error_message=msg)

        log_info(
            "Question bank: extracted text from PDF",
            file_name=target.name,
            pages=page_count,
            text_chars=len(raw),
        )
        parsed = _parse_questions_from_text(raw)
        if not parsed:
            msg = "No parsable multiple-choice questions were found with the built-in PDF text extractor."
            if not raw.strip():
                msg = (
                    "No text could be extracted from this PDF (it may be scanned, image-only, or protected)."
                )
            log_warn("Question bank: regex parse produced no questions", file_name=target.name)
            if gemini_api_key_configured() and allow_pending_gemini:
                pid = _register_pending_gemini_upload(
                    source_pdf=target,
                    stored_file_name=target.name,
                    original_file_name=file_name,
                    actor_user_id=actor_user_id,
                    failure_reason=msg,
                )
                fin["outcome"] = "pending_gemini"
                return QuestionBankUploadOutcome(
                    ok=False,
                    pending_gemini=True,
                    pending_id=pid,
                    gemini_prompt_reason=msg,
                )
            fin["outcome"] = "failed"
            if gemini_api_key_configured() and not allow_pending_gemini:
                return QuestionBankUploadOutcome(
                    ok=False,
                    error_message=_batch_gemini_blocked_message(file_name=file_name, technical_detail=msg),
                    suggest_upload_individually=True,
                )
            return QuestionBankUploadOutcome(
                ok=False,
                error_message=(
                    f"{msg} Configure GEM_KEY (or GOOGLE_API_KEY) on the server to optionally extract "
                    "with Google Gemini after you review the PDF in the admin console."
                ),
            )

        try:
            result = _complete_upload_from_parsed(
                parsed=parsed,
                stored_file_name=target.name,
                actor_user_id=actor_user_id,
                min_required=min_required,
                used_gemini=False,
            )
        except ValueError as e:
            fin["outcome"] = "failed"
            return QuestionBankUploadOutcome(ok=False, error_message=str(e))

        fin["outcome"] = "success"
        return QuestionBankUploadOutcome(ok=True, result=result)
    finally:
        if fin["outcome"] != "pending_gemini" and target.is_file():
            _remove_qbank_pdf_after_processing(
                target,
                file_name=target.name,
                outcome=fin["outcome"],
            )
