from fastapi import APIRouter, HTTPException
from openai import APIConnectionError, APITimeoutError

from app.services.db_service import get_supabase_client
from app.services.llm_service import generate_session_review, generate_session_scores

router = APIRouter()


def _to_optional_float(value):
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _overall_from_scores(*scores: float | None) -> int:
    available = [s for s in scores if s is not None]
    if not available:
        return 0
    return round(sum(available) / len(available))


@router.get("/{user_id}")
async def get_dashboard(user_id: str):
    """Get consolidated dashboard data: sessions, stats, practice dates."""
    supabase = get_supabase_client()

    # Fetch session history (last 50 for analytics depth)
    try:
        history_res = (
            supabase.table("session_history")
            .select("id, exam_type, exam_part, level, is_demo, duration_seconds, pronunciation_score, grammar_score, vocabulary_score, coherence_score, corrections, transcript, ai_review, created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(50)
            .execute()
        )
    except Exception:
        # Fallback if new columns don't exist yet
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
    paid_count = 0
    demo_count = 0
    best_score = 0

    for row in sessions:
        p = _to_optional_float(row.get("pronunciation_score"))
        g = _to_optional_float(row.get("grammar_score"))
        v = _to_optional_float(row.get("vocabulary_score"))
        c = _to_optional_float(row.get("coherence_score"))
        overall = _overall_from_scores(p, g, v, c)
        is_demo = bool(row.get("is_demo", False))

        if is_demo:
            demo_count += 1
        else:
            total_score += overall
            paid_count += 1
            best_score = max(best_score, overall)

        dt = row.get("created_at", "")
        date_key = dt[:10] if dt else ""
        if date_key and not is_demo:
            practice_dates.add(date_key)

        session_list.append({
            "id": row["id"],
            "exam_type": row.get("exam_type", "tcf"),
            "exam_part": row.get("exam_part", 1),
            "level": row.get("level", "B1"),
            "is_demo": is_demo,
            "duration_seconds": row.get("duration_seconds", 0),
            "pronunciation_score": p,
            "grammar_score": g,
            "vocabulary_score": v,
            "coherence_score": c,
            "overall_score": overall,
            "corrections": row.get("corrections", []),
            "transcript": row.get("transcript", []),
            "ai_review": row.get("ai_review"),
            "created_at": dt,
        })

    n = paid_count
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
            "demo_sessions": demo_count,
            "avg_score": avg_score,
            "best_score": best_score,
            "sessions_remaining": sessions_remaining,
            "streak": streak,
            "last_session_date": sessions[0]["created_at"] if sessions else None,
        },
        "practice_dates": sorted(practice_dates),
    }


@router.post("/{user_id}/session/{session_id}/regenerate-review")
async def regenerate_review(user_id: str, session_id: str):
    """Regenerate AI review and recompute text-based scores from transcript."""
    supabase = get_supabase_client()

    # Fetch the session
    result = (
        supabase.table("session_history")
        .select("id, transcript, ai_review, level, exam_type")
        .eq("id", session_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")

    session = result.data
    transcript = session.get("transcript") or []

    if not transcript:
        raise HTTPException(status_code=400, detail="No transcript available to generate review")

    exam_type = session.get("exam_type") or "tcf"
    level = session.get("level") or "B1"

    # Recompute text-based scores/corrections in one LLM call for reliability.
    try:
        score_data = await generate_session_scores(transcript, level=level)
    except (APITimeoutError, APIConnectionError):
        raise HTTPException(
            status_code=504,
            detail="Score recalculation timed out. Please retry in a few seconds.",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Score recalculation failed: {str(e)}")

    # Generate review from transcript
    try:
        ai_review = await generate_session_review(transcript, exam_type=exam_type, level=level)
    except (APITimeoutError, APIConnectionError):
        raise HTTPException(
            status_code=504,
            detail="Review generation timed out. Please retry in a few seconds.",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Review generation failed: {str(e)}")

    # Save regenerated review and updated text-based scores together.
    payload = {
        "ai_review": ai_review,
        "grammar_score": score_data.get("grammar_score"),
        "vocabulary_score": score_data.get("vocabulary_score"),
        "coherence_score": score_data.get("coherence_score"),
        "corrections": score_data.get("corrections", []),
    }
    supabase.table("session_history").update(payload).eq("id", session_id).execute()

    return {
        "ai_review": ai_review,
        "scores": {
            "grammar_score": payload["grammar_score"],
            "vocabulary_score": payload["vocabulary_score"],
            "coherence_score": payload["coherence_score"],
        },
        "corrections": payload["corrections"],
        "regenerated": True,
    }
