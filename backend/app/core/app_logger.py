"""
Central application logger (loguru): daily file + stderr by default. All services import from here.

Each line looks like:
  2026-04-06_12:12:12:003|||info|||some_file.py|||some_func|||...message...
  2026-04-06_12:12:12:003|||error|||some_file.py|||some_func|||...message... : in line number 569

The `: in line number N` suffix is appended only for error-level lines (ERROR/CRITICAL).

Levels: debug, info, warn, error (lowercase). Filename/function identify the app callsite;
for exceptions on error logs, that is the caller frame that invoked the failing path.

Configuration (environment variables):
  LOG_DIR              — Directory for log files (default: backend/logs).
  LOG_LEVEL            — Minimum level for the file sink: DEBUG, INFO, WARNING, ERROR (default: DEBUG).
  LOG_ROTATION_MAX_MB  — Rotate the current file when it exceeds this size in MB (default: 15).
  LOG_RETENTION_FILES  — Keep at most this many rotated log files (default: 20).
  LOG_CONSOLE          — If false, file only (no stderr). Default: true (mirror to terminal).
  LOG_CONSOLE_LEVEL    — Minimum level for the console sink (default: INFO).
  LOG_ENQUEUE          — If true, loguru writes each sink in a background thread (default: false).
                         Enqueue can delay or complicate shutdown (Ctrl+C); leave false unless needed.
"""

from __future__ import annotations

import inspect
import os
import sys
import traceback
from pathlib import Path
from typing import Any

from loguru import logger

# backend/app/ — only stack frames under this tree are "ours"
_APP_ROOT = Path(__file__).resolve().parents[1]
_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_LOGGER_MODULE = Path(__file__).name

_CONFIGURED = False


def _env_flag_enabled(name: str) -> bool:
    """True if VAR is set to a truthy token (1, true, yes, on). Unset = false."""
    v = os.environ.get(name)
    if v is None:
        return False
    s = v.strip().lower()
    return s in ("1", "true", "yes", "on")


def _env_flag_disabled(name: str) -> bool:
    """True if VAR is explicitly set to a falsey token (0, false, no, off). Unset = not disabled."""
    v = os.environ.get(name)
    if v is None:
        return False
    s = v.strip().lower()
    if not s:
        return False
    return s in ("0", "false", "no", "off")

_LOGURU_LEVEL_TO_LABEL = {
    "TRACE": "debug",
    "DEBUG": "debug",
    "INFO": "info",
    "SUCCESS": "info",
    "WARNING": "warn",
    "ERROR": "error",
    "CRITICAL": "error",
}


def _ts_for_line(record: dict[str, Any]) -> str:
    dt = record["time"]
    ms = int(dt.microsecond // 1000)
    return dt.strftime("%Y-%m-%d_%H:%M:%S") + f":{ms:03d}"


def _is_project_source(filename: str) -> bool:
    try:
        Path(filename).resolve().relative_to(_APP_ROOT)
        return True
    except (ValueError, TypeError, OSError):
        return False


def _skip_frame_for_caller(filename: str) -> bool:
    fn = Path(filename).name
    if fn == _LOGGER_MODULE:
        return True
    if "loguru" in filename.replace("\\", "/"):
        return True
    return False


def _caller_site_without_exception() -> tuple[str, int, str]:
    """Immediate logging callsite in app/ (skip this logger and loguru)."""
    for fr in inspect.stack()[2:]:
        if _skip_frame_for_caller(fr.filename):
            continue
        if _is_project_source(fr.filename):
            return Path(fr.filename).name, fr.lineno, fr.function
    return "?", 0, "?"


def _caller_site_from_exception(exc: BaseException) -> tuple[str, int, str]:
    """
    Prefer the app frame that **called** the innermost app frame in the traceback
    (the callsite into the library / failing path).
    """
    tb = getattr(exc, "__traceback__", None)
    if tb is None:
        return _caller_site_without_exception()

    frames = traceback.extract_tb(tb)
    if not frames:
        return _caller_site_without_exception()

    app_indices = [i for i, f in enumerate(frames) if _is_project_source(f.filename)]
    if not app_indices:
        f = frames[-1]
        return Path(f.filename).name, f.lineno, f.name

    inner = app_indices[-1]
    if inner > 0 and _is_project_source(frames[inner - 1].filename):
        f = frames[inner - 1]
    else:
        f = frames[inner]
    return Path(f.filename).name, f.lineno, f.name


def _no_angle(s: str) -> str:
    """Avoid loguru treating `<...>` in output as markup when present in exception text."""
    return str(s).replace("<", "[").replace(">", "]")


def _format_record(record: dict[str, Any]) -> str:
    extra = record["extra"]
    lvl = record["level"].name
    level = _LOGURU_LEVEL_TO_LABEL.get(lvl, lvl.lower())
    src_file = _no_angle(str(extra.get("src_file", "?")))
    src_func = _no_angle(str(extra.get("src_func", "?")))
    src_line = extra.get("src_line", 0)
    message = _no_angle(str(record["message"]))
    line_suffix = (
        f" : in line number {src_line}" if lvl in ("ERROR", "CRITICAL") else ""
    )
    return (
        f"{_ts_for_line(record)}|||{level}|||{src_file}|||{src_func}|||"
        f"{message}{line_suffix}\n"
    )


def _context_suffix(**ctx: Any) -> str:
    if not ctx:
        return ""
    return " | " + " | ".join(f"{k}={v}" for k, v in ctx.items() if v is not None)


def configure_logging() -> None:
    """Idempotent: wire daily file sink + stderr (same format). Call once at process start."""
    global _CONFIGURED
    if _CONFIGURED:
        return

    log_dir = Path(os.environ.get("LOG_DIR", str(_BACKEND_ROOT / "logs"))).resolve()
    log_dir.mkdir(parents=True, exist_ok=True)

    max_mb = float(os.environ.get("LOG_ROTATION_MAX_MB", "15").strip() or "15")
    rotation_size = f"{max_mb} MB"
    retention_files = int(os.environ.get("LOG_RETENTION_FILES", "20").strip() or "20")

    file_level = os.environ.get("LOG_LEVEL", "DEBUG").strip().upper() or "DEBUG"
    console_level = os.environ.get("LOG_CONSOLE_LEVEL", "INFO").strip().upper() or "INFO"
    mirror_to_console = not _env_flag_disabled("LOG_CONSOLE")
    use_enqueue = _env_flag_enabled("LOG_ENQUEUE")

    logger.remove()

    file_pattern = str(log_dir / "{time:YYYY_MM_DD}.log")
    logger.add(
        file_pattern,
        format=_format_record,
        level=file_level,
        rotation=rotation_size,
        retention=retention_files,
        enqueue=use_enqueue,
        encoding="utf-8",
        colorize=False,
    )

    if mirror_to_console:
        logger.add(
            sys.stderr,
            format=_format_record,
            level=console_level,
            enqueue=use_enqueue,
            colorize=False,
        )

    _CONFIGURED = True


def shutdown_logging() -> None:
    """
    Drain background log queues (when LOG_ENQUEUE=true).
    Call from app shutdown so Ctrl+C does not hang waiting on loguru worker threads.
    """
    try:
        logger.complete()
    except Exception:
        pass


def _bind_and_log(level: str, message: str, exc: BaseException | None, **ctx: Any) -> None:
    if exc is not None:
        fn, ln, func = _caller_site_from_exception(exc)
        text = message + _context_suffix(**ctx)
        if str(exc).strip() and str(exc) not in message:
            text = f"{text} | error={exc!s}"
    else:
        fn, ln, func = _caller_site_without_exception()
        text = message + _context_suffix(**ctx)

    # raw=True: API/exception text may contain `{` `}` (e.g. protobuf); loguru would treat them as format placeholders.
    logger.bind(src_file=fn, src_line=ln, src_func=func).opt(raw=True).log(level, text)


def log_debug(message: str, **ctx: Any) -> None:
    _bind_and_log("DEBUG", message, None, **ctx)


def log_info(message: str, **ctx: Any) -> None:
    _bind_and_log("INFO", message, None, **ctx)


def log_warn(message: str, exc: BaseException | None = None, **ctx: Any) -> None:
    _bind_and_log("WARNING", message, exc, **ctx)


def log_error(message: str, exc: BaseException | None = None, **ctx: Any) -> None:
    _bind_and_log("ERROR", message, exc, **ctx)
