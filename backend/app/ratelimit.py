"""Limitador de solicitudes en memoria (ventana deslizante por IP y clave)."""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

from .config import get_settings


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
        now = time.monotonic()
        with self._lock:
            bucket = self._hits[key]
            while bucket and now - bucket[0] > window_seconds:
                bucket.popleft()
            if len(bucket) >= limit:
                retry_after = int(window_seconds - (now - bucket[0])) + 1
                return False, retry_after
            bucket.append(now)
            if len(self._hits) > 50_000:  # protección de memoria
                self._hits = defaultdict(deque, {k: v for k, v in self._hits.items() if v})
            return True, 0

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()


def client_ip(request: Request) -> str:
    if get_settings().TRUST_PROXY_HEADERS:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[0].strip()[:45]
    return (request.client.host if request.client else "desconocida")[:45]


def enforce(request: Request, bucket: str, limit: int, window_seconds: int, message: str) -> None:
    allowed, retry_after = limiter.allow(f"{bucket}:{client_ip(request)}", limit, window_seconds)
    if not allowed:
        raise HTTPException(status_code=429, detail=message, headers={"Retry-After": str(retry_after)})
