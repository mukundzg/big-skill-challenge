from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

from app.core.app_logger import log_error_with_traceback
from app.services.content_resolver.db import MySQLDBHandler
from app.services.content_resolver.evaluation_service import run_evaluation
from app.services.content_resolver.logging_utils import app_log
from app.services.content_resolver.queue_backends import InMemoryQueueBackend, QueueBackend, RedisQueueBackend


def utc_now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


@dataclass(slots=True)
class EvaluationJob:
    job_id: str
    entries: List[Dict[str, Any]]
    status: str = "queued"
    created_at: str = field(default_factory=utc_now_iso)
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    error: Optional[str] = None
    result_preview: Dict[str, Any] = field(default_factory=dict)


class EvaluationPipeline:
    """
    High-throughput pipeline with:
    - bounded ingress queue (backpressure)
    - N evaluator worker threads
    - 1 batched DB writer thread
    """

    def __init__(
        self,
        db_handler: MySQLDBHandler,
        queue_backend: str = "inmemory",
        evaluator_workers: int = 8,
        ingress_queue_size: int = 20000,
        writer_queue_size: int = 50000,
        db_batch_size: int = 500,
        db_flush_interval_sec: float = 0.5,
        redis_host: str = "127.0.0.1",
        redis_port: int = 6379,
        redis_db: int = 0,
        redis_password: str = "",
        redis_prefix: str = "entry_eval",
    ) -> None:
        self.db_handler = db_handler
        self.evaluator_workers = max(1, evaluator_workers)
        self.db_batch_size = max(1, db_batch_size)
        self.db_flush_interval_sec = max(0.1, db_flush_interval_sec)

        self._jobs: Dict[str, EvaluationJob] = {}
        self._job_results: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.RLock()

        backend_name = queue_backend.lower().strip()
        if backend_name == "redis":
            self._queue_backend: QueueBackend = RedisQueueBackend(
                host=redis_host,
                port=redis_port,
                db=redis_db,
                password=redis_password,
                prefix=redis_prefix,
            )
        else:
            self._queue_backend = InMemoryQueueBackend(
                ingress_size=ingress_queue_size,
                writer_size=writer_queue_size,
            )
        app_log("pipeline", f"queue backend selected: {backend_name}")
        self._stop_event = threading.Event()
        self._workers: List[threading.Thread] = []
        self._writer_thread: Optional[threading.Thread] = None

    def start(self, init_schema: bool = True) -> None:
        if init_schema:
            self.db_handler.initialize_schema()
            app_log("pipeline", "database schema initialized")

        self._stop_event.clear()
        for idx in range(self.evaluator_workers):
            t = threading.Thread(target=self._evaluator_loop, name=f"eval-worker-{idx}", daemon=True)
            t.start()
            self._workers.append(t)
            app_log("pipeline", f"evaluator worker started: name={t.name}")

        self._writer_thread = threading.Thread(target=self._writer_loop, name="db-writer", daemon=True)
        self._writer_thread.start()
        app_log("pipeline", f"pipeline started with evaluator_workers={self.evaluator_workers}")

    def stop(self, timeout_sec: float = 5.0) -> None:
        self._stop_event.set()
        deadline = time.time() + timeout_sec
        for t in self._workers:
            remaining = max(0.0, deadline - time.time())
            t.join(timeout=remaining)
        if self._writer_thread:
            remaining = max(0.0, deadline - time.time())
            self._writer_thread.join(timeout=remaining)
        app_log("pipeline", "pipeline stopped")

    def submit_entries(self, entries: List[Dict[str, Any]]) -> str:
        job_id = str(uuid4())
        job = EvaluationJob(job_id=job_id, entries=entries)
        with self._lock:
            self._jobs[job_id] = job
        self._queue_backend.put_ingress({"job_id": job.job_id, "entries": job.entries}, timeout_sec=2.0)
        app_log("pipeline", f"job queued: job_id={job_id}, entries={len(entries)}")
        return job_id

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            return {
                "job_id": job.job_id,
                "status": job.status,
                "created_at": job.created_at,
                "started_at": job.started_at,
                "finished_at": job.finished_at,
                "error": job.error,
                "result_preview": job.result_preview,
            }

    def get_result(self, job_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            return self._job_results.get(job_id)

    def _evaluator_loop(self) -> None:
        thread_name = threading.current_thread().name
        app_log("pipeline", f"evaluator loop entered: worker={thread_name}")
        while not self._stop_event.is_set():
            try:
                queued = self._queue_backend.get_ingress(timeout_sec=0.2)
                if not queued:
                    continue
                job_id = queued["job_id"]
                with self._lock:
                    job = self._jobs.get(job_id)
                if not job:
                    app_log("pipeline", f"queue item dropped: unknown job_id={job_id}")
                    continue

                with self._lock:
                    job.status = "running"
                    job.started_at = utc_now_iso()
                app_log("pipeline", f"job status changed: job_id={job_id}, status=running")

                submission_map = self.db_handler.insert_submissions(queued["entries"])
                result = run_evaluation(queued["entries"])
                db_payload = result.get("db_payload", {})
                if queued["entries"]:
                    db_payload["user_id"] = int(queued["entries"][0]["user_id"])
                db_payload["submission_id_map"] = submission_map
                result["db_payload"] = db_payload
                result["job_id"] = job.job_id
                self._queue_backend.put_writer(result, timeout_sec=2.0)
                app_log(
                    "pipeline",
                    f"job moved to writer queue: job_id={job_id}, submission_count={len(submission_map)}",
                )
                with self._lock:
                    job.result_preview = {
                        "shortlisted_attempt_ids": result["shortlisted_attempt_ids"],
                        "consistency_report": result["consistency_report"],
                    }
            except Exception as exc:
                log_error_with_traceback(
                    "Evaluation pipeline evaluator worker failed",
                    exc,
                    worker=thread_name,
                )
                # Best effort: mark job failed when context exists.
                if "job_id" in locals():
                    with self._lock:
                        job_ref = self._jobs.get(job_id)  # type: ignore[name-defined]
                        if job_ref is not None:
                            job_ref.status = "failed"
                            job_ref.error = str(exc)
                            job_ref.finished_at = utc_now_iso()
                    app_log("pipeline", f"job status changed: job_id={job_id}, status=failed")

    def _writer_loop(self) -> None:
        pending: List[Dict[str, Any]] = []
        last_flush = time.time()
        while not self._stop_event.is_set():
            try:
                now = time.time()
                should_flush = pending and (
                    len(pending) >= self.db_batch_size or (now - last_flush) >= self.db_flush_interval_sec
                )
                if should_flush:
                    self._flush_pending(pending)
                    pending.clear()
                    last_flush = time.time()
                    continue

                item = self._queue_backend.get_writer(timeout_sec=0.2)
                if item:
                    pending.append(item)
                    app_log("pipeline", f"writer queue accepted job: job_id={item.get('job_id')}, pending={len(pending)}")
            except Exception as exc:
                log_error_with_traceback("Evaluation pipeline writer loop failed", exc)

        if pending:
            try:
                self._flush_pending(pending)
            except Exception as exc:
                log_error_with_traceback(
                    "Evaluation pipeline final flush on shutdown failed",
                    exc,
                )

    def _flush_pending(self, batch_results: List[Dict[str, Any]]) -> None:
        payloads = [x["db_payload"] for x in batch_results]
        stats = self.db_handler.insert_payloads_bulk(payloads)
        app_log(
            "pipeline",
            f"db flush complete: jobs={len(batch_results)}, submissions={stats['submissions']}, scores={stats['scores']}, audit_logs={stats['audit_logs']}",
        )
        for result in batch_results:
            job_id = result["job_id"]
            result["db_insert_stats"] = stats
            with self._lock:
                self._job_results[job_id] = result
                job = self._jobs[job_id]
                job.status = "completed"
                job.finished_at = utc_now_iso()
            app_log("pipeline", f"job status changed: job_id={job_id}, status=completed")

