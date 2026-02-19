from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.athlete_access import list_accessible_athlete_ids, require_athlete_access
from app.auth.deps import get_current_user
from app.db.engine import get_db
from app.db.models import CycleLevel, CycleStartMode, CycleStatus
from app.db.models_auth import User
from app.planning.service import (
    add_template_child,
    athlete_overview,
    create_assignment,
    create_template,
    delete_template,
    get_assignment_detail,
    get_template_tree,
    list_assignments,
    list_templates,
    metrics_for_assignment,
    patch_assignment_status,
    reconcile_assignment,
    update_template,
)

router = APIRouter(prefix="/planning", tags=["planning"])
DbSession = Session


class MicroTemplateBlockPayload(BaseModel):
    sequence_index: int = Field(ge=1)
    relative_day: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=180)
    objective: str | None = Field(default=None, max_length=300)
    routine_snapshot: dict[str, Any] | list[Any] | None = None
    target_volume: float | None = None
    target_intensity: float | None = None
    target_fatigue: float | None = None
    target_frequency: float | None = None
    meta: dict[str, Any] | None = None


class TemplateCreateRequest(BaseModel):
    level: CycleLevel
    name: str = Field(min_length=1, max_length=160)
    objective: str | None = Field(default=None, max_length=280)
    notes: str | None = Field(default=None, max_length=6000)
    status: CycleStatus = CycleStatus.DRAFT
    training_phase: str | None = Field(default=None, max_length=120)
    nutrition_phase: str | None = Field(default=None, max_length=120)
    focus_tags: list[str] = Field(default_factory=list)
    duration_days: int | None = Field(default=None, ge=1)
    duration_weeks: int | None = Field(default=None, ge=1)
    blocks: list[MicroTemplateBlockPayload] = Field(default_factory=list)


class TemplateUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    objective: str | None = Field(default=None, max_length=280)
    notes: str | None = Field(default=None, max_length=6000)
    status: CycleStatus | None = None
    training_phase: str | None = Field(default=None, max_length=120)
    nutrition_phase: str | None = Field(default=None, max_length=120)
    focus_tags: list[str] | None = None
    duration_days: int | None = Field(default=None, ge=1)
    duration_weeks: int | None = Field(default=None, ge=1)
    blocks: list[MicroTemplateBlockPayload] | None = None


class TemplateLinkRequest(BaseModel):
    child_template_id: uuid.UUID
    order_index: int = Field(ge=1)


class AssignmentCreateRequest(BaseModel):
    athlete_id: str = Field(min_length=1, max_length=255)
    template_id: uuid.UUID
    start_mode: CycleStartMode = CycleStartMode.AUTO_ON_FIRST_SESSION
    start_date: date | None = None
    tolerance_days: int = Field(default=2, ge=0, le=30)
    timezone: str = Field(default="UTC", min_length=1, max_length=64)


class AssignmentStatusRequest(BaseModel):
    status: CycleStatus


@router.get("/templates")
def get_templates(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
    level: CycleLevel | None = None,
) -> list[dict[str, Any]]:
    return list_templates(db, owner_user_id=user.id, level=level)


@router.post("/templates")
def post_template(
    payload: TemplateCreateRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> dict[str, Any]:
    return create_template(
        db,
        owner_user_id=user.id,
        level=payload.level,
        name=payload.name,
        objective=payload.objective,
        notes=payload.notes,
        status=payload.status,
        training_phase=payload.training_phase,
        nutrition_phase=payload.nutrition_phase,
        focus_tags=payload.focus_tags,
        duration_days=payload.duration_days,
        duration_weeks=payload.duration_weeks,
        blocks=[item.model_dump() for item in payload.blocks],
    )


@router.put("/templates/{template_id}")
def put_template(
    template_id: uuid.UUID,
    payload: TemplateUpdateRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> dict[str, Any]:
    blocks_payload = [item.model_dump() for item in payload.blocks] if payload.blocks is not None else None
    return update_template(
        db,
        owner_user_id=user.id,
        template_id=template_id,
        name=payload.name,
        objective=payload.objective,
        notes=payload.notes,
        status=payload.status,
        training_phase=payload.training_phase,
        nutrition_phase=payload.nutrition_phase,
        focus_tags=payload.focus_tags,
        duration_days=payload.duration_days,
        duration_weeks=payload.duration_weeks,
        blocks=blocks_payload,
    )


@router.delete("/templates/{template_id}")
def remove_template(
    template_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> dict[str, Any]:
    return delete_template(db, owner_user_id=user.id, template_id=template_id)


@router.get("/templates/{template_id}/tree")
def template_tree(
    template_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> dict[str, Any]:
    return get_template_tree(db, owner_user_id=user.id, template_id=template_id)


@router.post("/templates/{template_id}/children")
def add_child_template(
    template_id: uuid.UUID,
    payload: TemplateLinkRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> dict[str, Any]:
    return add_template_child(
        db,
        owner_user_id=user.id,
        parent_template_id=template_id,
        child_template_id=payload.child_template_id,
        order_index=payload.order_index,
    )


@router.post("/assignments")
def post_assignment(
    payload: AssignmentCreateRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> dict[str, Any]:
    require_athlete_access(db, user, payload.athlete_id)
    created = create_assignment(
        db,
        athlete_id=payload.athlete_id,
        template_id=payload.template_id,
        template_owner_user_id=user.id,
        assigned_by_user_id=user.id,
        start_mode=payload.start_mode,
        start_date=payload.start_date,
        tolerance_days=payload.tolerance_days,
        timezone=payload.timezone,
    )
    reconcile_summary = reconcile_assignment(db, assignment_id=uuid.UUID(created["id"]))
    created["reconcile"] = reconcile_summary
    return created


@router.get("/assignments")
def get_assignments(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
    athlete_id: str | None = None,
    status: CycleStatus | None = None,
) -> list[dict[str, Any]]:
    if athlete_id is not None and athlete_id.strip():
        require_athlete_access(db, user, athlete_id)
        athlete_ids = [athlete_id]
    else:
        athlete_ids = list_accessible_athlete_ids(db, user)
    return list_assignments(db, athlete_ids=athlete_ids, status=status)


@router.get("/assignments/{assignment_id}")
def assignment_detail(
    assignment_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> dict[str, Any]:
    detail = get_assignment_detail(db, assignment_id=assignment_id)
    require_athlete_access(db, user, str(detail["athlete_id"]))
    return detail


@router.patch("/assignments/{assignment_id}/status")
def assignment_status(
    assignment_id: uuid.UUID,
    payload: AssignmentStatusRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> dict[str, Any]:
    detail = get_assignment_detail(db, assignment_id=assignment_id)
    require_athlete_access(db, user, str(detail["athlete_id"]))
    return patch_assignment_status(db, assignment_id=assignment_id, next_status=payload.status)


@router.post("/assignments/{assignment_id}/reconcile")
def assignment_reconcile(
    assignment_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> dict[str, Any]:
    detail = get_assignment_detail(db, assignment_id=assignment_id)
    require_athlete_access(db, user, str(detail["athlete_id"]))
    return reconcile_assignment(db, assignment_id=assignment_id)


@router.get("/assignments/{assignment_id}/metrics")
def assignment_metrics(
    assignment_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> dict[str, Any]:
    detail = get_assignment_detail(db, assignment_id=assignment_id)
    require_athlete_access(db, user, str(detail["athlete_id"]))
    return metrics_for_assignment(db, assignment_id=assignment_id)


@router.get("/athletes/{athlete_id}/overview")
def planning_overview_for_athlete(
    athlete_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> dict[str, Any]:
    require_athlete_access(db, user, athlete_id)
    return athlete_overview(db, athlete_id=athlete_id)
