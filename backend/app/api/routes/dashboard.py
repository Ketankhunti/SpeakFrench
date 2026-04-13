from fastapi import APIRouter, HTTPException

from app.services.db_service import get_supabase_client

router = APIRouter()


@router.get("/{user_id}")
async def get_dashboard(user_id: str):
    """Get consolidated dashboard data: sessions, stats, practice dates."""
    supabase = get_supabase_client()

    # Fetch session history (last 50 for analytics depth)
    history_res = (
        supabase.table("session_history")
        .select("id, exam_part, level, duration_seconds, pronunciation_score, grammar_score, vocabulary_score, coherence_score, transcript, ai_review, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(50)
        .execute()
    )
    sessions = history_res.data or []

    # Session balance
    balance_res = (
        supabase.table("user_packs")
        .select("sessions_remaining")
        .eq("user_id", user_id)
        .gt("sessions_remaining", 0)
        .execute()
    )
    sessions_remaining = sum(r.get("sessions_remaining", 0) for r in (balance_res.data or []))

    # Build per-session response objects
    session_list = []
    practice_dates = set()
    total_score = 0

    for row in sessions:
        p = float(row.get("pronunciation_score") or 0)
        g = float(row.get("grammar_score") or 0)
        v = float(row.get("vocabulary_score") or 0)
        c = float(row.get("coherence_score") or 0)
        overall = round((p + g + v + c) / 4)
        total_score += overall

        dt = row.get("created_at", "")
        date_key = dt[:10] if dt else ""
        if date_key:
            practice_dates.add(date_key)

        session_list.append({
            "id": row["id"],
            "exam_part": row.get("exam_part", 1),
            "level": row.get("level", "B1"),
            "duration_seconds": row.get("duration_seconds", 0),
            "pronunciation_score": p,
            "grammar_score": g,
            "vocabulary_score": v,
            "coherence_score": c,
            "overall_score": overall,
            "transcript": row.get("transcript", []),
            "ai_review": row.get("ai_review"),
            "created_at": dt,
        })

    n = len(session_list)
    best_score = max((s["overall_score"] for s in session_list), default=0)
    avg_score = round(total_score / n) if n > 0 else 0

    # Streak: consecutive unique practice days ending today or yesterday
    streak = 0
    if practice_dates:
        from datetime import date, timedelta
        today = date.today()
        sorted_days = sorted(practice_dates, reverse=True)
        for i, d in enumerate(sorted_days):
            try:
                pd = date.fromisoformat(d)
            except ValueError:
                break
            diff = (today - pd).days
            if diff == i or diff == i + 1:
                streak += 1
            else:
                break

    return {
        "sessions": session_list,
        "stats": {
            "total_sessions": n,
            "avg_score": avg_score,
            "best_score": best_score,
            "sessions_remaining": sessions_remaining,
            "streak": streak,
            "last_session_date": sessions[0]["created_at"] if sessions else None,
        },
        "practice_dates": sorted(practice_dates),
    }
