import stripe
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

from app.core.config import settings
from app.services.db_service import get_supabase_client

stripe.api_key = settings.stripe_secret_key

router = APIRouter()


def _get_packs_from_db() -> dict:
    """Load active session packs from the session_packs table."""
    supabase = get_supabase_client()
    result = supabase.table("session_packs").select("*").eq("active", True).order("sort_order").execute()
    packs = {}
    for row in result.data or []:
        packs[row["id"]] = {
            "sessions": row["sessions"],
            "price_cents": row["price_cents"],
            "name": row["name"],
        }
    return packs


# Fallback packs if DB is unavailable
_FALLBACK_PACKS = {
    "essai_plus": {"sessions": 2, "price_cents": 399, "name": "Starter"},
    "decouverte": {"sessions": 5, "price_cents": 999, "name": "Focus"},
    "preparation": {"sessions": 20, "price_cents": 2499, "name": "Prep"},
    "intensif": {"sessions": 50, "price_cents": 4999, "name": "Intensive"},
    "marathon": {"sessions": 100, "price_cents": 7999, "name": "Marathon"},
}


def _get_packs() -> dict:
    try:
        packs = _get_packs_from_db()
        return packs if packs else _FALLBACK_PACKS
    except Exception:
        return _FALLBACK_PACKS


class CheckoutRequest(BaseModel):
    pack_id: str
    user_id: str
    success_url: str
    cancel_url: str


@router.get("/packs")
async def get_packs():
    """Return available session packs with CAD pricing."""
    packs = _get_packs()
    return {
        pack_id: {
            "id": pack_id,
            "name": pack["name"],
            "sessions": pack["sessions"],
            "price_cad": pack["price_cents"] / 100,
            "per_session_cad": round(pack["price_cents"] / 100 / pack["sessions"], 2),
        }
        for pack_id, pack in packs.items()
    }


@router.post("/checkout")
async def create_checkout(req: CheckoutRequest):
    """Create a Stripe checkout session for a session pack."""
    packs = _get_packs()
    pack = packs.get(req.pack_id)
    if not pack:
        raise HTTPException(status_code=400, detail="Invalid pack ID")

    try:
        checkout_session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            line_items=[
                {
                    "price_data": {
                        "currency": "cad",
                        "product_data": {
                            "name": f"SpeakFrench - {pack['name']}",
                            "description": f"{pack['sessions']} TCF/TEF speaking practice sessions",
                        },
                        "unit_amount": pack["price_cents"],
                    },
                    "quantity": 1,
                }
            ],
            mode="payment",
            success_url=req.success_url,
            cancel_url=req.cancel_url,
            metadata={
                "user_id": req.user_id,
                "pack_id": req.pack_id,
                "sessions": str(pack["sessions"]),
            },
        )
        return {"checkout_url": checkout_session.url}
    except stripe.StripeError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/webhook")
async def stripe_webhook(request: Request):
    """Handle Stripe webhook to credit sessions after payment."""
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")

    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.stripe_webhook_secret
        )
    except (ValueError, stripe.SignatureVerificationError):
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        metadata = session.get("metadata", {})

        user_id = metadata.get("user_id")
        pack_id = metadata.get("pack_id")
        sessions = int(metadata.get("sessions", 0))

        if user_id and sessions > 0:
            supabase = get_supabase_client()
            supabase.table("user_packs").insert(
                {
                    "user_id": user_id,
                    "pack_id": pack_id,
                    "sessions_total": sessions,
                    "sessions_remaining": sessions,
                    "stripe_session_id": session["id"],
                    "amount_cad": session.get("amount_total", 0) / 100,
                }
            ).execute()

    return {"status": "ok"}


@router.get("/balance/{user_id}")
async def get_balance(user_id: str):
    """Get remaining session balance for a user."""
    from app.services.db_service import get_user_session_balance
    balance = await get_user_session_balance(user_id)
    return {"user_id": user_id, "sessions_remaining": balance}
