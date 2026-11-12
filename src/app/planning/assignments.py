from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.db.models import (
    CycleAssignment,
    CycleAssignmentBlock,
    CycleBlockStatus,
    CycleLevel,
    CycleStartMode,
    CycleStatus,
    CycleTemplate,
    MicroTemplateBlock,
    TrainingSession,
)
from app.db.repo import ensure_athlete
from app.planning._common import (
    ACTIVE_ASSIGNMENT_STATES,
    DEFAULT_TIMEZONE,
    DEFAULT_TOLERANCE_DAYS,
    _assignment_blocks,
    _assignment_or_404,
    _blocks_for_micro_template,
    _normalize_text,
    _now_utc,
    _serialize_assignment,
    _serialize_assignment_block,
    _template_children,
    _template_or_404,
    _to_float,
    _to_int,
)


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
