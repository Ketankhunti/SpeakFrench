from fastapi import APIRouter, HTTPException, Query
from app.services.metrics import snapshot as metrics_snapshot, reset as metrics_reset
from app.core.config import settings

router = APIRouter()


def _is_admin(email: str | None) -> bool:
    if not email or not settings.admin_email:
        return False
    return email.strip().lower() == settings.admin_email.strip().lower()


@router.get("/health")
async def health_check():
    return {"status": "ok", "service": "speakfrench-api"}


@router.get("/admin/check")
async def admin_check(email: str = Query(...)):
    """Check whether the given email has admin access."""
    return {"is_admin": _is_admin(email)}


@router.get("/metrics")
async def get_metrics(email: str = Query(...)):
    """Return current operational metrics counters (admin only)."""
    if not _is_admin(email):
        raise HTTPException(status_code=403, detail="Not authorized")
    return metrics_snapshot()


@router.post("/metrics/reset")
async def reset_metrics(email: str = Query(...)):
    """Snapshot and reset counters (admin only)."""
    if not _is_admin(email):
        raise HTTPException(status_code=403, detail="Not authorized")
    return metrics_reset()
