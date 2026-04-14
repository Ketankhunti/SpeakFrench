from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel

from app.services.db_service import get_supabase_client

router = APIRouter()


class ProfileUpdate(BaseModel):
    full_name: str | None = None
    email: str | None = None
    avatar_url: str | None = None


# ── GET /api/profile/{user_id} ──
# Returns profile + account overview in one call
@router.get("/{user_id}")
async def get_profile(user_id: str):
    """Get consolidated profile, pack info, and session stats."""
    supabase = get_supabase_client()

    # Profile
    profile_res = (
        supabase.table("profiles")
        .select("user_id, full_name, email, avatar_url, created_at")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    profile = profile_res.data
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    # User packs with pack display name from session_packs
    packs_res = (
        supabase.table("user_packs")
        .select("pack_id, sessions_total, sessions_remaining, created_at, session_packs(name)")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    packs = packs_res.data or []

    sessions_remaining = sum(p.get("sessions_remaining", 0) for p in packs)
    sessions_total = sum(p.get("sessions_total", 0) for p in packs)

    # Resolve display name from the joined session_packs row
    latest_pack = packs[0] if packs else None
    current_pack = "No pack"
    if latest_pack:
        sp = latest_pack.get("session_packs")
        if isinstance(sp, dict) and sp.get("name"):
            current_pack = f"{sp['name']} ({latest_pack['sessions_total']} sessions)"
        else:
            current_pack = latest_pack["pack_id"]

    # Session history count
    history_res = (
        supabase.table("session_history")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .execute()
    )
    total_sessions_completed = history_res.count or 0

    return {
        "profile": {
            "user_id": profile["user_id"],
            "full_name": profile.get("full_name"),
            "email": profile.get("email"),
            "avatar_url": profile.get("avatar_url"),
            "created_at": profile.get("created_at"),
        },
        "account": {
            "current_pack": current_pack,
            "sessions_remaining": sessions_remaining,
            "sessions_total": sessions_total,
            "total_sessions_completed": total_sessions_completed,
        },
    }


# ── PUT /api/profile/{user_id} ──
@router.put("/{user_id}")
async def update_profile(user_id: str, body: ProfileUpdate):
    """Update profile fields (name, email, avatar_url)."""
    supabase = get_supabase_client()

    update_data: dict = {}
    if body.full_name is not None:
        update_data["full_name"] = body.full_name.strip()
    if body.email is not None:
        update_data["email"] = body.email.strip()
    if body.avatar_url is not None:
        update_data["avatar_url"] = body.avatar_url

    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    result = (
        supabase.table("profiles")
        .update(update_data)
        .eq("user_id", user_id)
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="Profile not found")

    return {"status": "ok", "profile": result.data[0]}


# ── POST /api/profile/{user_id}/avatar ──
@router.post("/{user_id}/avatar")
async def upload_avatar(user_id: str, file: UploadFile = File(...)):
    """Upload avatar image to Supabase Storage and update profile."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    # Limit to 2MB
    contents = await file.read()
    if len(contents) > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image must be under 2MB")

    ext = file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "png"
    storage_path = f"{user_id}/avatar.{ext}"

    supabase = get_supabase_client()

    # Upload to avatars bucket (upsert = overwrite if exists)
    supabase.storage.from_("avatars").upload(
        storage_path,
        contents,
        file_options={"content-type": file.content_type, "upsert": "true"},
    )

    # Get public URL
    public_url = supabase.storage.from_("avatars").get_public_url(storage_path)

    # Update profile
    supabase.table("profiles").update({"avatar_url": public_url}).eq("user_id", user_id).execute()

    return {"status": "ok", "avatar_url": public_url}


# ── DELETE /api/profile/{user_id} ──
@router.delete("/{user_id}")
async def delete_account(user_id: str):
    """Delete user account and all associated data.
    Uses service_role key to delete from auth.users, which cascades to all tables.
    """
    supabase = get_supabase_client()

    # Delete avatar from storage (ignore errors if no file)
    try:
        supabase.storage.from_("avatars").remove([f"{user_id}/avatar.png", f"{user_id}/avatar.jpg", f"{user_id}/avatar.jpeg"])
    except Exception:
        pass

    # Delete auth user — CASCADE will remove profiles, user_packs, session_history, demo_usage
    try:
        supabase.auth.admin.delete_user(user_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete account: {e}")

    return {"status": "ok"}
