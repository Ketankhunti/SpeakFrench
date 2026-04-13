from supabase import create_client, Client
from app.core.config import settings


def get_supabase_client() -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_key)


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


async def save_session_result(user_id: str, session_data: dict) -> None:
    """Save session results and scores to database."""
    supabase = get_supabase_client()
    supabase.table("session_history").insert(
        {
            "user_id": user_id,
            "exam_part": session_data.get("exam_part", 1),
            "level": session_data.get("level", "B1"),
            "duration_seconds": session_data.get("duration_seconds", 0),
            "pronunciation_score": session_data.get("pronunciation_score"),
            "grammar_score": session_data.get("grammar_score"),
            "vocabulary_score": session_data.get("vocabulary_score"),
            "coherence_score": session_data.get("coherence_score"),
            "transcript": session_data.get("transcript", []),
            "ai_review": session_data.get("ai_review"),
        }
    ).execute()
