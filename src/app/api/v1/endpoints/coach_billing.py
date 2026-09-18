from __future__ import annotations

import uuid
from typing import Annotated

import stripe
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_coach_view
from app.coach.capacity import CoachCapacity, coach_capacity
from app.core.config import Settings
from app.db.engine import get_db
from app.db.models_auth import User
from app.db.models_coach import CoachBilling, CoachBillingStatus

DbSession = Annotated[Session, Depends(get_db)]
router = APIRouter(prefix="/coach/billing", tags=["coach-billing"])

settings = Settings()
stripe.api_key = settings.stripe_secret_key


def _require_stripe_configured() -> None:
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=503, detail="Pagos no configurados todavia.")


def _get_or_create_billing(db: DbSession, coach_user_id: uuid.UUID) -> CoachBilling:
    billing = db.get(CoachBilling, coach_user_id)
    if billing is not None:
        return billing
    billing = CoachBilling(coach_user_id=coach_user_id)
    db.add(billing)
    db.commit()
    db.refresh(billing)
    return billing


class CoachCapacityOut(BaseModel):
    used: int
    included: int
    extra: int
    total: int


def _capacity_out(capacity: CoachCapacity) -> CoachCapacityOut:
    return CoachCapacityOut(
        used=capacity.used, included=capacity.included, extra=capacity.extra, total=capacity.total
    )


class CoachBillingOut(BaseModel):
    status: str
    has_subscription: bool
    capacity: CoachCapacityOut


@router.get("", response_model=CoachBillingOut)
def get_coach_billing(
    coach: Annotated[User, Depends(require_coach_view)],
    db: DbSession,
) -> CoachBillingOut:
    billing = db.get(CoachBilling, coach.id)
    capacity = coach_capacity(db, coach.id)
    return CoachBillingOut(
        status=(billing.status if billing else CoachBillingStatus.NONE),
        has_subscription=bool(billing and billing.stripe_subscription_id),
        capacity=_capacity_out(capacity),
    )


class CheckoutUrlOut(BaseModel):
    checkout_url: str


@router.post("/subscribe", response_model=CheckoutUrlOut)
def subscribe_coach_plan(
    user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
) -> CheckoutUrlOut:
    _require_stripe_configured()
    if not settings.stripe_price_coach_plan:
        raise HTTPException(status_code=503, detail="Precio del plan coach no configurado.")

    billing = _get_or_create_billing(db, user.id)
    if billing.stripe_subscription_id and billing.status == CoachBillingStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Ya tienes una suscripcion activa.")

    if billing.stripe_customer_id is None:
        customer = stripe.Customer.create(email=user.email, metadata={"user_id": str(user.id)})
        billing.stripe_customer_id = customer.id
        db.commit()

    session = stripe.checkout.Session.create(
        mode="subscription",
        customer=billing.stripe_customer_id,
        line_items=[{"price": settings.stripe_price_coach_plan, "quantity": 1}],
        client_reference_id=str(user.id),
        success_url=f"{settings.public_web_url}/coach/invite?checkout=success",
        cancel_url=f"{settings.public_web_url}/coach/invite?checkout=cancel",
    )
    return CheckoutUrlOut(checkout_url=session.url)


class SeatsAdjustRequest(BaseModel):
    delta: int = Field(ge=-1, le=1)


@router.post("/seats", response_model=CoachBillingOut)
def adjust_coach_seats(
    payload: SeatsAdjustRequest,
    coach: Annotated[User, Depends(require_coach_view)],
    db: DbSession,
) -> CoachBillingOut:
    _require_stripe_configured()
    if not settings.stripe_price_extra_seat:
        raise HTTPException(status_code=503, detail="Precio de asiento extra no configurado.")

    billing = db.get(CoachBilling, coach.id)
    if billing is None or not billing.stripe_subscription_id:
        raise HTTPException(status_code=400, detail="Activa el plan coach antes de comprar asientos.")

    new_qty = billing.extra_seats + payload.delta
    if new_qty < 0:
        raise HTTPException(status_code=400, detail="No puedes bajar de 0 asientos extra.")

    capacity = coach_capacity(db, coach.id)
    min_allowed = max(0, capacity.used - capacity.included)
    if new_qty < min_allowed:
        raise HTTPException(
            status_code=409,
            detail="Tienes atletas usando esos asientos. Libera cupo antes de reducir.",
        )

    if new_qty == 0:
        if billing.stripe_seat_item_id:
            stripe.SubscriptionItem.delete(billing.stripe_seat_item_id, proration_behavior="none")
            billing.stripe_seat_item_id = None
    elif billing.stripe_seat_item_id is None:
        item = stripe.SubscriptionItem.create(
            subscription=billing.stripe_subscription_id,
            price=settings.stripe_price_extra_seat,
            quantity=new_qty,
            proration_behavior="none",
        )
        billing.stripe_seat_item_id = item.id
    else:
        stripe.SubscriptionItem.modify(
            billing.stripe_seat_item_id, quantity=new_qty, proration_behavior="none"
        )

    billing.extra_seats = new_qty
    db.commit()

    capacity = coach_capacity(db, coach.id)
    return CoachBillingOut(
        status=billing.status, has_subscription=bool(billing.stripe_subscription_id),
        capacity=_capacity_out(capacity),
    )


class PortalUrlOut(BaseModel):
    portal_url: str


@router.get("/portal", response_model=PortalUrlOut)
def coach_billing_portal(
    coach: Annotated[User, Depends(require_coach_view)],
    db: DbSession,
) -> PortalUrlOut:
    _require_stripe_configured()
    billing = db.get(CoachBilling, coach.id)
    if billing is None or not billing.stripe_customer_id:
        raise HTTPException(status_code=400, detail="Todavia no tienes un metodo de pago registrado.")

    session = stripe.billing_portal.Session.create(
        customer=billing.stripe_customer_id,
        return_url=f"{settings.public_web_url}/coach/invite",
    )
    return PortalUrlOut(portal_url=session.url)
