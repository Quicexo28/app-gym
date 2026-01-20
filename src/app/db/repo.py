from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import Athlete, TrainingSession
from coach_ai.training_core import Session as DomainSession
from coach_ai.training_core.metrics import compute_session_metrics
from coach_ai.training_core.validation import validate_session


def ensure_athlete(db: Session, athlete_id: str) -> None:
    if db.get(Athlete, athlete_id) is None:
        db.add(Athlete(athlete_id=athlete_id))
        db.commit()


def upsert_session(db: Session, s: DomainSession) -> dict:
    """Insert session if not exists (uq athlete_id + start_time).
    Returns: {inserted: bool, issues: [...], session_key: ...}
    """
    issues = validate_session(s)
    m = compute_session_metrics(s)

    ensure_athlete(db, s.athlete_id)

    row = TrainingSession(
        athlete_id=s.athlete_id,
        start_time=s.start_time,
        duration_min=float(s.duration_min),
        rpe=None if s.rpe is None else float(s.rpe),
        modality=s.modality,
        source=s.source,
        exercises=[ex.model_dump() for ex in s.exercises],
        meta=s.meta,
        volume_load_kg=m.volume_load_kg,
        srpe_load=m.srpe_load,
        sets_total=m.sets_total,
        reps_total=m.reps_total,
    )
    db.add(row)
    try:
        db.commit()
        return {
            "inserted": True,
            "issues": [i.model_dump() for i in issues],
            "session_key": (s.athlete_id, s.start_time.isoformat()),
        }
    except IntegrityError:
        db.rollback()
        return {
            "inserted": False,
            "issues": [i.model_dump() for i in issues],
            "session_key": (s.athlete_id, s.start_time.isoformat()),
        }


def list_sessions_for_athlete(db: Session, athlete_id: str) -> list[DomainSession]:
    q = (
        select(TrainingSession)
        .where(TrainingSession.athlete_id == athlete_id)
        .order_by(TrainingSession.start_time.asc())
    )
    rows = db.execute(q).scalars().all()

    out: list[DomainSession] = []
    for r in rows:
        out.append(
            DomainSession(
                athlete_id=r.athlete_id,
                start_time=r.start_time,
                duration_min=r.duration_min,
                rpe=r.rpe,
                modality=r.modality,
                exercises=[] if not r.exercises else r.exercises,  # pydantic soporta dicts
                source=r.source,
                meta=r.meta or {},
            )
        )
    return out
