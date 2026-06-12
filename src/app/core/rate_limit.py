from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from collections.abc import Callable

from fastapi import HTTPException, Request


class SlidingWindowRateLimiter:
    """In-memory sliding-window limiter, scoped per process.

    First line of defense against credential brute force; a multi-instance
    deployment should complement it with a shared store (e.g. Redis).
    """

    def __init__(self, *, max_requests: int, window_seconds: float) -> None:
        if max_requests < 1:
            raise ValueError("max_requests must be >= 1")
        if window_seconds <= 0:
            raise ValueError("window_seconds must be > 0")
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            hits = self._hits[key]
            while hits and hits[0] < cutoff:
                hits.popleft()
            if len(hits) >= self.max_requests:
                return False
            hits.append(now)
            return True


def rate_limit_dependency(limiter: SlidingWindowRateLimiter, scope: str) -> Callable[[Request], None]:
    """FastAPI dependency that throttles by client IP within the given scope."""

    def dependency(request: Request) -> None:
        client_ip = request.client.host if request.client else "unknown"
        if not limiter.allow(f"{scope}:{client_ip}"):
            raise HTTPException(status_code=429, detail="Too many requests. Try again later.")

    return dependency
