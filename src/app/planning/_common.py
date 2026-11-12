from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    CycleAssignment,
    CycleAssignmentBlock,
    CycleStatus,
    CycleTemplate,
    CycleTemplateLink,
    MicroTemplateBlock,
)

DEFAULT_TOLERANCE_DAYS = 2
DEFAULT_TIMEZONE = "UTC"
ACTIVE_ASSIGNMENT_STATES = {CycleStatus.DRAFT, CycleStatus.ACTIVE}


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _to_float(name: str, value: float | int | None) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError) as err:
        raise HTTPException(status_code=400, detail=f"{name} must be numeric.") from err


def _to_int(name: str, value: int | None, *, min_value: int | None = None) -> int | None:
    if value is None:
        return None
    try:
        out = int(value)
    except (TypeError, ValueError) as err:
        raise HTTPException(status_code=400, detail=f"{name} must be an integer.") from err
    if min_value is not None and out < min_value:
        raise HTTPException(status_code=400, detail=f"{name} must be >= {min_value}.")
    return out


def _normalize_text(value: str | None, *, max_len: int | None = None) -> str | None:
    if value is None:
        return None
    cleaned = " ".join(value.split()).strip()
    if not cleaned:
        return None
    if max_len is not None and len(cleaned) > max_len:
        cleaned = cleaned[:max_len].rstrip()
    return cleaned or None


def _normalize_focus_tags(raw: list[str] | None) -> list[str]:
    if not raw:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        cleaned = _normalize_text(item, max_len=48)
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(cleaned)
        if len(out) >= 20:
            break
    return out


def _template_or_404(db: Session, template_id: uuid.UUID, *, owner_user_id: uuid.UUID | None) -> CycleTemplate:
    row = db.get(CycleTemplate, template_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Template not found.")
    if owner_user_id is not None and row.owner_user_id != owner_user_id:
        raise HTTPException(status_code=404, detail="Template not found.")
    return row


def _assignment_or_404(db: Session, assignment_id: uuid.UUID) -> CycleAssignment:
    row = db.get(CycleAssignment, assignment_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Assignment not found.")
    return row


def _blocks_for_micro_template(db: Session, template_id: uuid.UUID) -> list[MicroTemplateBlock]:
    return (
        db.execute(
            select(MicroTemplateBlock)
            .where(MicroTemplateBlock.template_id == template_id)
            .order_by(MicroTemplateBlock.sequence_index.asc())
        )
        .scalars()
        .all()
    )


def _assignment_blocks(db: Session, assignment_id: uuid.UUID) -> list[CycleAssignmentBlock]:
    return (
        db.execute(
            select(CycleAssignmentBlock)
            .where(CycleAssignmentBlock.assignment_id == assignment_id)
            .order_by(CycleAssignmentBlock.sequence_index.asc())
        )
        .scalars()
        .all()
    )


def _template_children(db: Session, parent_template_id: uuid.UUID) -> list[tuple[CycleTemplateLink, CycleTemplate]]:
    links = (
        db.execute(
            select(CycleTemplateLink)
            .where(CycleTemplateLink.parent_template_id == parent_template_id)
            .order_by(CycleTemplateLink.order_index.asc())
        )
        .scalars()
        .all()
    )
    if not links:
        return []

    out: list[tuple[CycleTemplateLink, CycleTemplate]] = []
    for link in links:
        child = db.get(CycleTemplate, link.child_template_id)
        if child is None:
            continue
        out.append((link, child))
    return out


def _serialize_template(row: CycleTemplate, *, block_count: int = 0) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "owner_user_id": str(row.owner_user_id),
        "level": row.level.value,
        "name": row.name,
        "objective": row.objective,
        "notes": row.notes,
        "status": row.status.value,
        "training_phase": row.training_phase,
        "nutrition_phase": row.nutrition_phase,
        "focus_tags": list(row.focus_tags or []),
        "duration_days": row.duration_days,
        "duration_weeks": row.duration_weeks,
        "block_count": block_count,
        "created_at_utc": row.created_at_utc.isoformat(),
        "updated_at_utc": row.updated_at_utc.isoformat(),
    }


def _serialize_micro_block(row: MicroTemplateBlock) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "template_id": str(row.template_id),
        "sequence_index": row.sequence_index,
        "relative_day": row.relative_day,
        "title": row.title,
        "objective": row.objective,
        "routine_snapshot": row.routine_snapshot,
        "target_volume": row.target_volume,
        "target_intensity": row.target_intensity,
        "target_fatigue": row.target_fatigue,
        "target_frequency": row.target_frequency,
        "meta": row.meta or {},
    }


def _serialize_assignment(row: CycleAssignment, *, template_name: str | None = None) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "athlete_id": row.athlete_id,
        "template_id": str(row.template_id),
        "template_name": template_name,
        "level": row.level.value,
        "assigned_by_user_id": str(row.assigned_by_user_id),
        "status": row.status.value,
        "start_mode": row.start_mode.value,
        "start_date": row.start_date.isoformat() if row.start_date else None,
        "tolerance_days": row.tolerance_days,
        "timezone": row.timezone,
        "started_at_utc": row.started_at_utc.isoformat() if row.started_at_utc else None,
        "completed_at_utc": row.completed_at_utc.isoformat() if row.completed_at_utc else None,
        "archived_at_utc": row.archived_at_utc.isoformat() if row.archived_at_utc else None,
        "created_at_utc": row.created_at_utc.isoformat(),
        "updated_at_utc": row.updated_at_utc.isoformat(),
    }


def _serialize_assignment_block(row: CycleAssignmentBlock) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "assignment_id": str(row.assignment_id),
        "micro_seq": row.micro_seq,
        "sequence_index": row.sequence_index,
        "relative_day": row.relative_day,
        "target_date": row.target_date.isoformat() if row.target_date else None,
        "title": row.title,
        "objective": row.objective,
        "routine_snapshot": row.routine_snapshot,
        "target_volume": row.target_volume,
        "target_intensity": row.target_intensity,
        "target_fatigue": row.target_fatigue,
        "target_frequency": row.target_frequency,
        "status": row.status.value,
        "completed_session_id": str(row.completed_session_id) if row.completed_session_id else None,
        "completed_at_utc": row.completed_at_utc.isoformat() if row.completed_at_utc else None,
    }
