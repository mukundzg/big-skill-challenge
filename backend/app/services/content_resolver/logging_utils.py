from __future__ import annotations

from app.core.app_logger import log_debug, log_info


def app_log(component: str, message: str) -> None:
    one = " ".join(str(message).split())
    line = f"[content_resolver:{component}] {one}"
    log_info(line)


def app_log_debug(component: str, message: str) -> None:
    one = " ".join(str(message).split())
    line = f"[content_resolver:{component}] {one}"
    log_debug(line)
