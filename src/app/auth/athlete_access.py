from __future__ import annotations

from collections.abc import Iterable

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.types import Role
from app.db.models import CoachAthleteAssignment
from app.db.models_auth import User


def personal_athlete_id_for_user(user: User) -> str:
    # Stable athlete id for non-coach roles.
    return f"user_{user.id.hex}"


def can_switch_athlete(user: User) -> bool:
    return user.role == Role.COACH


def list_accessible_athlete_ids(db: Session, user: User) -> list[str]:
    if not can_switch_athlete(user):
        return [personal_athlete_id_for_user(user)]

    rows = (
        db.execute(
            select(CoachAthleteAssignment.athlete_id)
            .where(CoachAthleteAssignment.coach_user_id == user.id)
            .order_by(CoachAthleteAssignment.athlete_id.asc())
        )
        .scalars()
        .all()
    )
    out: list[str] = []
    seen: set[str] = set()
    for raw in rows:
        athlete_id = (raw or "").strip()
        if not athlete_id or athlete_id in seen:
            continue
        seen.add(athlete_id)
        out.append(athlete_id)
    return out


def require_athlete_access(db: Session, user: User, athlete_id: str) -> None:
    target = athlete_id.strip()
    if not target:
        raise HTTPException(status_code=400, detail="athlete_id is required.")

    allowed = set(list_accessible_athlete_ids(db, user))
    if target not in allowed:
        raise HTTPException(status_code=403, detail="Athlete access denied.")


def require_athlete_access_many(db: Session, user: User, athlete_ids: Iterable[str]) -> None:
    targets = {value.strip() for value in athlete_ids if value and value.strip()}
    if not targets:
        raise HTTPException(status_code=400, detail="At least one athlete_id is required.")

    allowed = set(list_accessible_athlete_ids(db, user))
    if not targets.issubset(allowed):
        raise HTTPException(status_code=403, detail="Athlete access denied.")

