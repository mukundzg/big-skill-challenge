from __future__ import annotations

from app.core.app_logger import log_debug, log_info


def app_log(component: str, message: str) -> None:
    line = f"[content_resolver:{component}] {message}"
    if not line.endswith("\n"):
        line += "\n"
    log_info(line)


def app_log_debug(component: str, message: str) -> None:
    line = f"[content_resolver:{component}] {message}"
    if not line.endswith("\n"):
        line += "\n"
    log_debug(line)
