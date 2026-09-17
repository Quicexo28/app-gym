from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import CoachAthleteAssignment
from app.db.models_coach import CoachBilling, CoachBillingStatus

settings = Settings()

_INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # sin 0/O/1/I ambiguos


def _invite_code_part() -> str:
    return "".join(secrets.choice(_INVITE_CODE_ALPHABET) for _ in range(4))


def generate_invite_code() -> str:
    return f"{_invite_code_part()}-{_invite_code_part()}"


@dataclass(frozen=True)
class CoachCapacity:
    used: int
    included: int
    extra: int
    total: int

    @property
    def has_room(self) -> bool:
        return self.used < self.total


def coach_capacity(db: Session, coach_user_id: uuid.UUID) -> CoachCapacity:
    used = int(
        db.execute(
            select(func.count(CoachAthleteAssignment.id)).where(
                CoachAthleteAssignment.coach_user_id == coach_user_id
            )
        ).scalar_one()
        or 0
    )

    billing = db.get(CoachBilling, coach_user_id)
    extra = 0
    if billing is not None and billing.status in {CoachBillingStatus.ACTIVE, CoachBillingStatus.PAST_DUE}:
        extra = billing.extra_seats

    included = settings.coach_included_seats
    return CoachCapacity(used=used, included=included, extra=extra, total=included + extra)


def require_capacity(db: Session, coach_user_id: uuid.UUID) -> None:
    capacity = coach_capacity(db, coach_user_id)
    if not capacity.has_room:
        raise HTTPException(
            status_code=409,
            detail="Cupo lleno. Compra un asiento extra o libera un cupo para seguir.",
        )
