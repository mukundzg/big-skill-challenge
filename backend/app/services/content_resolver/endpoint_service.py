from __future__ import annotations

from typing import Any, Dict, List

from app.services.content_resolver.batcher import SubmissionBatcher
from app.services.content_resolver.db import MySQLDBHandler
from app.services.content_resolver.logging_utils import app_log
from app.services.content_resolver.pipeline import EvaluationPipeline
from app.services.content_resolver.settings import load_pipeline_config

_pipeline: EvaluationPipeline | None = None
_batcher: SubmissionBatcher | None = None


def get_pipeline() -> EvaluationPipeline:
    global _pipeline
    if _pipeline is None:
        cfg = load_pipeline_config()
        app_log("endpoint_service", f"building pipeline with queue_backend={cfg['queue_backend']}")
        db = MySQLDBHandler()
        try:
            _pipeline = EvaluationPipeline(
                db_handler=db,
                queue_backend=cfg["queue_backend"],
                evaluator_workers=cfg["evaluator_workers"],
                ingress_queue_size=cfg["ingress_queue_size"],
                writer_queue_size=cfg["writer_queue_size"],
                db_batch_size=cfg["db_batch_size"],
                db_flush_interval_sec=cfg["db_flush_interval_sec"],
                redis_host=cfg["redis_host"],
                redis_port=cfg["redis_port"],
                redis_db=cfg["redis_db"],
                redis_password=cfg["redis_password"],
                redis_prefix=cfg["redis_prefix"],
            )
            _pipeline.start(init_schema=True)
            app_log("endpoint_service", f"queue backend active: {cfg['queue_backend']}")
        except Exception as exc:
            if cfg.get("queue_fallback_to_inmemory", True):
                app_log(
                    "endpoint_service",
                    f"queue backend '{cfg['queue_backend']}' unavailable: {exc}. falling back to inmemory",
                )
                _pipeline = EvaluationPipeline(
                    db_handler=db,
                    queue_backend="inmemory",
                    evaluator_workers=cfg["evaluator_workers"],
                    ingress_queue_size=cfg["ingress_queue_size"],
                    writer_queue_size=cfg["writer_queue_size"],
                    db_batch_size=cfg["db_batch_size"],
                    db_flush_interval_sec=cfg["db_flush_interval_sec"],
                )
                _pipeline.start(init_schema=True)
                app_log("endpoint_service", "queue backend active: inmemory (fallback)")
            else:
                raise
    return _pipeline


def _submit_batch(entries: List[Dict[str, Any]]) -> str:
    pipeline = get_pipeline()
    return pipeline.submit_entries(entries)


def get_batcher() -> SubmissionBatcher:
    global _batcher
    if _batcher is None:
        cfg = load_pipeline_config()
        _batcher = SubmissionBatcher(
            submit_batch_fn=_submit_batch,
            max_batch_size=cfg["submit_batch_max_size"],
            max_wait_ms=cfg["submit_batch_max_wait_ms"],
        )
        _batcher.start()
    return _batcher


def submit_entries_for_evaluation(entries: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Call this from endpoint service:
    - Non-blocking submit
    - Returns job_id immediately
    """
    pipeline = get_pipeline()
    job_id = pipeline.submit_entries(entries)
    app_log("endpoint_service", f"batch submit accepted: job_id={job_id}, entries={len(entries)}")
    return {"job_id": job_id, "status": "queued"}


def submit_single_entry(entry: Dict[str, Any]) -> Dict[str, Any]:
    batcher = get_batcher()
    submission_id = batcher.add_submission(entry)
    app_log("endpoint_service", f"single submit buffered: submission_id={submission_id}")
    return {"submission_id": submission_id, "status": "buffered"}


def get_submission_status(submission_id: str) -> Dict[str, Any]:
    batcher = get_batcher()
    state = batcher.get_submission(submission_id)
    if not state:
        return {"submission_id": submission_id, "status": "not_found"}
    return state


def get_evaluation_status(job_id: str) -> Dict[str, Any]:
    pipeline = get_pipeline()
    job = pipeline.get_job(job_id)
    if not job:
        return {"job_id": job_id, "status": "not_found"}
    return job


def get_evaluation_result(job_id: str) -> Dict[str, Any]:
    pipeline = get_pipeline()
    result = pipeline.get_result(job_id)
    if not result:
        return {"job_id": job_id, "status": "not_ready"}
    return result


def shutdown_content_resolver() -> None:
    """Stop background workers (pipeline + submission batcher). Call from app lifespan."""
    global _pipeline, _batcher
    if _batcher is not None:
        _batcher.stop()
        _batcher = None
    if _pipeline is not None:
        _pipeline.stop()
        _pipeline = None

