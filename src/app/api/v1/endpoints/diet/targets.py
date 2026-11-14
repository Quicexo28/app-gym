from __future__ import annotations

from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    Query,
)
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select

from app.api.v1.endpoints.diet.common import MAX_MEAL_LABELS, DbSession
from app.auth.athlete_access import require_athlete_access
from app.auth.deps import get_current_user
from app.db.engine import get_db
from app.db.models import NutritionTarget
from app.db.models_auth import User
from app.db.repo import ensure_athlete_row

router = APIRouter()


# Objetivos diarios
# --------------------------------------------------------------------------


class NutritionTargetPayload(BaseModel):
    athlete_id: str = Field(min_length=1, max_length=255)
    energy_kcal: float | None = Field(default=None, ge=0, le=10000)
    protein_g: float | None = Field(default=None, ge=0, le=1000)
    carbs_g: float | None = Field(default=None, ge=0, le=2000)
    fat_g: float | None = Field(default=None, ge=0, le=1000)
    fiber_g: float | None = Field(default=None, ge=0, le=300)
    micronutrient_targets: dict[str, float] | None = None
    meal_labels: list[str] | None = Field(default=None, min_length=1, max_length=MAX_MEAL_LABELS)

    @model_validator(mode="after")
    def _validate_meal_labels(self) -> NutritionTargetPayload:
        if self.meal_labels is None:
            return self
        cleaned = [label.strip() for label in self.meal_labels]
        if any(not label or len(label) > 40 for label in cleaned):
            raise ValueError("Cada nombre de comida debe tener entre 1 y 40 caracteres.")
        self.meal_labels = cleaned
        return self


class NutritionTargetResponse(BaseModel):
    athlete_id: str
    energy_kcal: float | None
    protein_g: float | None
    carbs_g: float | None
    fat_g: float | None
    fiber_g: float | None
    micronutrient_targets: dict[str, float]
    meal_labels: list[str] | None
    updated_at_utc: str | None


def _serialize_target(athlete_id: str, row: NutritionTarget | None) -> NutritionTargetResponse:
    if row is None:
        return NutritionTargetResponse(
            athlete_id=athlete_id,
            energy_kcal=None,
            protein_g=None,
            carbs_g=None,
            fat_g=None,
            fiber_g=None,
            micronutrient_targets={},
            meal_labels=None,
            updated_at_utc=None,
        )
    return NutritionTargetResponse(
        athlete_id=row.athlete_id,
        energy_kcal=row.energy_kcal,
        protein_g=row.protein_g,
        carbs_g=row.carbs_g,
        fat_g=row.fat_g,
        fiber_g=row.fiber_g,
        micronutrient_targets=row.micronutrient_targets or {},
        meal_labels=row.meal_labels or None,
        updated_at_utc=row.updated_at_utc.isoformat(),
    )


@router.get("/targets", response_model=NutritionTargetResponse)
def get_nutrition_targets(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
    athlete_id: str = Query(min_length=1, max_length=255),
) -> NutritionTargetResponse:
    normalized = require_athlete_access(db, user, athlete_id)
    row = db.execute(
        select(NutritionTarget).where(NutritionTarget.athlete_id == normalized)
    ).scalar_one_or_none()
    return _serialize_target(normalized, row)


@router.put("/targets", response_model=NutritionTargetResponse)
def put_nutrition_targets(
    payload: NutritionTargetPayload,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> NutritionTargetResponse:
    athlete_id = require_athlete_access(db, user, payload.athlete_id)
    ensure_athlete_row(db, athlete_id)

    row = db.execute(
        select(NutritionTarget).where(NutritionTarget.athlete_id == athlete_id)
    ).scalar_one_or_none()
    if row is None:
        row = NutritionTarget(athlete_id=athlete_id)
        db.add(row)

    row.energy_kcal = payload.energy_kcal
    row.protein_g = payload.protein_g
    row.carbs_g = payload.carbs_g
    row.fat_g = payload.fat_g
    row.fiber_g = payload.fiber_g
    row.micronutrient_targets = payload.micronutrient_targets or None
    row.meal_labels = payload.meal_labels

    db.commit()
    db.refresh(row)
    return _serialize_target(athlete_id, row)


# --------------------------------------------------------------------------
