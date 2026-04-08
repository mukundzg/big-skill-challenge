"""Reusable error-guard helpers for service functions."""

from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from typing import ParamSpec, TypeVar

from app.core.app_logger import log_error

P = ParamSpec("P")
R = TypeVar("R")


def guarded_service(op_name: str) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """
    Decorator to log service-level exceptions consistently before re-raising.
    """
    def deco(fn: Callable[P, R]) -> Callable[P, R]:
        @wraps(fn)
        def wrapped(*args: P.args, **kwargs: P.kwargs) -> R:
            try:
                return fn(*args, **kwargs)
            except Exception as e:
                log_error("Service operation failed", exc=e, operation=op_name, function=fn.__name__)
                raise
        return wrapped
    return deco

