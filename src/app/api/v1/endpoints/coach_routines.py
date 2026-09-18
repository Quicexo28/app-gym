from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import require_coach_view
from app.coach.reports import normalize_exercise_name
from app.db.engine import get_db
from app.db.models import RoutineTemplateExerciseIndex
from app.db.models_auth import User

DbSession = Annotated[Session, Depends(get_db)]
router = APIRouter(prefix="/coach", tags=["coach"])


class RoutineUsageAthlete(BaseModel):
    athlete_id: str
    routine_id: str
    routine_name: str


class RoutineUsageResponse(BaseModel):
    template_key: str
    athletes: list[RoutineUsageAthlete]


class ExerciseUsageEntry(BaseModel):
    athlete_id: str
    routine_id: str
    routine_name: str
    target_sets_min: int | None
    target_sets_max: int | None
    target_reps_min: int | None
    target_reps_max: int | None


class ExerciseUsageResponse(BaseModel):
    exercise_name_normalized: str
    entries: list[ExerciseUsageEntry]


@router.get("/routines/{template_key}/usage", response_model=RoutineUsageResponse)
def routine_template_usage(
    template_key: str,
    user: Annotated[User, Depends(require_coach_view)],
    db: DbSession,
) -> RoutineUsageResponse:
    """Que atletas de la cartera de este coach usan esta plantilla como base."""
    rows = (
        db.execute(
            select(RoutineTemplateExerciseIndex).where(
                RoutineTemplateExerciseIndex.coach_user_id == user.id,
                RoutineTemplateExerciseIndex.template_key == template_key,
            )
        )
        .scalars()
        .all()
    )
    seen: set[tuple[str, str]] = set()
    athletes: list[RoutineUsageAthlete] = []
    for row in rows:
        key = (row.athlete_id, row.routine_id)
        if key in seen:
            continue
        seen.add(key)
        athletes.append(
            RoutineUsageAthlete(
                athlete_id=row.athlete_id, routine_id=row.routine_id, routine_name=row.routine_name
            )
        )
    return RoutineUsageResponse(template_key=template_key, athletes=athletes)


@router.get("/exercises/{exercise_name}/usage", response_model=ExerciseUsageResponse)
def exercise_usage(
    exercise_name: str,
    user: Annotated[User, Depends(require_coach_view)],
    db: DbSession,
) -> ExerciseUsageResponse:
    """Que atletas tienen este ejercicio en alguna rutina, con su programacion actual."""
    normalized = normalize_exercise_name(exercise_name)
    rows = (
        db.execute(
            select(RoutineTemplateExerciseIndex).where(
                RoutineTemplateExerciseIndex.coach_user_id == user.id,
                RoutineTemplateExerciseIndex.exercise_name_normalized == normalized,
            )
        )
        .scalars()
        .all()
    )
    return ExerciseUsageResponse(
        exercise_name_normalized=normalized,
        entries=[
            ExerciseUsageEntry(
                athlete_id=row.athlete_id,
                routine_id=row.routine_id,
                routine_name=row.routine_name,
                target_sets_min=row.target_sets_min,
                target_sets_max=row.target_sets_max,
                target_reps_min=row.target_reps_min,
                target_reps_max=row.target_reps_max,
            )
            for row in rows
        ],
    )
