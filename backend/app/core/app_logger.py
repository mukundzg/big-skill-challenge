"""
Central application logger (loguru): daily file + stderr by default. All services import from here.

Each line looks like:
  2026-04-06_12:12:12:003|||info|||some_file.py|||some_func|||...message...
  2026-04-06_12:12:12:003|||error|||some_file.py|||some_func|||...message... : in line number 569

The `: in line number N` suffix is appended only for error-level lines (ERROR/CRITICAL).

Levels: debug, info, warn, error (lowercase). Filename/function identify the **application**
callsite (who called log_* / app_log), not library internals inside the exception traceback.

Configuration (environment variables):
  LOG_DIR              — Directory for log files (default: backend/logs).
  LOG_LEVEL            — Minimum level for the file sink: DEBUG, INFO, WARNING, ERROR (default: DEBUG).
  LOG_ROTATION_MAX_MB  — Rotate the current file when it exceeds this size in MB (default: 15).
  LOG_RETENTION_FILES  — Keep at most this many rotated log files (default: 20).
  LOG_CONSOLE          — If false, file only (no stderr). Default: true (mirror to terminal).
  LOG_CONSOLE_LEVEL    — Minimum level for the console sink (default: INFO).
                         Stderr mirrors the same one-line pipe format as the file for primary errors;
                         full Python tracebacks from log_error_with_traceback are file-only.
  LOG_ENQUEUE          — If true, loguru writes each sink in a background thread (default: false).
                         Enqueue can delay or complicate shutdown (Ctrl+C); leave false unless needed.
  LOG_STDERR_TRACEBACKS — If true, do not patch uvicorn stdlib loggers (default: false). Use to debug ASGI startup.
"""

from __future__ import annotations

import inspect
import logging
import os
import re
import sys
import traceback
from pathlib import Path
from typing import Any

from loguru import logger

# backend/app/ — only stack frames under this tree are "ours"
_APP_ROOT = Path(__file__).resolve().parents[1]
_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_LOGGER_MODULE = Path(__file__).name

# SQLAlchemy / drivers append this; it is not useful in our pipe log lines.
_SQLA_BACKGROUND_TAIL = re.compile(
    r"\s*\(Background on this error at:\s*https?://[^)]+\)\s*",
    re.IGNORECASE | re.DOTALL,
)

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
    norm = filename.replace("\\", "/")
    if "content_resolver" in norm and fn == "logging_utils.py":
        return True
    if "loguru" in norm:
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


def _no_angle(s: str) -> str:
    """Avoid loguru treating `<...>` in output as markup when present in exception text."""
    return str(s).replace("<", "[").replace(">", "]")


def _escape_curly(s: str) -> str:
    """So loguru does not treat `{` / `}` in API/exception text as format placeholders."""
    return str(s).replace("{", "{{").replace("}", "}}")


def format_exception_for_log(exc: BaseException) -> str:
    """
    One-line, developer-facing exception text for logs and returned error strings.
    Strips SQLAlchemy's '(Background on this error at: https://...)' tail and collapses whitespace.
    """
    s = str(exc).strip()
    s = _SQLA_BACKGROUND_TAIL.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _format_record(record: dict[str, Any]) -> str:
    extra = record["extra"]
    lvl = record["level"].name
    level = _LOGURU_LEVEL_TO_LABEL.get(lvl, lvl.lower())
    src_file = _no_angle(str(extra.get("src_file", "?")))
    src_func = _no_angle(str(extra.get("src_func", "?")))
    src_line = extra.get("src_line", 0)
    message = _no_angle(str(record["message"]))
    # Keep traceback continuation blocks multiline in the file; other messages stay one line per record.
    if not extra.get("traceback_only") and "\n" in message:
        message = message.split("\n", 1)[0].rstrip() + " | … (see log file for full text)"
    line_suffix = (
        f" : in line number {src_line}" if lvl in ("ERROR", "CRITICAL") else ""
    )
    return (
        f"{_ts_for_line(record)}|||{level}|||{src_file}|||{src_func}|||"
        f"{message}{line_suffix}\n"
    )


def _console_sink_filter(record: dict[str, Any]) -> bool:
    """Omit traceback continuation records from stderr so the terminal matches one-line app logs."""
    if record["extra"].get("traceback_only"):
        return False
    msg = str(record.get("message", "")).lstrip()
    if msg.startswith("Traceback (most recent call last)"):
        return False
    return True


def apply_stderr_traceback_suppression() -> None:
    """
    Uvicorn / stdlib loggers often print a full Python traceback on stderr after our loguru line.
    Re-bind uvicorn loggers to a one-line formatter (no exc_info text). Safe to call again after
    uvicorn configures logging (e.g. from FastAPI lifespan). Opt out with LOG_STDERR_TRACEBACKS=true.
    """
    if _env_flag_enabled("LOG_STDERR_TRACEBACKS"):
        return

    class _OneLineStderrFormatter(logging.Formatter):
        def format(self, record: logging.LogRecord) -> str:
            msg = record.getMessage()
            if (
                not _env_flag_enabled("LOG_STDERR_TRACEBACKS")
                and "Traceback (most recent call last)" in msg
            ):
                return f"{record.levelname}: error (details in log file under LOG_DIR)\n"
            msg = " ".join(msg.split())
            return f"{record.levelname}: {msg}\n"

    for name in ("uvicorn.error", "uvicorn"):
        lg = logging.getLogger(name)
        lg.handlers.clear()
        h = logging.StreamHandler(sys.stderr)
        h.setFormatter(_OneLineStderrFormatter())
        h.setLevel(logging.DEBUG)
        lg.addHandler(h)
        lg.propagate = False


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
        backtrace=False,
        diagnose=False,
    )

    if mirror_to_console:
        logger.add(
            sys.stderr,
            format=_format_record,
            level=console_level,
            filter=_console_sink_filter,
            enqueue=use_enqueue,
            colorize=False,
            backtrace=False,
            diagnose=False,
        )

    apply_stderr_traceback_suppression()

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
    # Always attribute file/func/line to our code that called log_* (e.g. init_engine), not SQLAlchemy frames.
    fn, ln, func = _caller_site_without_exception()
    text = message + _context_suffix(**ctx)
    if exc is not None:
        err_s = format_exception_for_log(exc)
        if err_s and err_s not in message:
            text = f"{text} | error={err_s}"

    logger.bind(src_file=fn, src_line=ln, src_func=func).log(level, _escape_curly(text))


def log_debug(message: str, **ctx: Any) -> None:
    _bind_and_log("DEBUG", message, None, **ctx)


def log_info(message: str, **ctx: Any) -> None:
    _bind_and_log("INFO", message, None, **ctx)


def log_warn(message: str, exc: BaseException | None = None, **ctx: Any) -> None:
    _bind_and_log("WARNING", message, exc, **ctx)


def log_error(message: str, exc: BaseException | None = None, **ctx: Any) -> None:
    _bind_and_log("ERROR", message, exc, **ctx)


def log_error_with_traceback(message: str, exc: BaseException, **ctx: Any) -> None:
    """
    Log an error: one structured line everywhere; full traceback is appended only to the log file
    (stderr shows the same single line as the daily log, not a Python stack dump).
    """
    log_error(message, exc=exc, **ctx)
    fn, ln, func = _caller_site_without_exception()
    tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    tb = _escape_curly(_no_angle(tb))
    logger.bind(
        src_file=fn,
        src_line=ln,
        src_func=func,
        traceback_only=True,
    ).log("ERROR", tb)
