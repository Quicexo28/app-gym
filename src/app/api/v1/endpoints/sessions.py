from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth.athlete_access import require_athlete_access, require_athlete_access_many
from app.auth.deps import get_current_user
from app.coach.reports import build_session_report
from app.db.engine import get_db
from app.db.models import CoachReport, CoachReportKind, TrainingSession
from app.db.models_auth import User
from app.db.repo import (
    find_previous_session_same_routine,
    get_session_by_key,
    list_sessions_for_athlete,
    upsert_session,
)
from app.planning.service import reconcile_active_assignments_for_athletes
from coach_ai.training_core import Session as DomainSession
from coach_ai.training_core import StrengthExercise
from coach_ai.training_core.metrics import compute_session_metrics

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _generate_session_report(db: DbSession, athlete_id: str, start_time: datetime) -> None:
    session_row = get_session_by_key(db, athlete_id, start_time)
    if session_row is None:
        return

    meta = session_row.meta or {}
    previous = find_previous_session_same_routine(
        db, athlete_id, meta.get("routine_id"), start_time
    )
    payload = build_session_report(session_row, previous)

    db.add(
        CoachReport(
            athlete_id=athlete_id,
            kind=CoachReportKind.SESSION_COMPLETED,
            ref_id=str(session_row.id),
            payload=payload,
        )
    )
    db.commit()


@router.post("/batch")
def ingest_sessions(
    sessions: list[DomainSession],
    user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
) -> dict:
    athlete_ids = {session.athlete_id for session in sessions}
    require_athlete_access_many(db, user, athlete_ids)

    inserted = 0
    duplicates = 0
    results = []

    for s in sessions:
        r = upsert_session(db, s)
        results.append(r)
        if r["inserted"]:
            inserted += 1
            _generate_session_report(db, s.athlete_id, s.start_time)
        else:
            duplicates += 1

    planning_reconcile = reconcile_active_assignments_for_athletes(db, athlete_ids=athlete_ids)
    return {
        "inserted": inserted,
        "duplicates": duplicates,
        "results": results,
        "planning_reconcile": planning_reconcile,
    }


@router.get("/{athlete_id}")
def get_sessions(
    athlete_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
) -> list[DomainSession]:
    require_athlete_access(db, user, athlete_id)
    return list_sessions_for_athlete(db, athlete_id)


class SessionHistoryItem(BaseModel):
    id: uuid.UUID
    athlete_id: str
    start_time: datetime
    duration_min: float
    rpe: float | None
    modality: str | None
    source: str | None
    routine_name: str | None
    note: str | None
    volume_load_kg: float | None
    sets_total: int | None
    reps_total: int | None
    exercises: list[dict[str, Any]]
    # Metadatos completos: el cliente los necesita para restaurar la sesión al deshacer un borrado.
    meta: dict[str, Any]


class SessionUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    duration_min: float | None = Field(default=None, gt=0, le=1440)
    rpe: float | None = Field(default=None, ge=0, le=10)
    note: str | None = Field(default=None, max_length=2000)
    exercises: list[StrengthExercise] | None = None


def _history_item(row: TrainingSession) -> SessionHistoryItem:
    meta = row.meta or {}
    return SessionHistoryItem(
        id=row.id,
        athlete_id=row.athlete_id,
        start_time=row.start_time,
        duration_min=row.duration_min,
        rpe=row.rpe,
        modality=row.modality,
        source=row.source,
        routine_name=meta.get("routine_name"),
        note=meta.get("note"),
        volume_load_kg=row.volume_load_kg,
        sets_total=row.sets_total,
        reps_total=row.reps_total,
        exercises=row.exercises or [],
        meta=meta,
    )


def _get_row_or_404(db: Session, session_id: uuid.UUID) -> TrainingSession:
    row = db.get(TrainingSession, session_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Sesión no encontrada.")
    return row


def _apply_update(row: TrainingSession, body: SessionUpdateRequest) -> None:
    """Aplica los campos enviados y recalcula las métricas guardadas de la fila."""
    fields = body.model_fields_set
    if "duration_min" in fields and body.duration_min is not None:
        row.duration_min = float(body.duration_min)
    if "rpe" in fields:
        row.rpe = None if body.rpe is None else float(body.rpe)
    if "exercises" in fields and body.exercises is not None:
        row.exercises = [ex.model_dump() for ex in body.exercises]
    if "note" in fields:
        meta = dict(row.meta or {})
        note = (body.note or "").strip()
        if note:
            meta["note"] = note
        else:
            meta.pop("note", None)
        row.meta = meta

    metrics = compute_session_metrics(
        DomainSession(
            athlete_id=row.athlete_id,
            start_time=row.start_time,
            duration_min=row.duration_min,
            rpe=row.rpe,
            modality=row.modality,
            exercises=row.exercises or [],
        )
    )
    row.volume_load_kg = metrics.volume_load_kg
    row.srpe_load = metrics.srpe_load
    row.sets_total = metrics.sets_total
    row.reps_total = metrics.reps_total


@router.get("/{athlete_id}/history")
def get_session_history(
    athlete_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
) -> list[SessionHistoryItem]:
    """Sesiones hechas con su id, de la más reciente a la más antigua."""
    athlete_id = require_athlete_access(db, user, athlete_id)
    rows = (
        db.execute(
            select(TrainingSession)
            .where(TrainingSession.athlete_id == athlete_id)
            .order_by(TrainingSession.start_time.desc())
        )
        .scalars()
        .all()
    )
    return [_history_item(r) for r in rows]


@router.patch("/item/{session_id}")
def update_session(
    session_id: uuid.UUID,
    body: SessionUpdateRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
) -> SessionHistoryItem:
    row = _get_row_or_404(db, session_id)
    require_athlete_access(db, user, row.athlete_id)
    _apply_update(row, body)
    db.commit()
    db.refresh(row)
    reconcile_active_assignments_for_athletes(db, athlete_ids={row.athlete_id})
    return _history_item(row)


@router.delete("/item/{session_id}")
def delete_session(
    session_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
) -> dict:
    row = _get_row_or_404(db, session_id)
    require_athlete_access(db, user, row.athlete_id)
    athlete_id = row.athlete_id
    db.execute(
        delete(CoachReport).where(
            CoachReport.kind == CoachReportKind.SESSION_COMPLETED,
            CoachReport.ref_id == str(row.id),
        )
    )
    db.delete(row)
    db.commit()
    reconcile_active_assignments_for_athletes(db, athlete_ids={athlete_id})
    return {"deleted": True}
