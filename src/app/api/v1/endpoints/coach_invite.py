from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.athlete_access import personal_athlete_id_for_user
from app.auth.deps import get_current_user, require_coach_view
from app.coach.capacity import CoachCapacity, coach_capacity, generate_invite_code, require_capacity
from app.db.engine import get_db
from app.db.models import CoachAthleteAssignment
from app.db.models_auth import User
from app.db.models_coach import CoachProfile
from app.db.repo import ensure_athlete

DbSession = Annotated[Session, Depends(get_db)]
router = APIRouter(prefix="/coach", tags=["coach"])

_MAX_ROTATE_ATTEMPTS = 5


class CoachCapacityOut(BaseModel):
    used: int
    included: int
    extra: int
    total: int


def _capacity_out(capacity: CoachCapacity) -> CoachCapacityOut:
    return CoachCapacityOut(
        used=capacity.used, included=capacity.included, extra=capacity.extra, total=capacity.total
    )


class CoachInviteOut(BaseModel):
    invite_code: str
    invite_enabled: bool
    capacity: CoachCapacityOut


class CoachInviteUpdateRequest(BaseModel):
    invite_enabled: bool


def _get_or_create_profile(db: DbSession, coach: User) -> CoachProfile:
    profile = db.get(CoachProfile, coach.id)
    if profile is not None:
        return profile

    for _ in range(_MAX_ROTATE_ATTEMPTS):
        profile = CoachProfile(coach_user_id=coach.id, invite_code=generate_invite_code())
        db.add(profile)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            continue
        db.refresh(profile)
        return profile
    raise HTTPException(status_code=500, detail="No se pudo generar un codigo de invitacion unico.")


@router.get("/invite", response_model=CoachInviteOut)
def get_coach_invite(
    coach: Annotated[User, Depends(require_coach_view)],
    db: DbSession,
) -> CoachInviteOut:
    profile = _get_or_create_profile(db, coach)
    capacity = coach_capacity(db, coach.id)
    return CoachInviteOut(
        invite_code=profile.invite_code,
        invite_enabled=profile.invite_enabled,
        capacity=_capacity_out(capacity),
    )


@router.post("/invite/rotate", response_model=CoachInviteOut)
def rotate_coach_invite(
    coach: Annotated[User, Depends(require_coach_view)],
    db: DbSession,
) -> CoachInviteOut:
    profile = _get_or_create_profile(db, coach)

    for _ in range(_MAX_ROTATE_ATTEMPTS):
        profile.invite_code = generate_invite_code()
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            profile = db.get(CoachProfile, coach.id)
            continue
        db.refresh(profile)
        break
    else:
        raise HTTPException(status_code=500, detail="No se pudo generar un codigo de invitacion unico.")

    capacity = coach_capacity(db, coach.id)
    return CoachInviteOut(
        invite_code=profile.invite_code,
        invite_enabled=profile.invite_enabled,
        capacity=_capacity_out(capacity),
    )


@router.patch("/invite", response_model=CoachInviteOut)
def update_coach_invite(
    payload: CoachInviteUpdateRequest,
    coach: Annotated[User, Depends(require_coach_view)],
    db: DbSession,
) -> CoachInviteOut:
    profile = _get_or_create_profile(db, coach)
    profile.invite_enabled = payload.invite_enabled
    db.commit()
    db.refresh(profile)

    capacity = coach_capacity(db, coach.id)
    return CoachInviteOut(
        invite_code=profile.invite_code,
        invite_enabled=profile.invite_enabled,
        capacity=_capacity_out(capacity),
    )


class CoachJoinRequest(BaseModel):
    code: str = Field(min_length=1, max_length=32)


class CoachJoinResponse(BaseModel):
    ok: bool
    coach_user_id: str
    coach_label: str


@router.post("/join", response_model=CoachJoinResponse)
def join_coach(
    payload: CoachJoinRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
) -> CoachJoinResponse:
    normalized_code = payload.code.strip().upper()
    if not normalized_code:
        raise HTTPException(status_code=422, detail="Codigo requerido.")

    profile = db.execute(
        select(CoachProfile).where(CoachProfile.invite_code == normalized_code)
    ).scalar_one_or_none()
    if profile is None or not profile.invite_enabled:
        raise HTTPException(status_code=404, detail="Codigo de invitacion invalido.")

    coach = db.get(User, profile.coach_user_id)
    if coach is None or not coach.is_active:
        raise HTTPException(status_code=404, detail="Codigo de invitacion invalido.")

    athlete_id = personal_athlete_id_for_user(user)

    existing = db.execute(
        select(CoachAthleteAssignment).where(CoachAthleteAssignment.athlete_id == athlete_id)
    ).scalars().all()
    for row in existing:
        if row.coach_user_id == coach.id:
            return CoachJoinResponse(ok=True, coach_user_id=str(coach.id), coach_label=coach.email)
    if existing:
        raise HTTPException(
            status_code=409,
            detail="Ya tienes un coach activo. Salte de tu coach actual antes de unirte a otro.",
        )

    require_capacity(db, coach.id)

    ensure_athlete(db, athlete_id)
    db.add(CoachAthleteAssignment(coach_user_id=coach.id, athlete_id=athlete_id))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()

    return CoachJoinResponse(ok=True, coach_user_id=str(coach.id), coach_label=coach.email)


@router.delete("/leave")
def leave_coach(
    user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
) -> dict:
    athlete_id = personal_athlete_id_for_user(user)
    result = db.execute(
        delete(CoachAthleteAssignment).where(CoachAthleteAssignment.athlete_id == athlete_id)
    )
    db.commit()
    return {"ok": True, "removed": result.rowcount}
