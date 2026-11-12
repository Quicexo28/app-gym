from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.v1.endpoints.diet.common import DbSession, MealSlot
from app.auth.deps import get_current_user
from app.db.engine import get_db
from app.db.models import MealPreset
from app.db.models_auth import User
from app.nutrition.units import (
    QuantityUnitKey,
)

router = APIRouter()


# Comidas preestablecidas (presets)
# --------------------------------------------------------------------------


class MealPresetItemPayload(BaseModel):
    food_product_id: str | None = None
    food_name: str = Field(min_length=1, max_length=300)
    quantity_g: float = Field(gt=0, le=5000)
    # La unidad en que se guardo el preset es solo de presentacion: `quantity_g`
    # sigue siendo la que manda al crear las entradas.
    quantity_value: float | None = Field(default=None, gt=0, le=100000)
    quantity_unit: QuantityUnitKey | None = None
    energy_kcal: float | None = Field(default=None, ge=0, le=20000)
    protein_g: float | None = Field(default=None, ge=0, le=2000)
    carbs_g: float | None = Field(default=None, ge=0, le=2000)
    sugars_g: float | None = Field(default=None, ge=0, le=2000)
    fiber_g: float | None = Field(default=None, ge=0, le=500)
    fat_g: float | None = Field(default=None, ge=0, le=2000)
    sat_fat_g: float | None = Field(default=None, ge=0, le=2000)
    sodium_mg: float | None = Field(default=None, ge=0, le=100000)
    micronutrients: dict[str, float] | None = None


class MealPresetCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    meal_slot: MealSlot | None = None
    items: list[MealPresetItemPayload] = Field(min_length=1)


class MealPresetResponseItem(BaseModel):
    id: str
    owner_user_id: str
    name: str
    meal_slot: str | None
    items: list[dict]
    created_at_utc: str
    updated_at_utc: str


def _serialize_preset(row: MealPreset) -> MealPresetResponseItem:
    return MealPresetResponseItem(
        id=str(row.id),
        owner_user_id=str(row.owner_user_id),
        name=row.name,
        meal_slot=row.meal_slot,
        items=row.items or [],
        created_at_utc=row.created_at_utc.isoformat(),
        updated_at_utc=row.updated_at_utc.isoformat(),
    )


@router.get("/presets", response_model=list[MealPresetResponseItem])
def list_meal_presets(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> list[MealPresetResponseItem]:
    rows = (
        db.execute(
            select(MealPreset)
            .where(MealPreset.owner_user_id == user.id)
            .order_by(MealPreset.name.asc())
        )
        .scalars()
        .all()
    )
    return [_serialize_preset(row) for row in rows]


@router.post("/presets", response_model=MealPresetResponseItem, status_code=status.HTTP_201_CREATED)
def create_meal_preset(
    payload: MealPresetCreateRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> MealPresetResponseItem:
    items_payload = [item.model_dump() for item in payload.items]
    row = MealPreset(
        owner_user_id=user.id,
        name=payload.name.strip(),
        meal_slot=payload.meal_slot,
        items=items_payload,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError as err:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="A preset with this name already exists."
        ) from err
    db.refresh(row)
    return _serialize_preset(row)


@router.delete("/presets/{preset_id}")
def delete_meal_preset(
    preset_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> dict:
    row = db.execute(
        select(MealPreset).where(MealPreset.id == preset_id, MealPreset.owner_user_id == user.id)
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Preset not found.")
    db.delete(row)
    db.commit()
    return {"ok": True, "id": str(preset_id)}
