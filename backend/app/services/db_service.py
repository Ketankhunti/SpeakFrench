from supabase import create_client, Client
from app.core.config import settings

# Track active WebSocket sessions per user (single-server; use Redis for multi-server)
_active_sessions: set[str] = set()


def get_supabase_client() -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_key)


def is_session_active(user_id: str) -> bool:
    return user_id in _active_sessions


def set_session_active(user_id: str) -> None:
    _active_sessions.add(user_id)


def clear_session_active(user_id: str) -> None:
    _active_sessions.discard(user_id)


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
