from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.athlete_access import require_athlete_access
from app.auth.deps import get_current_user, require_coach_view
from app.coach.capacity import require_capacity
from app.coach.muscle_groups import validate_priority_muscle_groups
from app.db.engine import get_db
from app.db.models import Athlete, AthletePlan, CoachAthleteAssignment
from app.db.models_auth import User
from app.db.repo import list_sessions_for_athlete
from coach_ai.muscle_insights import compute_muscle_group_states, find_weakest_group

DbSession = Annotated[Session, Depends(get_db)]
router = APIRouter(prefix="/coach", tags=["coach"])


def _clean_text(raw: str | None) -> str | None:
    if raw is None:
        return None
    value = " ".join(raw.split()).strip()
    return value or None


def _own_assignment(db: DbSession, user: User, athlete_id: str) -> CoachAthleteAssignment | None:
    return db.execute(
        select(CoachAthleteAssignment).where(
            CoachAthleteAssignment.coach_user_id == user.id,
            CoachAthleteAssignment.athlete_id == athlete_id,
        )
    ).scalar_one_or_none()


class CoachAthleteCreateRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=160)
    notes: str | None = Field(default=None, max_length=1000)
    priority_muscle_groups: list[str] = Field(default_factory=list)


class CoachAthleteUpdateRequest(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=160)
    notes: str | None = Field(default=None, max_length=1000)
    priority_muscle_groups: list[str] | None = None


class CoachAthleteResponse(BaseModel):
    athlete_id: str
    display_name: str | None
    notes: str | None
    priority_muscle_groups: list[str]


@router.post("/athletes", response_model=CoachAthleteResponse, status_code=status.HTTP_201_CREATED)
def create_coach_athlete(
    payload: CoachAthleteCreateRequest,
    user: Annotated[User, Depends(require_coach_view)],
    db: DbSession,
) -> CoachAthleteResponse:
    try:
        priority = validate_priority_muscle_groups(payload.priority_muscle_groups)
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err

    require_capacity(db, user.id)

    athlete_id = f"coach_{uuid.uuid4().hex}"
    athlete = Athlete(
        athlete_id=athlete_id,
        display_name=payload.display_name.strip(),
        notes=_clean_text(payload.notes),
    )
    db.add(athlete)
    db.add(CoachAthleteAssignment(id=uuid.uuid4(), coach_user_id=user.id, athlete_id=athlete_id))
    db.add(
        AthletePlan(
            athlete_id=athlete_id,
            priority_muscle_groups=priority,
            updated_by_user_id=user.id,
        )
    )
    db.commit()

    return CoachAthleteResponse(
        athlete_id=athlete_id,
        display_name=athlete.display_name,
        notes=athlete.notes,
        priority_muscle_groups=priority,
    )


@router.patch("/athletes/{athlete_id}", response_model=CoachAthleteResponse)
def update_coach_athlete(
    athlete_id: str,
    payload: CoachAthleteUpdateRequest,
    user: Annotated[User, Depends(require_coach_view)],
    db: DbSession,
) -> CoachAthleteResponse:
    require_athlete_access(db, user, athlete_id)
    athlete = db.get(Athlete, athlete_id)
    if athlete is None:
        raise HTTPException(status_code=404, detail="Atleta no encontrado.")

    if payload.display_name is not None:
        athlete.display_name = payload.display_name.strip()
    if payload.notes is not None:
        athlete.notes = _clean_text(payload.notes)

    plan = db.get(AthletePlan, athlete_id)
    if payload.priority_muscle_groups is not None:
        try:
            priority = validate_priority_muscle_groups(payload.priority_muscle_groups)
        except ValueError as err:
            raise HTTPException(status_code=422, detail=str(err)) from err
        if plan is None:
            plan = AthletePlan(
                athlete_id=athlete_id, priority_muscle_groups=priority, updated_by_user_id=user.id
            )
            db.add(plan)
        else:
            plan.priority_muscle_groups = priority
            plan.updated_by_user_id = user.id

    db.commit()
    db.refresh(athlete)
    return CoachAthleteResponse(
        athlete_id=athlete.athlete_id,
        display_name=athlete.display_name,
        notes=athlete.notes,
        priority_muscle_groups=list(plan.priority_muscle_groups) if plan else [],
    )


@router.delete("/athletes/{athlete_id}")
def remove_coach_athlete(
    athlete_id: str,
    user: Annotated[User, Depends(require_coach_view)],
    db: DbSession,
) -> dict:
    row = _own_assignment(db, user, athlete_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Asignacion no encontrada.")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/athletes/{athlete_id}/seen")
def mark_athlete_seen(
    athlete_id: str,
    user: Annotated[User, Depends(require_coach_view)],
    db: DbSession,
) -> dict:
    row = _own_assignment(db, user, athlete_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Asignacion no encontrada.")
    row.last_viewed_at_utc = datetime.now(UTC)
    db.commit()
    return {"ok": True}


class MuscleSeriesPointOut(BaseModel):
    t: str
    volume_kg: float


class MuscleGroupStateOut(BaseModel):
    group: str
    trend_direction: str
    plateau_p: float | None
    confidence: float
    recent_series: list[MuscleSeriesPointOut]
    exercises_involved: list[str]


class MuscleInsightsResponse(BaseModel):
    athlete_id: str
    priority_muscle_groups: list[str]
    states: list[MuscleGroupStateOut]
    weakest_group: str | None


@router.get("/athletes/{athlete_id}/muscle-insights", response_model=MuscleInsightsResponse)
def athlete_muscle_insights(
    athlete_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
) -> MuscleInsightsResponse:
    require_athlete_access(db, user, athlete_id)

    plan = db.get(AthletePlan, athlete_id)
    priority_groups = list(plan.priority_muscle_groups) if plan else []

    sessions = list_sessions_for_athlete(db, athlete_id)
    states = compute_muscle_group_states(sessions, priority_groups)
    weakest = find_weakest_group(states)

    return MuscleInsightsResponse(
        athlete_id=athlete_id,
        priority_muscle_groups=priority_groups,
        states=[
            MuscleGroupStateOut(
                group=s.group,
                trend_direction=s.trend_direction,
                plateau_p=s.plateau_p,
                confidence=s.confidence,
                recent_series=[
                    MuscleSeriesPointOut(t=p.t.isoformat(), volume_kg=p.volume_kg)
                    for p in s.recent_series
                ],
                exercises_involved=s.exercises_involved,
            )
            for s in states
        ],
        weakest_group=weakest.group if weakest else None,
    )
