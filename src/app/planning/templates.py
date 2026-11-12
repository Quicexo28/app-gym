from __future__ import annotations

import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db.models import (
    CycleAssignment,
    CycleLevel,
    CycleStatus,
    CycleTemplate,
    CycleTemplateLink,
    MicroTemplateBlock,
)
from app.planning._common import (
    _blocks_for_micro_template,
    _normalize_focus_tags,
    _normalize_text,
    _serialize_micro_block,
    _serialize_template,
    _template_children,
    _template_or_404,
    _to_float,
    _to_int,
)


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
