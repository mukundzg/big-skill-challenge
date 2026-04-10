from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict

_CONFIG_DIR = Path(__file__).resolve().parent / "config"
_DEFAULT_PIPELINE_JSON = _CONFIG_DIR / "pipeline_config.json"


DEFAULT_PIPELINE_CONFIG: Dict[str, Any] = {
    "queue_backend": "inmemory",
    "evaluator_workers": 12,
    "db_batch_size": 500,
    "db_flush_interval_sec": 0.5,
    "ingress_queue_size": 50000,
    "writer_queue_size": 100000,
    "redis_host": "127.0.0.1",
    "redis_port": 6379,
    "redis_db": 0,
    "redis_password": "",
    "redis_prefix": "entry_eval",
    "submit_batch_max_size": 20,
    "submit_batch_max_wait_ms": 1000,
    "queue_fallback_to_inmemory": True,
}


def _load_json_config(path: str) -> Dict[str, Any]:
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _env(name: str, default: Any) -> Any:
    value = os.getenv(name)
    if value is None:
        return default
    if isinstance(default, int):
        return int(value)
    if isinstance(default, float):
        return float(value)
    if isinstance(default, bool):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return value


def load_pipeline_config(path: str | None = None) -> Dict[str, Any]:
    """Reads env (backend `.env` loaded by `app.core.config.load_environment`)."""
    resolved = path or str(_DEFAULT_PIPELINE_JSON)
    cfg = dict(DEFAULT_PIPELINE_CONFIG)
    cfg.update(_load_json_config(resolved))
    cfg["queue_backend"] = _env("QUEUE_BACKEND", cfg["queue_backend"]).strip().lower()
    cfg["evaluator_workers"] = _env("EVALUATOR_WORKERS", cfg["evaluator_workers"])
    cfg["db_batch_size"] = _env("DB_BATCH_SIZE", cfg["db_batch_size"])
    cfg["db_flush_interval_sec"] = _env("DB_FLUSH_INTERVAL_SEC", cfg["db_flush_interval_sec"])
    cfg["ingress_queue_size"] = _env("INGRESS_QUEUE_SIZE", cfg["ingress_queue_size"])
    cfg["writer_queue_size"] = _env("WRITER_QUEUE_SIZE", cfg["writer_queue_size"])
    cfg["redis_host"] = _env("REDIS_HOST", cfg["redis_host"])
    cfg["redis_port"] = _env("REDIS_PORT", cfg["redis_port"])
    cfg["redis_db"] = _env("REDIS_DB", cfg["redis_db"])
    cfg["redis_password"] = _env("REDIS_PASSWORD", cfg["redis_password"])
    cfg["redis_prefix"] = _env("REDIS_PREFIX", cfg["redis_prefix"])
    cfg["submit_batch_max_size"] = _env("SUBMIT_BATCH_MAX_SIZE", cfg["submit_batch_max_size"])
    cfg["submit_batch_max_wait_ms"] = _env("SUBMIT_BATCH_MAX_WAIT_MS", cfg["submit_batch_max_wait_ms"])
    cfg["queue_fallback_to_inmemory"] = _env(
        "QUEUE_FALLBACK_TO_INMEMORY",
        cfg["queue_fallback_to_inmemory"],
    )
    return cfg

