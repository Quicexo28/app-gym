from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.athlete_access import require_athlete_access
from app.auth.deps import get_current_user
from app.auth.types import Role
from app.db.engine import get_db
from app.db.models import (
    Athlete,
    BodyMeasurement,
    ProgressShare,
    ProgressShareComment,
    TrainingSession,
)
from app.db.models_auth import User, UserSettings

router = APIRouter(prefix="/progress", tags=["progress"])
DbSession = Session

RECENT_WINDOW_DAYS = 30


class ProgressSnapshotMetric(BaseModel):
    key: str
    label: str
    value: float
    unit: str
    delta: float | None = None


class ProgressAuthor(BaseModel):
    user_id: str
    label: str
    role: Role


class ProgressShareCommentItem(BaseModel):
    id: str
    author: ProgressAuthor
    body: str
    created_at_utc: str


class ProgressShareItem(BaseModel):
    id: str
    athlete_id: str
    author: ProgressAuthor
    note: str | None
    metrics: list[ProgressSnapshotMetric]
    sessions_total: int
    sessions_recent: int
    measured_at: str | None
    created_at_utc: str
    comments: list[ProgressShareCommentItem]


class ProgressShareListResponse(BaseModel):
    athlete_id: str
    total: int
    items: list[ProgressShareItem]


class ProgressShareDeleteResponse(BaseModel):
    ok: bool
    id: str


class ProgressShareCreateRequest(BaseModel):
    athlete_id: str = Field(min_length=1, max_length=255)
    note: str | None = Field(default=None, max_length=600)


class ProgressCommentCreateRequest(BaseModel):
    body: str = Field(min_length=1, max_length=600)


def _clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = " ".join(value.split()).strip()
    return cleaned or None


def display_label(username: str | None, email: str) -> str:
    """Nombre visible en el hilo: username del perfil, si no el local del email."""
    cleaned = _clean_text(username)
    if cleaned:
        return cleaned
    local = email.split("@", 1)[0].strip()
    return local or email


def _delta(current: float | None, previous: float | None) -> float | None:
    if current is None or previous is None:
        return None
    return round(float(current) - float(previous), 2)


def summarize_metrics(
    latest: BodyMeasurement | None,
    previous: BodyMeasurement | None,
) -> list[dict]:
    """Metricas destacadas del ultimo control, con delta contra el anterior.

    Funcion pura: recibe filas ya cargadas y devuelve el snapshot serializable
    que se congela en el reporte compartido.
    """
    if latest is None:
        return []

    specs = (
        ("weight_kg", "Peso", "kg"),
        ("waist_cm", "Cintura", "cm"),
        ("body_fat_pct", "% grasa", "%"),
        ("chest_cm", "Torax", "cm"),
        ("arm_flexed_cm", "Brazo flexionado", "cm"),
        ("thigh_cm", "Muslo", "cm"),
    )

    out: list[dict] = []
    for key, label, unit in specs:
        value = getattr(latest, key, None)
        if value is None:
            continue
        out.append(
            {
                "key": key,
                "label": label,
                "value": round(float(value), 2),
                "unit": unit,
                "delta": _delta(value, getattr(previous, key, None) if previous else None),
            }
        )
    return out


def _build_snapshot(db: DbSession, athlete_id: str) -> dict:
    rows = (
        db.execute(
            select(BodyMeasurement)
            .where(BodyMeasurement.athlete_id == athlete_id)
            .order_by(BodyMeasurement.measured_at.desc(), BodyMeasurement.created_at_utc.desc())
            .limit(2)
        )
        .scalars()
        .all()
    )
    latest = rows[0] if rows else None
    previous = rows[1] if len(rows) > 1 else None

    sessions_total = int(
        db.execute(
            select(func.count(TrainingSession.id)).where(TrainingSession.athlete_id == athlete_id)
        ).scalar_one()
        or 0
    )
    since = datetime.now(UTC) - timedelta(days=RECENT_WINDOW_DAYS)
    sessions_recent = int(
        db.execute(
            select(func.count(TrainingSession.id)).where(
                TrainingSession.athlete_id == athlete_id,
                TrainingSession.start_time >= since,
            )
        ).scalar_one()
        or 0
    )

    return {
        "metrics": summarize_metrics(latest, previous),
        "sessions_total": sessions_total,
        "sessions_recent": sessions_recent,
        "recent_window_days": RECENT_WINDOW_DAYS,
        "measured_at": latest.measured_at.isoformat() if latest is not None else None,
    }


def _authors_by_id(db: DbSession, user_ids: set[uuid.UUID]) -> dict[uuid.UUID, ProgressAuthor]:
    if not user_ids:
        return {}

    rows = db.execute(
        select(User.id, User.email, User.role, UserSettings.profile_username).join(
            UserSettings, UserSettings.user_id == User.id, isouter=True
        ).where(User.id.in_(user_ids))
    ).all()

    out: dict[uuid.UUID, ProgressAuthor] = {}
    for user_id, email, role, username in rows:
        out[user_id] = ProgressAuthor(
            user_id=str(user_id),
            label=display_label(username, email),
            role=role,
        )
    return out


def _unknown_author(user_id: uuid.UUID) -> ProgressAuthor:
    return ProgressAuthor(user_id=str(user_id), label="Usuario", role=Role.USER)


def _serialize_share(
    row: ProgressShare,
    comments: list[ProgressShareComment],
    authors: dict[uuid.UUID, ProgressAuthor],
) -> ProgressShareItem:
    snapshot = row.snapshot or {}
    metrics = [ProgressSnapshotMetric(**entry) for entry in snapshot.get("metrics", [])]

    return ProgressShareItem(
        id=str(row.id),
        athlete_id=row.athlete_id,
        author=authors.get(row.author_user_id) or _unknown_author(row.author_user_id),
        note=row.note,
        metrics=metrics,
        sessions_total=int(snapshot.get("sessions_total") or 0),
        sessions_recent=int(snapshot.get("sessions_recent") or 0),
        measured_at=snapshot.get("measured_at"),
        created_at_utc=row.created_at_utc.isoformat(),
        comments=[
            ProgressShareCommentItem(
                id=str(comment.id),
                author=authors.get(comment.author_user_id) or _unknown_author(comment.author_user_id),
                body=comment.body,
                created_at_utc=comment.created_at_utc.isoformat(),
            )
            for comment in comments
        ],
    )


def _comments_by_share(
    db: DbSession, share_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[ProgressShareComment]]:
    if not share_ids:
        return {}

    rows = (
        db.execute(
            select(ProgressShareComment)
            .where(ProgressShareComment.share_id.in_(share_ids))
            .order_by(ProgressShareComment.created_at_utc.asc())
        )
        .scalars()
        .all()
    )
    out: dict[uuid.UUID, list[ProgressShareComment]] = {}
    for row in rows:
        out.setdefault(row.share_id, []).append(row)
    return out


def _load_share(db: DbSession, share_id: str) -> ProgressShare:
    try:
        parsed = uuid.UUID(share_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Progress share not found.") from None

    row = db.get(ProgressShare, parsed)
    if row is None:
        raise HTTPException(status_code=404, detail="Progress share not found.")
    return row


def _ensure_athlete_row(db: DbSession, athlete_id: str) -> None:
    if db.get(Athlete, athlete_id) is not None:
        return
    db.add(Athlete(athlete_id=athlete_id))


@router.get("/shares", response_model=ProgressShareListResponse)
def list_progress_shares(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
    athlete_id: str = Query(min_length=1, max_length=255),
    limit: int = Query(default=20, ge=1, le=100),
) -> ProgressShareListResponse:
    normalized = athlete_id.strip()
    require_athlete_access(db, user, normalized)

    rows = (
        db.execute(
            select(ProgressShare)
            .where(ProgressShare.athlete_id == normalized)
            .order_by(ProgressShare.created_at_utc.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    comments = _comments_by_share(db, [row.id for row in rows])
    author_ids = {row.author_user_id for row in rows}
    for entries in comments.values():
        author_ids.update(entry.author_user_id for entry in entries)
    authors = _authors_by_id(db, author_ids)

    items = [_serialize_share(row, comments.get(row.id, []), authors) for row in rows]
    return ProgressShareListResponse(athlete_id=normalized, total=len(items), items=items)


@router.post("/shares", response_model=ProgressShareItem, status_code=status.HTTP_201_CREATED)
def create_progress_share(
    payload: ProgressShareCreateRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> ProgressShareItem:
    athlete_id = payload.athlete_id.strip()
    require_athlete_access(db, user, athlete_id)
    _ensure_athlete_row(db, athlete_id)

    row = ProgressShare(
        athlete_id=athlete_id,
        author_user_id=user.id,
        note=_clean_text(payload.note),
        snapshot=_build_snapshot(db, athlete_id),
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    authors = _authors_by_id(db, {row.author_user_id})
    return _serialize_share(row, [], authors)


@router.post(
    "/shares/{share_id}/comments",
    response_model=ProgressShareItem,
    status_code=status.HTTP_201_CREATED,
)
def create_progress_comment(
    share_id: str,
    payload: ProgressCommentCreateRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> ProgressShareItem:
    share = _load_share(db, share_id)
    require_athlete_access(db, user, share.athlete_id)

    body = _clean_text(payload.body)
    if not body:
        raise HTTPException(status_code=400, detail="Comment body is required.")

    db.add(ProgressShareComment(share_id=share.id, author_user_id=user.id, body=body))
    db.commit()
    db.refresh(share)

    comments = _comments_by_share(db, [share.id]).get(share.id, [])
    author_ids = {share.author_user_id, *(entry.author_user_id for entry in comments)}
    return _serialize_share(share, comments, _authors_by_id(db, author_ids))


@router.delete("/shares/{share_id}", response_model=ProgressShareDeleteResponse)
def delete_progress_share(
    share_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> ProgressShareDeleteResponse:
    share = _load_share(db, share_id)
    require_athlete_access(db, user, share.athlete_id)

    if share.author_user_id != user.id:
        raise HTTPException(status_code=403, detail="Only the author can delete this share.")

    for comment in _comments_by_share(db, [share.id]).get(share.id, []):
        db.delete(comment)
    db.delete(share)
    db.commit()
    return ProgressShareDeleteResponse(ok=True, id=share_id)
