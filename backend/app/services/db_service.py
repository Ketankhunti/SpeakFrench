from supabase import create_client, Client
import time
import uuid
import redis
from redis.exceptions import RedisError
from app.core.config import settings

# Track active WebSocket sessions per user (single-server; use Redis for multi-server)
_active_sessions: set[str] = set()
_SESSION_LOCK_TTL_SECONDS = 60 * 30  # 30 minutes
_SESSION_START_TTL_SECONDS = 5
_session_start_attempts: dict[str, float] = {}

_RELEASE_IF_OWNER_SCRIPT = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
else
    return 0
end
"""

_REFRESH_IF_OWNER_SCRIPT = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('EXPIRE', KEYS[1], ARGV[2])
else
    return 0
end
"""


def _get_redis_client() -> redis.Redis | None:
    if not settings.redis_enabled:
        return None
    try:
        return redis.Redis.from_url(settings.redis_url, decode_responses=True)
    except Exception:
        return None


def _session_lock_key(user_id: str) -> str:
    return f"session:active:{user_id}"


def _session_start_key(user_id: str) -> str:
    return f"session:start:{user_id}"


def _session_lock_ttl_seconds() -> int:
    try:
        return max(30, int(settings.session_lock_ttl_seconds))
    except Exception:
        return _SESSION_LOCK_TTL_SECONDS


def get_supabase_client() -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_key)


def is_session_active(user_id: str) -> bool:
    r = _get_redis_client()
    if r is not None:
        try:
            return bool(r.exists(_session_lock_key(user_id)))
        except RedisError:
            pass
    return user_id in _active_sessions


def set_session_active(user_id: str) -> None:
    r = _get_redis_client()
    if r is not None:
        try:
            # NX ensures lock is only acquired when absent.
            r.set(_session_lock_key(user_id), "1", ex=_session_lock_ttl_seconds(), nx=True)
            return
        except RedisError:
            pass
    _active_sessions.add(user_id)


def clear_session_active(user_id: str) -> None:
    r = _get_redis_client()
    if r is not None:
        try:
            r.delete(_session_lock_key(user_id))
            return
        except RedisError:
            pass
    _active_sessions.discard(user_id)


def try_set_session_active(user_id: str) -> bool:
    """Atomically acquire active-session lock.

    Returns True when lock acquired, False when user already has active session.
    """
    r = _get_redis_client()
    if r is not None:
        try:
            ok = r.set(_session_lock_key(user_id), "1", ex=_session_lock_ttl_seconds(), nx=True)
            return bool(ok)
        except RedisError:
            pass

    if user_id in _active_sessions:
        return False
    _active_sessions.add(user_id)
    return True


def try_acquire_session_lock(user_id: str) -> str | None:
    """Acquire per-user active-session lock and return owner token.

    Returns owner token when acquired, else None.
    """
    owner_token = uuid.uuid4().hex
    r = _get_redis_client()
    if r is not None:
        try:
            ok = r.set(_session_lock_key(user_id), owner_token, ex=_session_lock_ttl_seconds(), nx=True)
            if not ok:
                return None
            return owner_token
        except RedisError:
            pass

    if user_id in _active_sessions:
        return None
    _active_sessions.add(user_id)
    return owner_token


def refresh_session_lock(user_id: str, owner_token: str) -> bool:
    """Refresh lock TTL if caller still owns lock.

    Returns True if refreshed. On transient Redis errors we return True to
    avoid false-positive heartbeat failures — real ownership loss will surface
    via lock-key mismatch on next successful call.
    """
    r = _get_redis_client()
    if r is not None:
        try:
            result = r.eval(
                _REFRESH_IF_OWNER_SCRIPT,
                1,
                _session_lock_key(user_id),
                owner_token,
                str(_session_lock_ttl_seconds()),
            )
            return bool(result)
        except RedisError:
            # Transient Redis error — don't flag as heartbeat failure.
            return True

    # In-memory fallback has no TTL; lock remains until clear.
    return user_id in _active_sessions


def release_session_lock(user_id: str, owner_token: str) -> None:
    """Release lock only if caller owns it.

    In Redis mode this is compare-and-delete; in fallback we best-effort clear.
    """
    r = _get_redis_client()
    if r is not None:
        try:
            r.eval(
                _RELEASE_IF_OWNER_SCRIPT,
                1,
                _session_lock_key(user_id),
                owner_token,
            )
            return
        except RedisError:
            pass

    _active_sessions.discard(user_id)


def try_acquire_session_start_slot(user_id: str) -> bool:
    """Rate-limit rapid session starts per user.

    Returns True if this start attempt is allowed.
    """
    r = _get_redis_client()
    if r is not None:
        try:
            ok = r.set(_session_start_key(user_id), "1", ex=_SESSION_START_TTL_SECONDS, nx=True)
            return bool(ok)
        except RedisError:
            pass

    now = time.time()
    last = _session_start_attempts.get(user_id)
    if last is not None and now - last < _SESSION_START_TTL_SECONDS:
        return False

    _session_start_attempts[user_id] = now

    # Light cleanup to keep fallback map bounded.
    if len(_session_start_attempts) > 2000:
        cutoff = now - (_SESSION_START_TTL_SECONDS * 2)
        stale_users = [uid for uid, ts in _session_start_attempts.items() if ts < cutoff]
        for uid in stale_users:
            _session_start_attempts.pop(uid, None)

    return True


async def get_demo_usage_count(user_id: str) -> int:
    """Get how many demo sessions the user has consumed."""
    supabase = get_supabase_client()
    result = (
        supabase.table("demo_usage")
        .select("demos_used")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not result.data:
        return 0
    return int(result.data[0].get("demos_used", 0) or 0)


async def has_demo_remaining(user_id: str) -> bool:
    """A user gets one free demo in total."""
    used = await get_demo_usage_count(user_id)
    return used < 1


async def mark_demo_consumed(user_id: str) -> None:
    """Mark demo as consumed (idempotent: keeps value at >=1)."""
    supabase = get_supabase_client()
    existing = (
        supabase.table("demo_usage")
        .select("id, demos_used")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    if existing.data:
        row = existing.data[0]
        current = int(row.get("demos_used", 0) or 0)
        if current >= 1:
            return
        supabase.table("demo_usage").update({"demos_used": 1}).eq("id", row["id"]).execute()
    else:
        supabase.table("demo_usage").insert({"user_id": user_id, "demos_used": 1}).execute()


async def get_user_session_balance(user_id: str) -> int:
    """Get remaining session count for a user."""
    supabase = get_supabase_client()
    result = (
        supabase.table("user_packs")
        .select("sessions_remaining")
        .eq("user_id", user_id)
        .gt("sessions_remaining", 0)
        .execute()
    )
    return sum(row["sessions_remaining"] for row in result.data)


async def deduct_session(user_id: str) -> bool:
    """Deduct one session from user's oldest pack with remaining sessions."""
    supabase = get_supabase_client()
    result = (
        supabase.table("user_packs")
        .select("id, sessions_remaining")
        .eq("user_id", user_id)
        .gt("sessions_remaining", 0)
        .order("created_at")
        .limit(1)
        .execute()
    )

    if not result.data:
        return False

    pack = result.data[0]
    supabase.table("user_packs").update(
        {"sessions_remaining": pack["sessions_remaining"] - 1}
    ).eq("id", pack["id"]).execute()

    return True


async def refund_session(user_id: str) -> bool:
    """Refund one session to user's most recently deducted pack."""
    supabase = get_supabase_client()
    result = (
        supabase.table("user_packs")
        .select("id, sessions_remaining, sessions_total")
        .eq("user_id", user_id)
        .order("updated_at", desc=True)
        .limit(1)
        .execute()
    )

    if not result.data:
        return False

    pack = result.data[0]
    if pack["sessions_remaining"] >= pack["sessions_total"]:
        return False  # Already at max, nothing to refund

    supabase.table("user_packs").update(
        {"sessions_remaining": pack["sessions_remaining"] + 1}
    ).eq("id", pack["id"]).execute()

    return True


async def save_session_result(user_id: str, session_data: dict) -> None:
    """Save session results and scores to database."""
    supabase = get_supabase_client()
    row = {
        "user_id": user_id,
        "exam_type": session_data.get("exam_type", "tcf"),
        "exam_part": session_data.get("exam_part", 1),
        "level": session_data.get("level", "B1"),
        "is_demo": session_data.get("is_demo", False),
        "duration_seconds": session_data.get("duration_seconds", 0),
        "pronunciation_score": session_data.get("pronunciation_score"),
        "grammar_score": session_data.get("grammar_score"),
        "vocabulary_score": session_data.get("vocabulary_score"),
        "coherence_score": session_data.get("coherence_score"),
        "corrections": session_data.get("corrections", []),
        "transcript": session_data.get("transcript", []),
        "ai_review": session_data.get("ai_review"),
    }
    try:
        supabase.table("session_history").insert(row).execute()
    except Exception:
        # Fallback if new columns don't exist yet
        row.pop("exam_type", None)
        row.pop("is_demo", None)
        row.pop("corrections", None)
        supabase.table("session_history").insert(row).execute()
