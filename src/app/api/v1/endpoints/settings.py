from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_role
from app.auth.types import Plan, Role
from app.db.engine import get_db
from app.db.models_auth import User, UserSettings
from app.profile import get_voice_training_config, upsert_voice_training_config

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


class VoiceIntentKeywordsPayload(BaseModel):
    set_reps: list[str] = Field(default_factory=list)
    set_load: list[str] = Field(default_factory=list)
    set_set_effort: list[str] = Field(default_factory=list)
    set_set_completed: list[str] = Field(default_factory=list)


class VoicePhraseCorrectionPayload(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_text: str = Field(alias="from")
    to: str


class VoiceTrainingConfigPayload(BaseModel):
    updated_at_ms: int = 0
    custom_keywords: VoiceIntentKeywordsPayload = Field(default_factory=VoiceIntentKeywordsPayload)
    wake_aliases: list[str] = Field(default_factory=list)
    phrase_corrections: list[VoicePhraseCorrectionPayload] = Field(default_factory=list)


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


@router.get("/voice-training-config", response_model=VoiceTrainingConfigPayload)
def get_voice_training_settings(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> VoiceTrainingConfigPayload:
    _ = user
    config = get_voice_training_config(db)
    return VoiceTrainingConfigPayload.model_validate(config)


@router.put("/voice-training-config", response_model=VoiceTrainingConfigPayload)
def update_voice_training_settings(
    payload: VoiceTrainingConfigPayload,
    admin: Annotated[User, Depends(require_role(Role.ADMIN))],
    db: Annotated[DbSession, Depends(get_db)],
) -> VoiceTrainingConfigPayload:
    saved = upsert_voice_training_config(
        db,
        payload=payload.model_dump(by_alias=True),
        updated_by_user_id=admin.id,
    )
    return VoiceTrainingConfigPayload.model_validate(saved)
