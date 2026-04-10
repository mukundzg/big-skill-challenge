from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple
from uuid import uuid4

from app.core.app_logger import log_error_with_traceback
from app.services.content_resolver.logging_utils import app_log


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


@dataclass(slots=True)
class SubmissionState:
    submission_id: str
    status: str = "buffered"
    created_at: str = field(default_factory=_now_iso)
    flushed_at: Optional[str] = None
    batch_job_id: Optional[str] = None
    error: Optional[str] = None


class SubmissionBatcher:
    """
    Micro-batcher for endpoint single-entry ingest.
    Flush condition: size reached OR max wait elapsed.
    """

    def __init__(
        self,
        submit_batch_fn: Callable[[List[Dict[str, Any]]], str],
        max_batch_size: int = 20,
        max_wait_ms: int = 1000,
    ) -> None:
        self.submit_batch_fn = submit_batch_fn
        self.max_batch_size = max(1, max_batch_size)
        self.max_wait_ms = max(50, max_wait_ms)
        self._lock = threading.RLock()
        self._pending: List[Tuple[str, Dict[str, Any], float]] = []
        self._states: Dict[str, SubmissionState] = {}
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._loop, name="submission-batcher", daemon=True)
        self._thread.start()
        app_log(
            "batcher",
            f"submission batcher started: max_batch_size={self.max_batch_size}, max_wait_ms={self.max_wait_ms}",
        )

    def stop(self, timeout_sec: float = 2.0) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=timeout_sec)
        app_log("batcher", "submission batcher stopped")

    def add_submission(self, payload: Dict[str, Any]) -> str:
        submission_id = str(uuid4())
        now_ts = time.time()
        with self._lock:
            self._states[submission_id] = SubmissionState(submission_id=submission_id)
            self._pending.append((submission_id, payload, now_ts))
            should_flush = len(self._pending) >= self.max_batch_size
            pending_count = len(self._pending)
        app_log(
            "batcher",
            f"submission buffered: submission_id={submission_id}, pending_count={pending_count}, status=buffered",
        )
        if should_flush:
            app_log("batcher", f"flush triggered by size: pending_count={pending_count}")
            self._flush()
        return submission_id

    def get_submission(self, submission_id: str) -> Optional[Dict[str, str | None]]:
        with self._lock:
            state = self._states.get(submission_id)
            if not state:
                return None
            return {
                "submission_id": state.submission_id,
                "status": state.status,
                "created_at": state.created_at,
                "flushed_at": state.flushed_at,
                "batch_job_id": state.batch_job_id,
                "error": state.error,
            }

    def _loop(self) -> None:
        while not self._stop_event.is_set():
            time.sleep(0.05)
            with self._lock:
                if not self._pending:
                    continue
                oldest_ts = self._pending[0][2]
                age_ms = (time.time() - oldest_ts) * 1000
            if age_ms >= self.max_wait_ms:
                app_log("batcher", f"flush triggered by wait: age_ms={age_ms:.1f}")
                self._flush()

    def _flush(self) -> None:
        with self._lock:
            if not self._pending:
                return
            batch = list(self._pending)
            self._pending.clear()
        submission_ids = [item[0] for item in batch]
        entries = [item[1] for item in batch]
        try:
            batch_job_id = self.submit_batch_fn(entries)
            now_iso = _now_iso()
            with self._lock:
                for sid in submission_ids:
                    state = self._states[sid]
                    state.status = "submitted"
                    state.flushed_at = now_iso
                    state.batch_job_id = batch_job_id
            app_log(
                "batcher",
                f"batch flushed: submission_count={len(submission_ids)}, batch_job_id={batch_job_id}, status=submitted",
            )
        except Exception as exc:
            log_error_with_traceback(
                "Submission batcher flush failed",
                exc,
                submission_count=len(submission_ids),
            )
            with self._lock:
                for sid in submission_ids:
                    state = self._states[sid]
                    state.status = "failed"
                    state.error = str(exc)

