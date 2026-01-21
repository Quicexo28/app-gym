from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.types import Plan
from app.db.engine import get_db
from app.db.models_auth import User, UserSettings

router = APIRouter(prefix="/settings", tags=["settings"])
DbSession = Session


class SettingsResponse(BaseModel):
    weight_unit: str
    effort_mode: str
    modules_enabled: dict


class SettingsUpdateRequest(BaseModel):
    weight_unit: str | None = None  # kg|lb
    effort_mode: str | None = None  # rpe|rir
    modules_enabled: dict | None = None


def _allowed_modules_for_plan(plan: Plan) -> set[str]:
    if plan == Plan.FREE:
        return {"trends", "suggestions"}  # restringido para evitar “ruido”
    return {"trends", "latents", "suggestions", "validation"}


@router.get("", response_model=SettingsResponse)
def get_settings(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> SettingsResponse:
    row = db.get(UserSettings, user.id)
    if row is None:
        row = UserSettings(user_id=user.id, weight_unit="kg", effort_mode="rpe", modules_enabled={})
        db.add(row)
        db.commit()
        db.refresh(row)

    return SettingsResponse(
        weight_unit=row.weight_unit,
        effort_mode=row.effort_mode,
        modules_enabled=row.modules_enabled,
    )


@router.put("", response_model=SettingsResponse)
def update_settings(
    payload: SettingsUpdateRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> SettingsResponse:
    row = db.get(UserSettings, user.id)
    if row is None:
        row = UserSettings(user_id=user.id, weight_unit="kg", effort_mode="rpe", modules_enabled={})
        db.add(row)
        db.flush()

    if payload.weight_unit is not None:
        if payload.weight_unit not in {"kg", "lb"}:
            raise HTTPException(status_code=400, detail="Invalid weight_unit.")
        row.weight_unit = payload.weight_unit

    if payload.effort_mode is not None:
        if payload.effort_mode not in {"rpe", "rir"}:
            raise HTTPException(status_code=400, detail="Invalid effort_mode.")
        row.effort_mode = payload.effort_mode

    if payload.modules_enabled is not None:
        allowed = _allowed_modules_for_plan(user.plan)
        clean: dict = {}
        for k, v in payload.modules_enabled.items():
            if k in allowed:
                clean[k] = bool(v)
        # No borramos módulos no permitidos: simplemente no los activamos.
        row.modules_enabled = clean

    db.commit()
    db.refresh(row)
    return SettingsResponse(
        weight_unit=row.weight_unit,
        effort_mode=row.effort_mode,
        modules_enabled=row.modules_enabled,
    )
