from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.engine import get_db
from app.db.repo import list_sessions_for_athlete, upsert_session
from coach_ai.training_core import Session as DomainSession

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.post("/batch")
def ingest_sessions(sessions: list[DomainSession], db: DbSession) -> dict:
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

    return {"inserted": inserted, "duplicates": duplicates, "results": results}


@router.get("/{athlete_id}")
def get_sessions(athlete_id: str, db: DbSession) -> list[DomainSession]:
    return list_sessions_for_athlete(db, athlete_id)
