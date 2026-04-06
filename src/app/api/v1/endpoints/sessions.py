from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.athlete_access import require_athlete_access, require_athlete_access_many
from app.auth.deps import get_current_user
from app.db.engine import get_db
from app.core.logging import log_business_event
from app.db.models_auth import User
from app.db.repo import list_sessions_for_athlete, upsert_session
from app.planning.service import reconcile_active_assignments_for_athletes
from coach_ai.training_core import Session as DomainSession

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/sessions", tags=["sessions"])


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
        else:
            duplicates += 1

    planning_reconcile = reconcile_active_assignments_for_athletes(db, athlete_ids=athlete_ids)
    log_business_event(
        "session_ingested",
        user_id=str(user.id),
        athlete_ids=sorted(athlete_ids),
        inserted=inserted,
        duplicates=duplicates,
        batch_size=len(sessions),
    )
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
