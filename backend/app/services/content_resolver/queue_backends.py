from __future__ import annotations

import json
import queue
from typing import Any, Dict

from app.services.content_resolver.logging_utils import app_log


class QueueBackend:
    def put_ingress(self, payload: Dict[str, Any], timeout_sec: float = 2.0) -> None:
        raise NotImplementedError

    def get_ingress(self, timeout_sec: float = 0.2) -> Dict[str, Any] | None:
        raise NotImplementedError

    def put_writer(self, payload: Dict[str, Any], timeout_sec: float = 2.0) -> None:
        raise NotImplementedError

    def get_writer(self, timeout_sec: float = 0.2) -> Dict[str, Any] | None:
        raise NotImplementedError


class InMemoryQueueBackend(QueueBackend):
    def __init__(self, ingress_size: int, writer_size: int) -> None:
        self.ingress_q: queue.Queue[Dict[str, Any]] = queue.Queue(maxsize=ingress_size)
        self.writer_q: queue.Queue[Dict[str, Any]] = queue.Queue(maxsize=writer_size)

    def put_ingress(self, payload: Dict[str, Any], timeout_sec: float = 2.0) -> None:
        self.ingress_q.put(payload, timeout=timeout_sec)

    def get_ingress(self, timeout_sec: float = 0.2) -> Dict[str, Any] | None:
        try:
            return self.ingress_q.get(timeout=timeout_sec)
        except queue.Empty:
            return None

    def put_writer(self, payload: Dict[str, Any], timeout_sec: float = 2.0) -> None:
        self.writer_q.put(payload, timeout=timeout_sec)

    def get_writer(self, timeout_sec: float = 0.2) -> Dict[str, Any] | None:
        try:
            return self.writer_q.get(timeout=timeout_sec)
        except queue.Empty:
            return None


class RedisQueueBackend(QueueBackend):
    def __init__(
        self,
        host: str,
        port: int,
        db: int,
        password: str,
        prefix: str,
    ) -> None:
        try:
            import redis  # type: ignore
        except ImportError as exc:
            raise RuntimeError("redis package is required. Install with: pip install redis") from exc

        self._redis = redis.Redis(
            host=host,
            port=port,
            db=db,
            password=password or None,
            decode_responses=True,
        )
        # Fail fast if Redis is unreachable so caller can fallback.
        self._redis.ping()
        self.ingress_key = f"{prefix}:ingress"
        self.writer_key = f"{prefix}:writer"
        app_log(
            "queue_backends",
            f"redis backend initialized: ingress_key={self.ingress_key}, writer_key={self.writer_key}",
        )

    def put_ingress(self, payload: Dict[str, Any], timeout_sec: float = 2.0) -> None:
        _ = timeout_sec
        try:
            size = self._redis.rpush(self.ingress_key, json.dumps(payload, default=str))
            app_log("queue_backends", f"redis put_ingress: key={self.ingress_key}, size={size}")
        except Exception as exc:
            app_log("queue_backends", f"redis put_ingress failed: key={self.ingress_key}, error={exc}")
            raise

    def get_ingress(self, timeout_sec: float = 0.2) -> Dict[str, Any] | None:
        try:
            item = self._redis.lpop(self.ingress_key)
            if item is None:
                return None
            app_log("queue_backends", f"redis get_ingress hit: key={self.ingress_key}")
            return json.loads(item)
        except Exception as exc:
            app_log("queue_backends", f"redis get_ingress failed: key={self.ingress_key}, error={exc}")
            raise

    def put_writer(self, payload: Dict[str, Any], timeout_sec: float = 2.0) -> None:
        _ = timeout_sec
        try:
            size = self._redis.rpush(self.writer_key, json.dumps(payload, default=str))
            app_log("queue_backends", f"redis put_writer: key={self.writer_key}, size={size}")
        except Exception as exc:
            app_log("queue_backends", f"redis put_writer failed: key={self.writer_key}, error={exc}")
            raise

    def get_writer(self, timeout_sec: float = 0.2) -> Dict[str, Any] | None:
        try:
            item = self._redis.lpop(self.writer_key)
            if item is None:
                return None
            app_log("queue_backends", f"redis get_writer hit: key={self.writer_key}")
            return json.loads(item)
        except Exception as exc:
            app_log("queue_backends", f"redis get_writer failed: key={self.writer_key}, error={exc}")
            raise

