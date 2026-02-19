from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.athlete_access import (
    can_switch_athlete,
    list_accessible_athlete_ids,
    personal_athlete_id_for_user,
)
from app.auth.deps import get_current_user
from app.db.engine import get_db
from app.db.models import Run, TrainingSession
from app.db.models_auth import User

DbSession = Annotated[Session, Depends(get_db)]
router = APIRouter(prefix="/athletes", tags=["athletes"])


class AccessibleSubject(BaseModel):
    id: str
    label: str
    kind: Literal["self", "assigned"]


class AccessibleAthletesResponse(BaseModel):
    can_switch: bool
    active_subject_id: str
    subjects: list[AccessibleSubject]
    athlete_ids: list[str]


@router.get("/accessible", response_model=AccessibleAthletesResponse)
def accessible_athletes(
    user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
) -> AccessibleAthletesResponse:
    athlete_ids = list_accessible_athlete_ids(db, user)
    own_athlete_id = personal_athlete_id_for_user(user)
    subjects: list[AccessibleSubject] = []
    assigned_idx = 0
    for athlete_id in athlete_ids:
        if athlete_id == own_athlete_id:
            subjects.append(AccessibleSubject(id=athlete_id, label="Mi perfil", kind="self"))
            continue
        assigned_idx += 1
        subjects.append(
            AccessibleSubject(id=athlete_id, label=f"Atleta {assigned_idx}", kind="assigned")
        )

    active_subject_id = own_athlete_id if own_athlete_id in athlete_ids else (athlete_ids[0] if athlete_ids else "")
    return AccessibleAthletesResponse(
        can_switch=can_switch_athlete(user),
        active_subject_id=active_subject_id,
        subjects=subjects,
        athlete_ids=athlete_ids,
    )


class HubSubject(BaseModel):
    id: str
    label: str
    kind: Literal["self", "assigned"]
    sessions_total: int
    runs_total: int
    last_session_at: str | None
    last_run_at: str | None


class AthleteHubResponse(BaseModel):
    active_subject_id: str
    subjects: list[HubSubject]


@router.get("/hub", response_model=AthleteHubResponse)
def athlete_hub(
    user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
) -> AthleteHubResponse:
    accessible = accessible_athletes(user, db)
    out: list[HubSubject] = []
    for subject in accessible.subjects:
        sessions_total, last_session_at = db.execute(
            select(func.count(TrainingSession.id), func.max(TrainingSession.start_time)).where(
                TrainingSession.athlete_id == subject.id
            )
        ).one()
        runs_total, last_run_at = db.execute(
            select(func.count(Run.run_id), func.max(Run.generated_at_utc)).where(
                Run.athlete_id == subject.id
            )
        ).one()
        out.append(
            HubSubject(
                id=subject.id,
                label=subject.label,
                kind=subject.kind,
                sessions_total=int(sessions_total or 0),
                runs_total=int(runs_total or 0),
                last_session_at=last_session_at.isoformat() if last_session_at else None,
                last_run_at=last_run_at.isoformat() if last_run_at else None,
            )
        )
    return AthleteHubResponse(active_subject_id=accessible.active_subject_id, subjects=out)
