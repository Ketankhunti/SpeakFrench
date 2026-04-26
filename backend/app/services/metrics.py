"""Lightweight in-process metrics counters for operational visibility.

Thread-safe via threading.Lock (counters are touched from sync helpers too).
For multi-instance aggregation, push these to Redis or a metrics service.
"""

import threading
import time
from dataclasses import dataclass, field, asdict


@dataclass
class _Counters:
    lock_acquire_failed: int = 0
    lock_heartbeat_failed: int = 0
    session_start_throttled: int = 0
    dependency_timeout_stt: int = 0
    dependency_timeout_eval: int = 0
    dependency_timeout_llm: int = 0
    dependency_timeout_tts: int = 0
    dependency_timeout_review: int = 0
    sessions_started: int = 0
    sessions_completed: int = 0
    sessions_errored: int = 0
    tts_cache_hit: int = 0
    tts_cache_miss: int = 0
    started_at: float = field(default_factory=time.time)


_lock = threading.Lock()
_counters = _Counters()


def inc(name: str, amount: int = 1) -> None:
    """Increment a named counter."""
    with _lock:
        current = getattr(_counters, name, None)
        if current is not None:
            setattr(_counters, name, current + amount)


def snapshot() -> dict:
    """Return a point-in-time copy of all counters."""
    with _lock:
        data = asdict(_counters)
    data["uptime_seconds"] = round(time.time() - data.pop("started_at"), 1)
    data["dependency_timeout_total"] = (
        data["dependency_timeout_stt"]
        + data["dependency_timeout_eval"]
        + data["dependency_timeout_llm"]
        + data["dependency_timeout_tts"]
        + data["dependency_timeout_review"]
    )
    data["active_sessions"] = max(
        0,
        data["sessions_started"] - data["sessions_completed"] - data["sessions_errored"],
    )
    return data


def reset() -> dict:
    """Snapshot and then reset all counters. Returns the pre-reset snapshot."""
    global _counters
    with _lock:
        old = asdict(_counters)
        _counters = _Counters()
    old["uptime_seconds"] = round(time.time() - old.pop("started_at"), 1)
    old["dependency_timeout_total"] = (
        old["dependency_timeout_stt"]
        + old["dependency_timeout_eval"]
        + old["dependency_timeout_llm"]
        + old["dependency_timeout_tts"]
        + old["dependency_timeout_review"]
    )
    old["active_sessions"] = max(
        0,
        old["sessions_started"] - old["sessions_completed"] - old["sessions_errored"],
    )
    return old
