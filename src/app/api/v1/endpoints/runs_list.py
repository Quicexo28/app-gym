from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.engine import get_db
from app.db.models import Run

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/runs", tags=["runs"])


@router.get("")
def list_runs(athlete_id: str, db: DbSession, limit: int = 20) -> list[dict]:
    q = (
        select(Run)
        .where(Run.athlete_id == athlete_id)
        .order_by(Run.generated_at_utc.desc())
        .limit(limit)
    )
    rows = db.execute(q).scalars().all()
    return [
        {
            "run_id": str(r.run_id),
            "generated_at_utc": r.generated_at_utc.isoformat(),
            "engine_version": r.engine_version,
            "metric_key": r.metric_key,
            "used_normalized": r.used_normalized,
            "summary": r.summary,
        }
        for r in rows
    ]
