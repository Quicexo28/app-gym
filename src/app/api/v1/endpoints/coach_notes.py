from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.athlete_access import require_athlete_access
from app.auth.deps import get_current_user
from app.coach.reports import normalize_exercise_name
from app.db.engine import get_db
from app.db.models import CoachNote, CoachNoteScope
from app.db.models_auth import User

DbSession = Annotated[Session, Depends(get_db)]
router = APIRouter(prefix="/coach/notes", tags=["coach"])


class CoachNoteCreateRequest(BaseModel):
    athlete_id: str = Field(min_length=1)
    scope_type: CoachNoteScope
    routine_id: str | None = None
    exercise_name: str | None = Field(default=None, max_length=200)
    assignment_id: str | None = None
    body: str = Field(min_length=1, max_length=2000)

    @model_validator(mode="after")
    def validate_scope(self) -> CoachNoteCreateRequest:
        if self.scope_type == CoachNoteScope.ROUTINE_EXERCISE and (
            not self.routine_id or not self.exercise_name
        ):
            raise ValueError("routine_exercise requiere routine_id y exercise_name.")
        return self


class CoachNoteResponse(BaseModel):
    id: str
    athlete_id: str
    author_user_id: str
    scope_type: CoachNoteScope
    routine_id: str | None
    exercise_name_normalized: str | None
    assignment_id: str | None
    body: str
    created_at_utc: str
    read_at_utc: str | None


def _serialize(row: CoachNote) -> CoachNoteResponse:
    return CoachNoteResponse(
        id=str(row.id),
        athlete_id=row.athlete_id,
        author_user_id=str(row.author_user_id),
        scope_type=row.scope_type,
        routine_id=row.routine_id,
        exercise_name_normalized=row.exercise_name_normalized,
        assignment_id=str(row.assignment_id) if row.assignment_id else None,
        body=row.body,
        created_at_utc=row.created_at_utc.isoformat(),
        read_at_utc=row.read_at_utc.isoformat() if row.read_at_utc else None,
    )


def _load_note(db: DbSession, note_id: str) -> CoachNote:
    try:
        parsed = uuid.UUID(note_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Nota no encontrada.") from None

    row = db.get(CoachNote, parsed)
    if row is None:
        raise HTTPException(status_code=404, detail="Nota no encontrada.")
    return row


@router.post("", response_model=CoachNoteResponse, status_code=status.HTTP_201_CREATED)
def create_coach_note(
    payload: CoachNoteCreateRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
) -> CoachNoteResponse:
    require_athlete_access(db, user, payload.athlete_id)

    assignment_uuid: uuid.UUID | None = None
    if payload.assignment_id:
        try:
            assignment_uuid = uuid.UUID(payload.assignment_id)
        except ValueError:
            raise HTTPException(status_code=422, detail="assignment_id invalido.") from None

    row = CoachNote(
        athlete_id=payload.athlete_id.strip(),
        author_user_id=user.id,
        scope_type=payload.scope_type,
        routine_id=payload.routine_id,
        exercise_name_normalized=(
            normalize_exercise_name(payload.exercise_name) if payload.exercise_name else None
        ),
        assignment_id=assignment_uuid,
        body=payload.body.strip(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize(row)


@router.get("", response_model=list[CoachNoteResponse])
def list_coach_notes(
    user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
    athlete_id: str = Query(min_length=1),
    routine_id: str | None = Query(default=None),
    exercise_name: str | None = Query(default=None),
) -> list[CoachNoteResponse]:
    require_athlete_access(db, user, athlete_id)

    stmt = select(CoachNote).where(CoachNote.athlete_id == athlete_id.strip())
    if routine_id:
        stmt = stmt.where(CoachNote.routine_id == routine_id)
    if exercise_name:
        stmt = stmt.where(
            CoachNote.exercise_name_normalized == normalize_exercise_name(exercise_name)
        )
    stmt = stmt.order_by(CoachNote.created_at_utc.desc())

    rows = db.execute(stmt).scalars().all()
    return [_serialize(row) for row in rows]


@router.patch("/{note_id}/read", response_model=CoachNoteResponse)
def mark_coach_note_read(
    note_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
) -> CoachNoteResponse:
    row = _load_note(db, note_id)
    require_athlete_access(db, user, row.athlete_id)

    if row.read_at_utc is None:
        row.read_at_utc = datetime.now(UTC)
        db.commit()
        db.refresh(row)
    return _serialize(row)
