from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import case, delete, func, select
from sqlalchemy.orm import Session

from app.db.models import (
    Athlete,
    CycleAssignment,
    CycleAssignmentBlock,
    CycleBlockStatus,
    CycleLevel,
    CycleStartMode,
    CycleStatus,
    CycleTemplate,
    CycleTemplateLink,
    MicroTemplateBlock,
    TrainingSession,
)
from app.db.repo import ensure_athlete


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


def list_templates(
    db: Session,
    *,
    owner_user_id: uuid.UUID,
    level: CycleLevel | None = None,
) -> list[dict[str, Any]]:
    q = select(CycleTemplate).where(CycleTemplate.owner_user_id == owner_user_id)
    if level is not None:
        q = q.where(CycleTemplate.level == level)
    rows = db.execute(q.order_by(CycleTemplate.updated_at_utc.desc())).scalars().all()

    template_ids = [row.id for row in rows]
    block_counts: dict[uuid.UUID, int] = {}
    if template_ids:
        counts = (
            db.execute(
                select(MicroTemplateBlock.template_id, func.count(MicroTemplateBlock.id))
                .where(MicroTemplateBlock.template_id.in_(template_ids))
                .group_by(MicroTemplateBlock.template_id)
            )
            .all()
        )
        block_counts = {template_id: int(count or 0) for template_id, count in counts}

    return [_serialize_template(row, block_count=block_counts.get(row.id, 0)) for row in rows]


def _replace_micro_blocks(
    db: Session,
    *,
    template_id: uuid.UUID,
    blocks: list[dict[str, Any]],
) -> list[str]:
    db.execute(delete(MicroTemplateBlock).where(MicroTemplateBlock.template_id == template_id))

    warnings: list[str] = []
    for idx, payload in enumerate(blocks, start=1):
        sequence_index = _to_int("sequence_index", payload.get("sequence_index"), min_value=1) or idx
        relative_day = _to_int("relative_day", payload.get("relative_day"), min_value=1)
        if relative_day is None:
            raise HTTPException(status_code=400, detail=f"blocks[{idx}].relative_day is required.")

        title = _normalize_text(payload.get("title"), max_len=180)
        if not title:
            title = f"Bloque {idx}"

        row = MicroTemplateBlock(
            id=uuid.uuid4(),
            template_id=template_id,
            sequence_index=sequence_index,
            relative_day=relative_day,
            title=title,
            objective=_normalize_text(payload.get("objective"), max_len=300),
            routine_snapshot=payload.get("routine_snapshot"),
            target_volume=_to_float("target_volume", payload.get("target_volume")),
            target_intensity=_to_float("target_intensity", payload.get("target_intensity")),
            target_fatigue=_to_float("target_fatigue", payload.get("target_fatigue")),
            target_frequency=_to_float("target_frequency", payload.get("target_frequency")),
            meta=payload.get("meta") if isinstance(payload.get("meta"), dict) else None,
        )
        db.add(row)

    if blocks:
        max_day = max(int(item.get("relative_day") or 1) for item in blocks)
        if max_day < 5 or max_day > 10:
            warnings.append(
                f"Microciclo con duracion relativa de {max_day} dias (fuera de rango usual 5-10, guardado con warning)."
            )
    return warnings


def create_template(
    db: Session,
    *,
    owner_user_id: uuid.UUID,
    level: CycleLevel,
    name: str,
    objective: str | None = None,
    notes: str | None = None,
    status: CycleStatus = CycleStatus.DRAFT,
    training_phase: str | None = None,
    nutrition_phase: str | None = None,
    focus_tags: list[str] | None = None,
    duration_days: int | None = None,
    duration_weeks: int | None = None,
    blocks: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    cleaned_name = _normalize_text(name, max_len=160)
    if not cleaned_name:
        raise HTTPException(status_code=400, detail="name is required.")

    row = CycleTemplate(
        id=uuid.uuid4(),
        owner_user_id=owner_user_id,
        level=level,
        name=cleaned_name,
        objective=_normalize_text(objective, max_len=280),
        notes=_normalize_text(notes),
        status=status,
        training_phase=_normalize_text(training_phase, max_len=120),
        nutrition_phase=_normalize_text(nutrition_phase, max_len=120),
        focus_tags=_normalize_focus_tags(focus_tags),
        duration_days=_to_int("duration_days", duration_days, min_value=1),
        duration_weeks=_to_int("duration_weeks", duration_weeks, min_value=1),
    )
    db.add(row)

    warnings: list[str] = []
    if level == CycleLevel.MICRO:
        if not blocks:
            raise HTTPException(status_code=400, detail="Micro template requires at least one block.")
        warnings = _replace_micro_blocks(db, template_id=row.id, blocks=blocks or [])
    elif blocks:
        raise HTTPException(status_code=400, detail="blocks only apply to micro templates.")

    db.commit()
    db.refresh(row)
    response = _serialize_template(row, block_count=len(blocks or []))
    response["warnings"] = warnings
    return response


def update_template(
    db: Session,
    *,
    owner_user_id: uuid.UUID,
    template_id: uuid.UUID,
    name: str | None = None,
    objective: str | None = None,
    notes: str | None = None,
    status: CycleStatus | None = None,
    training_phase: str | None = None,
    nutrition_phase: str | None = None,
    focus_tags: list[str] | None = None,
    duration_days: int | None = None,
    duration_weeks: int | None = None,
    blocks: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    row = _template_or_404(db, template_id, owner_user_id=owner_user_id)

    if name is not None:
        cleaned_name = _normalize_text(name, max_len=160)
        if not cleaned_name:
            raise HTTPException(status_code=400, detail="name cannot be empty.")
        row.name = cleaned_name
    if objective is not None:
        row.objective = _normalize_text(objective, max_len=280)
    if notes is not None:
        row.notes = _normalize_text(notes)
    if status is not None:
        row.status = status
    if training_phase is not None:
        row.training_phase = _normalize_text(training_phase, max_len=120)
    if nutrition_phase is not None:
        row.nutrition_phase = _normalize_text(nutrition_phase, max_len=120)
    if focus_tags is not None:
        row.focus_tags = _normalize_focus_tags(focus_tags)
    if duration_days is not None:
        row.duration_days = _to_int("duration_days", duration_days, min_value=1)
    if duration_weeks is not None:
        row.duration_weeks = _to_int("duration_weeks", duration_weeks, min_value=1)

    warnings: list[str] = []
    if blocks is not None:
        if row.level != CycleLevel.MICRO:
            raise HTTPException(status_code=400, detail="blocks only apply to micro templates.")
        if not blocks:
            raise HTTPException(status_code=400, detail="Micro template requires at least one block.")
        warnings = _replace_micro_blocks(db, template_id=row.id, blocks=blocks)

    db.commit()
    db.refresh(row)
    block_count = (
        db.execute(
            select(func.count(MicroTemplateBlock.id)).where(MicroTemplateBlock.template_id == row.id)
        ).scalar_one()
        or 0
    )
    response = _serialize_template(row, block_count=int(block_count))
    response["warnings"] = warnings
    return response


def delete_template(db: Session, *, owner_user_id: uuid.UUID, template_id: uuid.UUID) -> dict[str, Any]:
    row = _template_or_404(db, template_id, owner_user_id=owner_user_id)
    in_use = (
        db.execute(select(func.count(CycleAssignment.id)).where(CycleAssignment.template_id == row.id)).scalar_one()
        or 0
    )
    if int(in_use) > 0:
        raise HTTPException(
            status_code=409,
            detail="Template is already assigned and cannot be deleted.",
        )

    db.execute(
        delete(CycleTemplateLink).where(
            CycleTemplateLink.parent_template_id == row.id,
        )
    )
    db.execute(
        delete(CycleTemplateLink).where(
            CycleTemplateLink.child_template_id == row.id,
        )
    )
    db.execute(delete(MicroTemplateBlock).where(MicroTemplateBlock.template_id == row.id))
    db.delete(row)
    db.commit()
    return {"ok": True, "id": str(template_id)}


def _validate_template_link(parent: CycleTemplate, child: CycleTemplate) -> None:
    if parent.id == child.id:
        raise HTTPException(status_code=400, detail="Template cannot link to itself.")
    if parent.level == CycleLevel.MACRO and child.level == CycleLevel.MESO:
        return
    if parent.level == CycleLevel.MESO and child.level == CycleLevel.MICRO:
        return
    raise HTTPException(
        status_code=400,
        detail="Invalid hierarchy. Only macro->meso and meso->micro are allowed.",
    )


def _all_descendants(db: Session, template_id: uuid.UUID) -> set[uuid.UUID]:
    visited: set[uuid.UUID] = set()
    stack = [template_id]
    while stack:
        current = stack.pop()
        children = (
            db.execute(
                select(CycleTemplateLink.child_template_id).where(
                    CycleTemplateLink.parent_template_id == current
                )
            )
            .scalars()
            .all()
        )
        for child_id in children:
            if child_id in visited:
                continue
            visited.add(child_id)
            stack.append(child_id)
    return visited


def add_template_child(
    db: Session,
    *,
    owner_user_id: uuid.UUID,
    parent_template_id: uuid.UUID,
    child_template_id: uuid.UUID,
    order_index: int,
) -> dict[str, Any]:
    parent = _template_or_404(db, parent_template_id, owner_user_id=owner_user_id)
    child = _template_or_404(db, child_template_id, owner_user_id=owner_user_id)
    _validate_template_link(parent, child)

    if parent.id in _all_descendants(db, child.id):
        raise HTTPException(status_code=400, detail="Link would create a cycle.")

    order = _to_int("order_index", order_index, min_value=1)
    assert order is not None

    existing = db.execute(
        select(CycleTemplateLink).where(
            CycleTemplateLink.parent_template_id == parent.id,
            CycleTemplateLink.child_template_id == child.id,
        )
    ).scalar_one_or_none()
    if existing is None:
        existing = CycleTemplateLink(
            id=uuid.uuid4(),
            parent_template_id=parent.id,
            child_template_id=child.id,
            order_index=order,
        )
        db.add(existing)
    else:
        existing.order_index = order

    db.commit()
    db.refresh(existing)
    return {
        "id": str(existing.id),
        "parent_template_id": str(existing.parent_template_id),
        "child_template_id": str(existing.child_template_id),
        "order_index": existing.order_index,
    }


def _build_template_tree(
    db: Session,
    row: CycleTemplate,
    *,
    owner_user_id: uuid.UUID,
    visited: set[uuid.UUID],
) -> dict[str, Any]:
    if row.id in visited:
        return {
            **_serialize_template(row),
            "children": [],
            "blocks": [],
            "cycle_detected": True,
        }

    branch_visited = set(visited)
    branch_visited.add(row.id)
    children_payload: list[dict[str, Any]] = []
    for link, child in _template_children(db, row.id):
        if child.owner_user_id != owner_user_id:
            continue
        child_payload = _build_template_tree(
            db,
            child,
            owner_user_id=owner_user_id,
            visited=branch_visited,
        )
        child_payload["order_index"] = link.order_index
        children_payload.append(child_payload)

    blocks: list[dict[str, Any]] = []
    if row.level == CycleLevel.MICRO:
        blocks = [_serialize_micro_block(block) for block in _blocks_for_micro_template(db, row.id)]

    return {
        **_serialize_template(row, block_count=len(blocks)),
        "children": children_payload,
        "blocks": blocks,
    }


def get_template_tree(
    db: Session,
    *,
    owner_user_id: uuid.UUID,
    template_id: uuid.UUID,
) -> dict[str, Any]:
    root = _template_or_404(db, template_id, owner_user_id=owner_user_id)
    return _build_template_tree(db, root, owner_user_id=owner_user_id, visited=set())


def _micro_duration_days(row: CycleTemplate, blocks: list[MicroTemplateBlock]) -> int:
    if row.duration_days and row.duration_days > 0:
        return int(row.duration_days)
    if blocks:
        return max(int(block.relative_day) for block in blocks)
    if row.duration_weeks and row.duration_weeks > 0:
        return int(row.duration_weeks * 7)
    return 7


def _expand_micro_templates_for_template(db: Session, template: CycleTemplate) -> list[CycleTemplate]:
    if template.level == CycleLevel.MICRO:
        return [template]

    if template.level == CycleLevel.MESO:
        micros: list[CycleTemplate] = []
        for _, child in _template_children(db, template.id):
            if child.level != CycleLevel.MICRO:
                raise HTTPException(status_code=400, detail="Meso template contains non-micro child.")
            micros.append(child)
        return micros

    if template.level == CycleLevel.MACRO:
        micros = []
        for _, meso in _template_children(db, template.id):
            if meso.level != CycleLevel.MESO:
                raise HTTPException(status_code=400, detail="Macro template contains non-meso child.")
            for _, micro in _template_children(db, meso.id):
                if micro.level != CycleLevel.MICRO:
                    raise HTTPException(status_code=400, detail="Meso template contains non-micro child.")
                micros.append(micro)
        return micros

    raise HTTPException(status_code=400, detail="Invalid template level.")


def _micro_to_meso_mapping(db: Session, template: CycleTemplate) -> dict[int, int]:
    if template.level == CycleLevel.MICRO:
        return {1: 1}

    if template.level == CycleLevel.MESO:
        micros = _expand_micro_templates_for_template(db, template)
        return {idx: 1 for idx in range(1, len(micros) + 1)}

    if template.level == CycleLevel.MACRO:
        mapping: dict[int, int] = {}
        micro_seq = 0
        meso_seq = 0
        for _, meso in _template_children(db, template.id):
            if meso.level != CycleLevel.MESO:
                continue
            meso_seq += 1
            for _, micro in _template_children(db, meso.id):
                if micro.level != CycleLevel.MICRO:
                    continue
                micro_seq += 1
                mapping[micro_seq] = meso_seq
        return mapping

    return {}


def _expand_template_into_assignment_blocks(
    db: Session,
    *,
    template: CycleTemplate,
) -> tuple[list[dict[str, Any]], list[str]]:
    micro_templates = _expand_micro_templates_for_template(db, template)
    if not micro_templates:
        raise HTTPException(
            status_code=400,
            detail="Template has no micro cycles to expand.",
        )

    out: list[dict[str, Any]] = []
    warnings: list[str] = []
    seq = 1
    day_offset = 0

    for micro_seq, micro in enumerate(micro_templates, start=1):
        blocks = _blocks_for_micro_template(db, micro.id)
        duration_days = _micro_duration_days(micro, blocks)
        if duration_days < 5 or duration_days > 10:
            warnings.append(
                f'Micro "{micro.name}" dura {duration_days} dias (fuera de rango 5-10, guardado con warning).'
            )

        if not blocks:
            warnings.append(f'Micro "{micro.name}" no tiene bloques; se reserva ventana sin sesiones objetivo.')
            day_offset += duration_days
            continue

        for block in blocks:
            out.append(
                {
                    "micro_seq": micro_seq,
                    "sequence_index": seq,
                    "relative_day": day_offset + int(block.relative_day),
                    "title": block.title,
                    "objective": block.objective,
                    "routine_snapshot": block.routine_snapshot,
                    "target_volume": block.target_volume,
                    "target_intensity": block.target_intensity,
                    "target_fatigue": block.target_fatigue,
                    "target_frequency": block.target_frequency,
                }
            )
            seq += 1

        day_offset += duration_days

    if not out:
        raise HTTPException(status_code=400, detail="Template expansion produced zero session blocks.")

    return out, warnings


def _assignment_template_name(db: Session, template_id: uuid.UUID) -> str | None:
    return db.execute(select(CycleTemplate.name).where(CycleTemplate.id == template_id)).scalar_one_or_none()


def _assert_no_level_overlap(
    db: Session,
    *,
    athlete_id: str,
    level: CycleLevel,
    exclude_assignment_id: uuid.UUID | None = None,
) -> None:
    q = select(CycleAssignment.id).where(
        CycleAssignment.athlete_id == athlete_id,
        CycleAssignment.level == level,
        CycleAssignment.status.in_(tuple(ACTIVE_ASSIGNMENT_STATES)),
    )
    if exclude_assignment_id is not None:
        q = q.where(CycleAssignment.id != exclude_assignment_id)
    existing = db.execute(q.limit(1)).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail="There is already an active/draft assignment for this athlete and level.",
        )


def _assign_target_dates(assignment: CycleAssignment, blocks: list[CycleAssignmentBlock]) -> None:
    if assignment.start_date is None:
        for block in blocks:
            block.target_date = None
        return

    for block in blocks:
        block.target_date = assignment.start_date + timedelta(days=max(0, block.relative_day - 1))


def create_assignment(
    db: Session,
    *,
    athlete_id: str,
    template_id: uuid.UUID,
    template_owner_user_id: uuid.UUID | None,
    assigned_by_user_id: uuid.UUID,
    start_mode: CycleStartMode = CycleStartMode.AUTO_ON_FIRST_SESSION,
    start_date: date | None = None,
    tolerance_days: int = DEFAULT_TOLERANCE_DAYS,
    timezone: str = DEFAULT_TIMEZONE,
) -> dict[str, Any]:
    clean_athlete_id = athlete_id.strip()
    if not clean_athlete_id:
        raise HTTPException(status_code=400, detail="athlete_id is required.")

    ensure_athlete(db, clean_athlete_id)
    template = _template_or_404(db, template_id, owner_user_id=template_owner_user_id)
    _assert_no_level_overlap(db, athlete_id=clean_athlete_id, level=template.level)

    tolerance = _to_int("tolerance_days", tolerance_days, min_value=0)
    assert tolerance is not None

    expanded_blocks, warnings = _expand_template_into_assignment_blocks(db, template=template)

    normalized_timezone = _normalize_text(timezone, max_len=64) or DEFAULT_TIMEZONE
    should_activate = start_mode == CycleStartMode.MANUAL and start_date is not None
    status = CycleStatus.ACTIVE if should_activate else CycleStatus.DRAFT
    now = _now_utc()

    assignment = CycleAssignment(
        id=uuid.uuid4(),
        athlete_id=clean_athlete_id,
        template_id=template.id,
        level=template.level,
        assigned_by_user_id=assigned_by_user_id,
        status=status,
        start_mode=start_mode,
        start_date=start_date,
        tolerance_days=tolerance,
        timezone=normalized_timezone,
        started_at_utc=now if should_activate else None,
        completed_at_utc=None,
        archived_at_utc=None,
    )
    db.add(assignment)

    assignment_rows: list[CycleAssignmentBlock] = []
    for payload in expanded_blocks:
        assignment_rows.append(
            CycleAssignmentBlock(
                id=uuid.uuid4(),
                assignment_id=assignment.id,
                micro_seq=int(payload["micro_seq"]),
                sequence_index=int(payload["sequence_index"]),
                relative_day=int(payload["relative_day"]),
                title=str(payload["title"]),
                objective=payload.get("objective"),
                routine_snapshot=payload.get("routine_snapshot"),
                target_volume=_to_float("target_volume", payload.get("target_volume")),
                target_intensity=_to_float("target_intensity", payload.get("target_intensity")),
                target_fatigue=_to_float("target_fatigue", payload.get("target_fatigue")),
                target_frequency=_to_float("target_frequency", payload.get("target_frequency")),
                status=CycleBlockStatus.PENDING,
            )
        )

    for block in assignment_rows:
        db.add(block)

    _assign_target_dates(assignment, assignment_rows)
    db.commit()
    db.refresh(assignment)

    assignment_payload = _serialize_assignment(
        assignment,
        template_name=_assignment_template_name(db, assignment.template_id),
    )
    assignment_payload["warnings"] = warnings
    assignment_payload["blocks_total"] = len(assignment_rows)
    return assignment_payload


def list_assignments(
    db: Session,
    *,
    athlete_ids: list[str],
    status: CycleStatus | None = None,
) -> list[dict[str, Any]]:
    clean_ids = [value.strip() for value in athlete_ids if value and value.strip()]
    if not clean_ids:
        return []

    q = select(CycleAssignment).where(CycleAssignment.athlete_id.in_(clean_ids))
    if status is not None:
        q = q.where(CycleAssignment.status == status)
    rows = db.execute(q.order_by(CycleAssignment.created_at_utc.desc())).scalars().all()

    template_ids = {row.template_id for row in rows}
    template_names: dict[uuid.UUID, str] = {}
    if template_ids:
        pairs = db.execute(
            select(CycleTemplate.id, CycleTemplate.name).where(CycleTemplate.id.in_(template_ids))
        ).all()
        template_names = {template_id: name for template_id, name in pairs}

    counts: dict[uuid.UUID, tuple[int, int]] = {}
    if rows:
        assignment_ids = [row.id for row in rows]
        count_rows = db.execute(
            select(
                CycleAssignmentBlock.assignment_id,
                func.count(CycleAssignmentBlock.id),
                func.sum(
                    case(
                        (CycleAssignmentBlock.status == CycleBlockStatus.COMPLETED, 1),
                        else_=0,
                    )
                ),
            )
            .where(CycleAssignmentBlock.assignment_id.in_(assignment_ids))
            .group_by(CycleAssignmentBlock.assignment_id)
        ).all()
        counts = {
            assignment_id: (int(total or 0), int(completed or 0))
            for assignment_id, total, completed in count_rows
        }

    out: list[dict[str, Any]] = []
    for row in rows:
        payload = _serialize_assignment(row, template_name=template_names.get(row.template_id))
        total, completed = counts.get(row.id, (0, 0))
        payload["blocks_total"] = total
        payload["blocks_completed"] = completed
        payload["adherence"] = (completed / total) if total else 0.0
        out.append(payload)
    return out


def get_assignment_detail(db: Session, *, assignment_id: uuid.UUID) -> dict[str, Any]:
    assignment = _assignment_or_404(db, assignment_id)
    blocks = _assignment_blocks(db, assignment.id)
    payload = _serialize_assignment(
        assignment,
        template_name=_assignment_template_name(db, assignment.template_id),
    )
    payload["blocks"] = [_serialize_assignment_block(block) for block in blocks]
    payload["blocks_total"] = len(blocks)
    payload["blocks_completed"] = len([block for block in blocks if block.status == CycleBlockStatus.COMPLETED])
    return payload


def patch_assignment_status(
    db: Session,
    *,
    assignment_id: uuid.UUID,
    next_status: CycleStatus,
) -> dict[str, Any]:
    row = _assignment_or_404(db, assignment_id)
    now = _now_utc()

    if next_status in ACTIVE_ASSIGNMENT_STATES:
        _assert_no_level_overlap(
            db,
            athlete_id=row.athlete_id,
            level=row.level,
            exclude_assignment_id=row.id,
        )

    row.status = next_status
    if next_status == CycleStatus.ACTIVE and row.started_at_utc is None:
        row.started_at_utc = now
    if next_status == CycleStatus.COMPLETED:
        row.completed_at_utc = now
    if next_status == CycleStatus.ARCHIVED:
        row.archived_at_utc = now

    db.commit()
    db.refresh(row)
    return _serialize_assignment(row, template_name=_assignment_template_name(db, row.template_id))


def _start_date_from_first_session(db: Session, assignment: CycleAssignment) -> date | None:
    first_session = (
        db.execute(
            select(TrainingSession.start_time)
            .where(
                TrainingSession.athlete_id == assignment.athlete_id,
                TrainingSession.start_time >= assignment.created_at_utc,
            )
            .order_by(TrainingSession.start_time.asc())
            .limit(1)
        )
        .scalar_one_or_none()
    )
    if first_session is None:
        return None
    return first_session.date()


def _reconcile_assignment_inplace(db: Session, assignment: CycleAssignment) -> dict[str, Any]:
    if assignment.status == CycleStatus.ARCHIVED:
        return {
            "assignment_id": str(assignment.id),
            "status": assignment.status.value,
            "updated": False,
            "completed_now": 0,
        }

    blocks = _assignment_blocks(db, assignment.id)
    if not blocks:
        return {
            "assignment_id": str(assignment.id),
            "status": assignment.status.value,
            "updated": False,
            "completed_now": 0,
        }

    updated = False
    now = _now_utc()

    if assignment.start_date is None and assignment.start_mode == CycleStartMode.AUTO_ON_FIRST_SESSION:
        detected = _start_date_from_first_session(db, assignment)
        if detected is not None:
            assignment.start_date = detected
            assignment.started_at_utc = assignment.started_at_utc or now
            if assignment.status == CycleStatus.DRAFT:
                assignment.status = CycleStatus.ACTIVE
            updated = True

    if assignment.start_date is not None:
        for block in blocks:
            expected_target_date = assignment.start_date + timedelta(days=max(0, block.relative_day - 1))
            if block.target_date != expected_target_date:
                block.target_date = expected_target_date
                updated = True

    used_session_ids: set[uuid.UUID] = {
        block.completed_session_id for block in blocks if block.completed_session_id is not None
    }

    candidate_sessions = (
        db.execute(
            select(TrainingSession)
            .where(
                TrainingSession.athlete_id == assignment.athlete_id,
                TrainingSession.start_time >= assignment.created_at_utc,
            )
            .order_by(TrainingSession.start_time.asc())
        )
        .scalars()
        .all()
    )

    completed_now = 0
    for block in blocks:
        if block.status != CycleBlockStatus.PENDING:
            continue
        if block.target_date is None:
            continue

        best: TrainingSession | None = None
        best_distance = 10**9
        for session in candidate_sessions:
            if session.id in used_session_ids:
                continue
            day_delta = abs((session.start_time.date() - block.target_date).days)
            if day_delta > assignment.tolerance_days:
                continue
            if day_delta < best_distance:
                best = session
                best_distance = day_delta
            elif day_delta == best_distance and best is not None and session.start_time < best.start_time:
                best = session

        if best is None:
            continue

        block.status = CycleBlockStatus.COMPLETED
        block.completed_session_id = best.id
        block.completed_at_utc = now
        used_session_ids.add(best.id)
        completed_now += 1
        updated = True

    if completed_now > 0 and assignment.status == CycleStatus.DRAFT:
        assignment.status = CycleStatus.ACTIVE
        assignment.started_at_utc = assignment.started_at_utc or now
        updated = True

    pending_blocks = [block for block in blocks if block.status == CycleBlockStatus.PENDING]
    if not pending_blocks and assignment.status not in {CycleStatus.COMPLETED, CycleStatus.ARCHIVED}:
        assignment.status = CycleStatus.COMPLETED
        assignment.completed_at_utc = now
        updated = True

    return {
        "assignment_id": str(assignment.id),
        "status": assignment.status.value,
        "updated": updated,
        "completed_now": completed_now,
    }


def reconcile_assignment(db: Session, *, assignment_id: uuid.UUID) -> dict[str, Any]:
    assignment = _assignment_or_404(db, assignment_id)
    if assignment.status == CycleStatus.ARCHIVED:
        raise HTTPException(status_code=409, detail="Archived assignment cannot be reconciled.")

    result = _reconcile_assignment_inplace(db, assignment)
    db.commit()
    return result


def reconcile_active_assignments_for_athletes(db: Session, *, athlete_ids: set[str]) -> dict[str, list[dict[str, Any]]]:
    clean_ids = {value.strip() for value in athlete_ids if value and value.strip()}
    if not clean_ids:
        return {}

    rows = (
        db.execute(
            select(CycleAssignment).where(
                CycleAssignment.athlete_id.in_(clean_ids),
                CycleAssignment.status.in_(tuple(ACTIVE_ASSIGNMENT_STATES)),
            )
        )
        .scalars()
        .all()
    )
    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    updated_any = False
    for row in rows:
        summary = _reconcile_assignment_inplace(db, row)
        out[row.athlete_id].append(summary)
        if summary["updated"]:
            updated_any = True
    if updated_any:
        db.commit()
    return dict(out)


def metrics_for_assignment(db: Session, *, assignment_id: uuid.UUID) -> dict[str, Any]:
    assignment = _assignment_or_404(db, assignment_id)
    template = db.get(CycleTemplate, assignment.template_id)
    blocks = _assignment_blocks(db, assignment.id)

    completed_blocks = [block for block in blocks if block.status == CycleBlockStatus.COMPLETED]
    total_blocks = len(blocks)
    completed_total = len(completed_blocks)
    adherence = (completed_total / total_blocks) if total_blocks else 0.0

    session_ids = [block.completed_session_id for block in completed_blocks if block.completed_session_id is not None]
    sessions: list[TrainingSession] = []
    if session_ids:
        sessions = (
            db.execute(select(TrainingSession).where(TrainingSession.id.in_(session_ids)))
            .scalars()
            .all()
        )

    volume = sum(float(session.volume_load_kg or 0.0) for session in sessions)
    rpe_values = [float(session.rpe) for session in sessions if session.rpe is not None]
    intensity_avg = (sum(rpe_values) / len(rpe_values)) if rpe_values else None
    fatigue = 0.0
    for session in sessions:
        if session.srpe_load is not None:
            fatigue += float(session.srpe_load)
            continue
        if session.rpe is not None:
            fatigue += float(session.rpe) * float(session.duration_min)

    micro_rollups: list[dict[str, Any]] = []
    grouped_blocks: dict[int, list[CycleAssignmentBlock]] = defaultdict(list)
    for block in blocks:
        grouped_blocks[block.micro_seq].append(block)

    block_by_session_id = {
        block.completed_session_id: block
        for block in completed_blocks
        if block.completed_session_id is not None
    }
    sessions_by_micro: dict[int, list[TrainingSession]] = defaultdict(list)
    for session in sessions:
        linked_block = block_by_session_id.get(session.id)
        if linked_block is None:
            continue
        sessions_by_micro[linked_block.micro_seq].append(session)

    for micro_seq in sorted(grouped_blocks):
        micro_blocks = grouped_blocks[micro_seq]
        micro_completed = [block for block in micro_blocks if block.status == CycleBlockStatus.COMPLETED]
        micro_sessions = sessions_by_micro.get(micro_seq, [])
        micro_volume = sum(float(session.volume_load_kg or 0.0) for session in micro_sessions)
        micro_rpe_values = [float(session.rpe) for session in micro_sessions if session.rpe is not None]
        micro_intensity = (sum(micro_rpe_values) / len(micro_rpe_values)) if micro_rpe_values else None
        micro_fatigue = 0.0
        for session in micro_sessions:
            if session.srpe_load is not None:
                micro_fatigue += float(session.srpe_load)
            elif session.rpe is not None:
                micro_fatigue += float(session.rpe) * float(session.duration_min)
        micro_rollups.append(
            {
                "micro_seq": micro_seq,
                "blocks_total": len(micro_blocks),
                "blocks_completed": len(micro_completed),
                "adherence": (len(micro_completed) / len(micro_blocks)) if micro_blocks else 0.0,
                "volume_load_kg": micro_volume,
                "intensity_avg_rpe": micro_intensity,
                "fatigue_load": micro_fatigue,
                "frequency_sessions": len(micro_sessions),
            }
        )

    meso_rollups: list[dict[str, Any]] = []
    if template is not None:
        micro_to_meso = _micro_to_meso_mapping(db, template)
        grouped_meso: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for micro in micro_rollups:
            meso_seq = micro_to_meso.get(int(micro["micro_seq"]), 1)
            grouped_meso[meso_seq].append(micro)

        for meso_seq in sorted(grouped_meso):
            micros = grouped_meso[meso_seq]
            blocks_total_sum = sum(int(micro["blocks_total"]) for micro in micros)
            blocks_completed_sum = sum(int(micro["blocks_completed"]) for micro in micros)
            volume_sum = sum(float(micro["volume_load_kg"]) for micro in micros)
            fatigue_sum = sum(float(micro["fatigue_load"]) for micro in micros)
            sessions_sum = sum(int(micro["frequency_sessions"]) for micro in micros)

            weighted_rpe_total = 0.0
            weighted_rpe_count = 0
            for micro in micros:
                intensity = micro.get("intensity_avg_rpe")
                freq = int(micro["frequency_sessions"])
                if intensity is None or freq <= 0:
                    continue
                weighted_rpe_total += float(intensity) * freq
                weighted_rpe_count += freq
            meso_intensity = (weighted_rpe_total / weighted_rpe_count) if weighted_rpe_count else None

            meso_rollups.append(
                {
                    "meso_seq": meso_seq,
                    "blocks_total": blocks_total_sum,
                    "blocks_completed": blocks_completed_sum,
                    "adherence": (blocks_completed_sum / blocks_total_sum) if blocks_total_sum else 0.0,
                    "volume_load_kg": volume_sum,
                    "intensity_avg_rpe": meso_intensity,
                    "fatigue_load": fatigue_sum,
                    "frequency_sessions": sessions_sum,
                }
            )

    macro_rollup = {
        "blocks_total": total_blocks,
        "blocks_completed": completed_total,
        "adherence": adherence,
        "volume_load_kg": volume,
        "intensity_avg_rpe": intensity_avg,
        "fatigue_load": fatigue,
        "frequency_sessions": len(sessions),
    }

    return {
        "assignment_id": str(assignment.id),
        "athlete_id": assignment.athlete_id,
        "level": assignment.level.value,
        "status": assignment.status.value,
        "totals": {
            "volume_load_kg": volume,
            "intensity_avg_rpe": intensity_avg,
            "fatigue_load": fatigue,
            "frequency_sessions": len(sessions),
            "adherence": adherence,
            "blocks_total": total_blocks,
            "blocks_completed": completed_total,
        },
        "micro_rollups": micro_rollups,
        "meso_rollups": meso_rollups,
        "macro_rollup": macro_rollup,
    }


def athlete_overview(db: Session, *, athlete_id: str) -> dict[str, Any]:
    clean_athlete_id = athlete_id.strip()
    if not clean_athlete_id:
        raise HTTPException(status_code=400, detail="athlete_id is required.")
    if db.get(Athlete, clean_athlete_id) is None:
        ensure_athlete(db, clean_athlete_id)

    assignments = (
        db.execute(
            select(CycleAssignment)
            .where(CycleAssignment.athlete_id == clean_athlete_id)
            .order_by(CycleAssignment.created_at_utc.desc())
            .limit(30)
        )
        .scalars()
        .all()
    )
    assignment_ids = [item.id for item in assignments]
    block_rows: list[CycleAssignmentBlock] = []
    if assignment_ids:
        block_rows = (
            db.execute(
                select(CycleAssignmentBlock).where(
                    CycleAssignmentBlock.assignment_id.in_(assignment_ids)
                )
            )
            .scalars()
            .all()
        )

    blocks_by_assignment: dict[uuid.UUID, list[CycleAssignmentBlock]] = defaultdict(list)
    for row in block_rows:
        blocks_by_assignment[row.assignment_id].append(row)

    template_ids = {row.template_id for row in assignments}
    template_map: dict[uuid.UUID, str] = {}
    if template_ids:
        template_map = {
            item_id: item_name
            for item_id, item_name in db.execute(
                select(CycleTemplate.id, CycleTemplate.name).where(CycleTemplate.id.in_(template_ids))
            ).all()
        }

    active_items: list[dict[str, Any]] = []
    recent_items: list[dict[str, Any]] = []
    for assignment in assignments:
        payload = _serialize_assignment(assignment, template_name=template_map.get(assignment.template_id))
        blocks = sorted(blocks_by_assignment.get(assignment.id, []), key=lambda item: item.sequence_index)
        pending = [block for block in blocks if block.status == CycleBlockStatus.PENDING]
        completed = [block for block in blocks if block.status == CycleBlockStatus.COMPLETED]
        payload["blocks_total"] = len(blocks)
        payload["blocks_completed"] = len(completed)
        payload["adherence"] = (len(completed) / len(blocks)) if blocks else 0.0
        payload["next_blocks"] = [
            {
                "id": str(block.id),
                "title": block.title,
                "target_date": block.target_date.isoformat() if block.target_date else None,
                "relative_day": block.relative_day,
            }
            for block in pending[:3]
        ]
        recent_items.append(payload)
        if assignment.status in ACTIVE_ASSIGNMENT_STATES:
            active_items.append(payload)

    return {
        "athlete_id": clean_athlete_id,
        "active_assignments": active_items,
        "recent_assignments": recent_items[:10],
    }
