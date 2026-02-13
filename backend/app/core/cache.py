"""Simple TTL cache for statistics."""
import threading
import time
from typing import Any

_cache: dict[str, tuple[Any, float]] = {}
_lock = threading.Lock()
DEFAULT_TTL = 300  # 5 minutes
STATS_KEY = "estadisticas"


def get_cached(key: str, ttl: float = DEFAULT_TTL) -> Any | None:
    with _lock:
        if key in _cache:
            value, expires = _cache[key]
            if time.time() < expires:
                return value
            del _cache[key]
    return None


def set_cached(key: str, value: Any, ttl: float = DEFAULT_TTL) -> None:
    with _lock:
        _cache[key] = (value, time.time() + ttl)


def invalidate_stats() -> None:
    with _lock:
        if STATS_KEY in _cache:
            del _cache[STATS_KEY]
