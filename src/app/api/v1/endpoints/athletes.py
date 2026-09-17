from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
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
from app.db.models import (
    ActiveSessionHeartbeat,
    Athlete,
    CoachAthleteAssignment,
    CoachReport,
    Run,
    TrainingSession,
)
from app.db.models_auth import User

ACTIVE_NOW_WINDOW_MINUTES = 5

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
    display_name: str | None
    kind: Literal["self", "assigned"]
    sessions_total: int
    runs_total: int
    last_session_at: str | None
    last_run_at: str | None
    is_active_now: bool
    unread_reports_count: int


class AthleteHubResponse(BaseModel):
    active_subject_id: str
    subjects: list[HubSubject]


@router.get("/hub", response_model=AthleteHubResponse)
def athlete_hub(
    user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
    q: str | None = Query(default=None, max_length=160),
    active_only: bool = Query(default=False),
) -> AthleteHubResponse:
    accessible = accessible_athletes(user, db)
    athlete_ids = [subject.id for subject in accessible.subjects]

    session_stats = {
        athlete_id: (total, last_at)
        for athlete_id, total, last_at in db.execute(
            select(
                TrainingSession.athlete_id,
                func.count(TrainingSession.id),
                func.max(TrainingSession.start_time),
            )
            .where(TrainingSession.athlete_id.in_(athlete_ids))
            .group_by(TrainingSession.athlete_id)
        ).all()
    }
    run_stats = {
        athlete_id: (total, last_at)
        for athlete_id, total, last_at in db.execute(
            select(Run.athlete_id, func.count(Run.run_id), func.max(Run.generated_at_utc))
            .where(Run.athlete_id.in_(athlete_ids))
            .group_by(Run.athlete_id)
        ).all()
    }
    display_names = {
        athlete_id: display_name
        for athlete_id, display_name in db.execute(
            select(Athlete.athlete_id, Athlete.display_name).where(Athlete.athlete_id.in_(athlete_ids))
        ).all()
    }
    active_threshold = datetime.now(UTC) - timedelta(minutes=ACTIVE_NOW_WINDOW_MINUTES)
    active_now_ids = set(
        db.execute(
            select(ActiveSessionHeartbeat.athlete_id).where(
                ActiveSessionHeartbeat.athlete_id.in_(athlete_ids),
                ActiveSessionHeartbeat.last_ping_at_utc >= active_threshold,
            )
        )
        .scalars()
        .all()
    )
    last_viewed_by_athlete = {
        athlete_id: last_viewed_at_utc
        for athlete_id, last_viewed_at_utc in db.execute(
            select(CoachAthleteAssignment.athlete_id, CoachAthleteAssignment.last_viewed_at_utc).where(
                CoachAthleteAssignment.coach_user_id == user.id,
                CoachAthleteAssignment.athlete_id.in_(athlete_ids),
            )
        ).all()
    }
    reports_by_athlete: dict[str, list[datetime]] = {}
    for athlete_id, created_at_utc in db.execute(
        select(CoachReport.athlete_id, CoachReport.created_at_utc).where(
            CoachReport.athlete_id.in_(athlete_ids)
        )
    ).all():
        reports_by_athlete.setdefault(athlete_id, []).append(created_at_utc)

    out: list[HubSubject] = []
    for subject in accessible.subjects:
        sessions_total, last_session_at = session_stats.get(subject.id, (0, None))
        runs_total, last_run_at = run_stats.get(subject.id, (0, None))

        unread_reports_count = 0
        if subject.kind == "assigned":
            last_viewed = last_viewed_by_athlete.get(subject.id)
            unread_reports_count = sum(
                1
                for created_at in reports_by_athlete.get(subject.id, [])
                if last_viewed is None or created_at > last_viewed
            )

        display_name = display_names.get(subject.id)
        if q and q.strip():
            needle = q.strip().lower()
            haystack = f"{display_name or ''} {subject.label}".lower()
            if needle not in haystack:
                continue
        if active_only and subject.id not in active_now_ids:
            continue

        out.append(
            HubSubject(
                id=subject.id,
                label=subject.label,
                display_name=display_name,
                kind=subject.kind,
                sessions_total=int(sessions_total or 0),
                runs_total=int(runs_total or 0),
                last_session_at=last_session_at.isoformat() if last_session_at else None,
                last_run_at=last_run_at.isoformat() if last_run_at else None,
                is_active_now=subject.id in active_now_ids,
                unread_reports_count=unread_reports_count,
            )
        )
    return AthleteHubResponse(active_subject_id=accessible.active_subject_id, subjects=out)
