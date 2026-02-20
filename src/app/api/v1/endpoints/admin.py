from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.deps import require_role
from app.auth.types import Plan, Role
from app.db.engine import get_db
from app.db.models import CoachAthleteAssignment
from app.db.repo import ensure_athlete
from app.db.models_auth import User
from app.profile import default_gamification_config, get_gamification_config, upsert_gamification_config

router = APIRouter(prefix="/admin/dev", tags=["admin"])
DbSession = Session


class SwitchPlanRequest(BaseModel):
    email: str
    plan: Plan
    role: Role | None = None


class CoachAthleteAssignmentRequest(BaseModel):
    coach_email: str
    athlete_id: str


class RewardTierPayload(BaseModel):
    threshold: float = Field(gt=0)
    achievement: str = Field(min_length=1, max_length=120)
    medal: str = Field(min_length=1, max_length=120)


class LiftTierPayload(BaseModel):
    back_squat: list[RewardTierPayload] = Field(default_factory=list)
    bench_press: list[RewardTierPayload] = Field(default_factory=list)
    deadlift: list[RewardTierPayload] = Field(default_factory=list)


class GamificationConfigPayload(BaseModel):
    streak_tiers: list[RewardTierPayload] = Field(default_factory=list)
    planning_days_tiers: list[RewardTierPayload] = Field(default_factory=list)
    lift_tiers: LiftTierPayload
    trilogy_achievement: str = Field(min_length=1, max_length=120)
    trilogy_medal: str = Field(min_length=1, max_length=120)


class GamificationConfigResponse(BaseModel):
    config: GamificationConfigPayload
    defaults: GamificationConfigPayload


@router.post("/switch-plan")
def switch_plan(
    payload: SwitchPlanRequest,
    admin: Annotated[User, Depends(require_role(Role.ADMIN))],
    db: Annotated[DbSession, Depends(get_db)],
) -> dict:
    _ = admin  # explicit: only used for auth gate

    user = db.execute(select(User).where(User.email == payload.email)).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")

    user.plan = payload.plan
    if payload.role is not None:
        user.role = payload.role

    db.commit()
    return {"ok": True, "email": user.email, "plan": user.plan, "role": user.role}


@router.get("/coach-athletes/{coach_email}")
def list_coach_athletes(
    coach_email: str,
    admin: Annotated[User, Depends(require_role(Role.ADMIN))],
    db: Annotated[DbSession, Depends(get_db)],
) -> dict:
    _ = admin
    coach = db.execute(select(User).where(User.email == coach_email)).scalar_one_or_none()
    if coach is None:
        raise HTTPException(status_code=404, detail="Coach user not found.")
    if coach.role != Role.COACH:
        raise HTTPException(status_code=400, detail="Target user is not a coach.")

    athlete_ids = (
        db.execute(
            select(CoachAthleteAssignment.athlete_id)
            .where(CoachAthleteAssignment.coach_user_id == coach.id)
            .order_by(CoachAthleteAssignment.athlete_id.asc())
        )
        .scalars()
        .all()
    )
    return {"coach_email": coach.email, "athlete_ids": athlete_ids}


@router.post("/coach-athletes/assign")
def assign_coach_athlete(
    payload: CoachAthleteAssignmentRequest,
    admin: Annotated[User, Depends(require_role(Role.ADMIN))],
    db: Annotated[DbSession, Depends(get_db)],
) -> dict:
    _ = admin
    coach = db.execute(select(User).where(User.email == payload.coach_email)).scalar_one_or_none()
    if coach is None:
        raise HTTPException(status_code=404, detail="Coach user not found.")
    if coach.role != Role.COACH:
        raise HTTPException(status_code=400, detail="Target user is not a coach.")

    athlete_id = payload.athlete_id.strip()
    if not athlete_id:
        raise HTTPException(status_code=400, detail="athlete_id is required.")

    ensure_athlete(db, athlete_id)

    existing = db.execute(
        select(CoachAthleteAssignment).where(
            CoachAthleteAssignment.coach_user_id == coach.id,
            CoachAthleteAssignment.athlete_id == athlete_id,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return {"ok": True, "created": False, "coach_email": coach.email, "athlete_id": athlete_id}

    row = CoachAthleteAssignment(
        id=uuid.uuid4(),
        coach_user_id=coach.id,
        athlete_id=athlete_id,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return {"ok": True, "created": False, "coach_email": coach.email, "athlete_id": athlete_id}

    return {"ok": True, "created": True, "coach_email": coach.email, "athlete_id": athlete_id}


@router.delete("/coach-athletes/assign")
def remove_coach_athlete(
    payload: CoachAthleteAssignmentRequest,
    admin: Annotated[User, Depends(require_role(Role.ADMIN))],
    db: Annotated[DbSession, Depends(get_db)],
) -> dict:
    _ = admin
    coach = db.execute(select(User).where(User.email == payload.coach_email)).scalar_one_or_none()
    if coach is None:
        raise HTTPException(status_code=404, detail="Coach user not found.")

    athlete_id = payload.athlete_id.strip()
    if not athlete_id:
        raise HTTPException(status_code=400, detail="athlete_id is required.")

    row = db.execute(
        select(CoachAthleteAssignment).where(
            CoachAthleteAssignment.coach_user_id == coach.id,
            CoachAthleteAssignment.athlete_id == athlete_id,
        )
    ).scalar_one_or_none()
    if row is None:
        return {"ok": True, "deleted": False, "coach_email": coach.email, "athlete_id": athlete_id}

    db.delete(row)
    db.commit()
    return {"ok": True, "deleted": True, "coach_email": coach.email, "athlete_id": athlete_id}


@router.get("/gamification-config", response_model=GamificationConfigResponse)
def get_admin_gamification_config(
    admin: Annotated[User, Depends(require_role(Role.ADMIN))],
    db: Annotated[DbSession, Depends(get_db)],
) -> GamificationConfigResponse:
    _ = admin
    current = get_gamification_config(db)
    defaults = default_gamification_config()
    return GamificationConfigResponse(
        config=GamificationConfigPayload.model_validate(current),
        defaults=GamificationConfigPayload.model_validate(defaults),
    )


@router.put("/gamification-config", response_model=GamificationConfigPayload)
def update_admin_gamification_config(
    payload: GamificationConfigPayload,
    admin: Annotated[User, Depends(require_role(Role.ADMIN))],
    db: Annotated[DbSession, Depends(get_db)],
) -> GamificationConfigPayload:
    saved = upsert_gamification_config(
        db,
        payload=payload.model_dump(),
        updated_by_user_id=admin.id,
    )
    return GamificationConfigPayload.model_validate(saved)
