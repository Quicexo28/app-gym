from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.athlete_access import list_accessible_athlete_ids, require_athlete_access
from app.auth.deps import require_coach_view
from app.db.engine import get_db
from app.db.models import Athlete, CoachReport, CoachReportKind
from app.db.models_auth import User

DbSession = Annotated[Session, Depends(get_db)]
router = APIRouter(prefix="/coach/reports", tags=["coach"])


class CoachReportItem(BaseModel):
    id: str
    athlete_id: str
    athlete_display_name: str | None
    kind: CoachReportKind
    ref_id: str
    payload: dict
    created_at_utc: str


@router.get("", response_model=list[CoachReportItem])
def list_coach_reports(
    user: Annotated[User, Depends(require_coach_view)],
    db: DbSession,
    athlete_id: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
) -> list[CoachReportItem]:
    """Feed de reportes automaticos (sesion completada / medida tomada).

    Sin athlete_id: ultimos reportes de toda la cartera del coach (para el
    card de Home). Con athlete_id: historial de un solo atleta.
    """
    if athlete_id:
        require_athlete_access(db, user, athlete_id)
        athlete_ids = [athlete_id]
    else:
        athlete_ids = list_accessible_athlete_ids(db, user)

    rows = (
        db.execute(
            select(CoachReport)
            .where(CoachReport.athlete_id.in_(athlete_ids))
            .order_by(CoachReport.created_at_utc.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    display_names = {
        row_athlete_id: display_name
        for row_athlete_id, display_name in db.execute(
            select(Athlete.athlete_id, Athlete.display_name).where(
                Athlete.athlete_id.in_(athlete_ids)
            )
        ).all()
    }
    return [
        CoachReportItem(
            id=str(row.id),
            athlete_id=row.athlete_id,
            athlete_display_name=display_names.get(row.athlete_id),
            kind=row.kind,
            ref_id=row.ref_id,
            payload=row.payload,
            created_at_utc=row.created_at_utc.isoformat(),
        )
        for row in rows
    ]
