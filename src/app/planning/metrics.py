from __future__ import annotations

import uuid
from collections import defaultdict
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    Athlete,
    CycleAssignment,
    CycleAssignmentBlock,
    CycleBlockStatus,
    CycleTemplate,
    TrainingSession,
)
from app.db.repo import ensure_athlete
from app.planning._common import (
    ACTIVE_ASSIGNMENT_STATES,
    _assignment_blocks,
    _assignment_or_404,
    _serialize_assignment,
)
from app.planning.assignments import _micro_to_meso_mapping


def _volume_sum(sessions: list[TrainingSession]) -> float:
    return sum(float(session.volume_load_kg or 0.0) for session in sessions)


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

    volume = _volume_sum(sessions)
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
        micro_volume = _volume_sum(micro_sessions)
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
