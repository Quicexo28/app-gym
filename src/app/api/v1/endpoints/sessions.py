from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.athlete_access import require_athlete_access, require_athlete_access_many
from app.auth.deps import get_current_user
from app.coach.reports import build_session_report
from app.db.engine import get_db
from app.db.models import CoachReport, CoachReportKind
from app.db.models_auth import User
from app.db.repo import (
    find_previous_session_same_routine,
    get_session_by_key,
    list_sessions_for_athlete,
    upsert_session,
)
from app.planning.service import reconcile_active_assignments_for_athletes
from coach_ai.training_core import Session as DomainSession

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
