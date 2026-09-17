from __future__ import annotations

import uuid
from typing import Annotated

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.types import Plan
from app.core.config import Settings
from app.db.engine import get_db
from app.db.models_auth import User
from app.db.models_coach import CoachBilling, CoachBillingStatus

DbSession = Annotated[Session, Depends(get_db)]
router = APIRouter(prefix="/webhooks", tags=["webhooks"])

settings = Settings()
stripe.api_key = settings.stripe_secret_key

_STATUS_MAP = {
    "active": CoachBillingStatus.ACTIVE,
    "trialing": CoachBillingStatus.ACTIVE,
    "past_due": CoachBillingStatus.PAST_DUE,
    "unpaid": CoachBillingStatus.PAST_DUE,
    "canceled": CoachBillingStatus.CANCELED,
    "incomplete_expired": CoachBillingStatus.CANCELED,
}


def _sync_billing_from_subscription(db: Session, billing: CoachBilling, subscription: dict) -> None:
    billing.status = _STATUS_MAP.get(subscription.get("status", ""), CoachBillingStatus.NONE)

    base_item_id: str | None = None
    seat_item_id: str | None = None
    extra_seats = 0
    for item in subscription.get("items", {}).get("data", []):
        price_id = item.get("price", {}).get("id")
        if price_id == settings.stripe_price_coach_plan:
            base_item_id = item["id"]
        elif price_id == settings.stripe_price_extra_seat:
            seat_item_id = item["id"]
            extra_seats = item.get("quantity", 0)

    billing.stripe_base_item_id = base_item_id
    billing.stripe_seat_item_id = seat_item_id
    billing.extra_seats = extra_seats
    db.commit()


@router.post("/stripe")
async def stripe_webhook(request: Request, db: DbSession) -> dict:
    if not settings.stripe_webhook_secret:
        raise HTTPException(status_code=503, detail="Webhook no configurado.")

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig_header, settings.stripe_webhook_secret)
    except (ValueError, stripe.error.SignatureVerificationError) as err:
        raise HTTPException(status_code=400, detail="Firma invalida.") from err

    event_type = event["type"]
    obj = event["data"]["object"]

    if event_type == "checkout.session.completed" and obj.get("mode") == "subscription":
        coach_user_id_raw = obj.get("client_reference_id")
        if not coach_user_id_raw:
            return {"received": True}
        coach_user_id = uuid.UUID(coach_user_id_raw)

        billing = db.get(CoachBilling, coach_user_id)
        if billing is None:
            billing = CoachBilling(coach_user_id=coach_user_id)
            db.add(billing)

        billing.stripe_customer_id = obj.get("customer")
        billing.stripe_subscription_id = obj.get("subscription")
        db.commit()

        subscription = stripe.Subscription.retrieve(billing.stripe_subscription_id)
        _sync_billing_from_subscription(db, billing, subscription)

        user = db.get(User, coach_user_id)
        if user is not None and billing.status == CoachBillingStatus.ACTIVE:
            user.plan = Plan.COACH
            db.commit()

    elif event_type in {"customer.subscription.updated", "customer.subscription.deleted"}:
        subscription_id = obj.get("id")
        billing = db.execute(
            select(CoachBilling).where(CoachBilling.stripe_subscription_id == subscription_id)
        ).scalar_one_or_none()
        if billing is not None:
            if event_type == "customer.subscription.deleted":
                billing.status = CoachBillingStatus.CANCELED
                db.commit()
            else:
                _sync_billing_from_subscription(db, billing, obj)

    return {"received": True}
