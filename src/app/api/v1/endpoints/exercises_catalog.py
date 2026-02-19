from __future__ import annotations

import unicodedata
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user, require_role
from app.auth.types import Role
from app.db.engine import get_db
from app.db.models import ExerciseCatalog
from app.db.models_auth import User

router = APIRouter(prefix="/exercises", tags=["exercises"])
DbSession = Session


@dataclass(slots=True)
class NormalizedExercise:
    group: str
    family: str
    variation: str
    subvariation: str
    aliases: list[str]
    path_key: str


class ExerciseCreateRequest(BaseModel):
    group: str = Field(min_length=1, max_length=120)
    family: str = Field(min_length=1, max_length=160)
    variation: str | None = Field(default=None, max_length=160)
    subvariation: str | None = Field(default=None, max_length=180)
    aliases: list[str] | None = None


class ExerciseResponse(BaseModel):
    id: str
    group: str
    family: str
    variation: str | None
    subvariation: str | None
    aliases: list[str]
    scope: Literal["global", "custom"]
    owner_user_id: str | None
    created_at_utc: str


class ExerciseImportRequest(BaseModel):
    mode: Literal["merge", "replace"] = "merge"
    items: list[ExerciseCreateRequest] = Field(default_factory=list)


class ExerciseImportResponse(BaseModel):
    total: int
    imported: int
    updated: int
    skipped: int


class ExerciseExportItem(BaseModel):
    group: str
    family: str
    variation: str | None = None
    subvariation: str | None = None
    aliases: list[str] = Field(default_factory=list)


class ExerciseExportResponse(BaseModel):
    schema: Literal["coach_ai_exercise_catalog_global_v1"]
    exported_at_utc: str
    total: int
    items: list[ExerciseExportItem]


def _clean_text(value: str | None) -> str:
    if not value:
        return ""
    return " ".join(value.split()).strip()


def _normalize_key(value: str) -> str:
    return unicodedata.normalize("NFD", value).encode("ascii", "ignore").decode("ascii").lower()


def _make_path_key(group: str, family: str, variation: str, subvariation: str) -> str:
    return "|".join([_normalize_key(group), _normalize_key(family), _normalize_key(variation), _normalize_key(subvariation)])


def _normalize_payload(payload: ExerciseCreateRequest) -> NormalizedExercise:
    group = _clean_text(payload.group) or "General"
    family = _clean_text(payload.family)
    variation = _clean_text(payload.variation)
    subvariation = _clean_text(payload.subvariation)

    if not family:
        raise HTTPException(status_code=400, detail="Family is required.")
    if subvariation and not variation:
        raise HTTPException(status_code=400, detail="Subvariation requires variation.")

    aliases_source = payload.aliases or []
    alias_candidates = [
        _clean_text(alias)
        for alias in aliases_source
        if _clean_text(alias)
    ]
    aliases = sorted(set(alias_candidates))

    return NormalizedExercise(
        group=group,
        family=family,
        variation=variation,
        subvariation=subvariation,
        aliases=aliases,
        path_key=_make_path_key(group, family, variation, subvariation),
    )


def _to_response(row: ExerciseCatalog) -> ExerciseResponse:
    scope: Literal["global", "custom"] = "custom" if row.owner_user_id is not None else "global"
    return ExerciseResponse(
        id=str(row.id),
        group=row.group,
        family=row.family,
        variation=row.variation,
        subvariation=row.subvariation,
        aliases=[str(x) for x in (row.aliases or [])],
        scope=scope,
        owner_user_id=str(row.owner_user_id) if row.owner_user_id else None,
        created_at_utc=row.created_at_utc.isoformat(),
    )


def _sort_rows(rows: list[ExerciseCatalog]) -> list[ExerciseCatalog]:
    return sorted(
        rows,
        key=lambda row: (
            _normalize_key(row.group),
            _normalize_key(row.family),
            _normalize_key(row.variation or ""),
            _normalize_key(row.subvariation or ""),
        ),
    )


def _merged_catalog(rows: list[ExerciseCatalog]) -> list[ExerciseCatalog]:
    by_key: dict[str, ExerciseCatalog] = {}
    for row in rows:
        existing = by_key.get(row.path_key)
        if existing is None:
            by_key[row.path_key] = row
            continue
        if row.owner_user_id is not None:
            by_key[row.path_key] = row
    return _sort_rows(list(by_key.values()))


def _create_exercise(
    db: DbSession,
    owner_user_id: uuid.UUID | None,
    normalized: NormalizedExercise,
) -> ExerciseCatalog:
    existing = db.execute(
        select(ExerciseCatalog).where(
            ExerciseCatalog.owner_user_id.is_(None)
            if owner_user_id is None
            else ExerciseCatalog.owner_user_id == owner_user_id,
            ExerciseCatalog.path_key == normalized.path_key,
        )
    ).scalar_one_or_none()

    if existing is not None:
        raise HTTPException(status_code=409, detail="Exercise already exists.")

    row = ExerciseCatalog(
        id=uuid.uuid4(),
        owner_user_id=owner_user_id,
        path_key=normalized.path_key,
        group=normalized.group,
        family=normalized.family,
        variation=normalized.variation or None,
        subvariation=normalized.subvariation or None,
        aliases=normalized.aliases or None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/catalog", response_model=list[ExerciseResponse])
def list_catalog(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> list[ExerciseResponse]:
    rows = db.execute(
        select(ExerciseCatalog).where(
            or_(ExerciseCatalog.owner_user_id.is_(None), ExerciseCatalog.owner_user_id == user.id)
        )
    ).scalars().all()

    merged_rows = _merged_catalog(rows)
    return [_to_response(row) for row in merged_rows]


@router.post("/custom", response_model=ExerciseResponse)
def create_custom_exercise(
    payload: ExerciseCreateRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> ExerciseResponse:
    normalized = _normalize_payload(payload)
    row = _create_exercise(db, user.id, normalized)
    return _to_response(row)


@router.delete("/custom/{exercise_id}")
def delete_custom_exercise(
    exercise_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> dict:
    row = db.execute(
        select(ExerciseCatalog).where(
            ExerciseCatalog.id == exercise_id,
            ExerciseCatalog.owner_user_id == user.id,
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Custom exercise not found.")

    db.delete(row)
    db.commit()
    return {"ok": True, "id": str(exercise_id)}


@router.post("/global", response_model=ExerciseResponse)
def create_global_exercise(
    payload: ExerciseCreateRequest,
    admin: Annotated[User, Depends(require_role(Role.ADMIN))],
    db: Annotated[DbSession, Depends(get_db)],
) -> ExerciseResponse:
    _ = admin
    normalized = _normalize_payload(payload)
    row = _create_exercise(db, None, normalized)
    return _to_response(row)


@router.delete("/global/{exercise_id}")
def delete_global_exercise(
    exercise_id: uuid.UUID,
    admin: Annotated[User, Depends(require_role(Role.ADMIN))],
    db: Annotated[DbSession, Depends(get_db)],
) -> dict:
    _ = admin
    row = db.execute(
        select(ExerciseCatalog).where(
            ExerciseCatalog.id == exercise_id,
            ExerciseCatalog.owner_user_id.is_(None),
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Global exercise not found.")

    db.delete(row)
    db.commit()
    return {"ok": True, "id": str(exercise_id)}


@router.get("/global/export", response_model=ExerciseExportResponse)
def export_global_catalog(
    admin: Annotated[User, Depends(require_role(Role.ADMIN))],
    db: Annotated[DbSession, Depends(get_db)],
) -> ExerciseExportResponse:
    _ = admin
    rows = db.execute(select(ExerciseCatalog).where(ExerciseCatalog.owner_user_id.is_(None))).scalars().all()
    ordered = _sort_rows(rows)
    items = [
        ExerciseExportItem(
            group=row.group,
            family=row.family,
            variation=row.variation,
            subvariation=row.subvariation,
            aliases=[str(x) for x in (row.aliases or [])],
        )
        for row in ordered
    ]
    return ExerciseExportResponse(
        schema="coach_ai_exercise_catalog_global_v1",
        exported_at_utc=datetime.now(UTC).isoformat(),
        total=len(items),
        items=items,
    )


@router.post("/global/import", response_model=ExerciseImportResponse)
def import_global_catalog(
    payload: ExerciseImportRequest,
    admin: Annotated[User, Depends(require_role(Role.ADMIN))],
    db: Annotated[DbSession, Depends(get_db)],
) -> ExerciseImportResponse:
    _ = admin

    normalized_items: dict[str, NormalizedExercise] = {}
    for raw in payload.items:
        normalized = _normalize_payload(raw)
        existing = normalized_items.get(normalized.path_key)
        if existing is None:
            normalized_items[normalized.path_key] = normalized
            continue

        merged_aliases = sorted(set([*existing.aliases, *normalized.aliases]))
        normalized_items[normalized.path_key] = NormalizedExercise(
            group=normalized.group,
            family=normalized.family,
            variation=normalized.variation,
            subvariation=normalized.subvariation,
            aliases=merged_aliases,
            path_key=normalized.path_key,
        )

    total = len(normalized_items)

    if payload.mode == "replace":
        db.execute(delete(ExerciseCatalog).where(ExerciseCatalog.owner_user_id.is_(None)))

    current_rows = db.execute(select(ExerciseCatalog).where(ExerciseCatalog.owner_user_id.is_(None))).scalars().all()
    current_by_key = {row.path_key: row for row in current_rows}

    imported = 0
    updated = 0
    skipped = 0

    for normalized in normalized_items.values():
        row = current_by_key.get(normalized.path_key)
        if row is None:
            db.add(
                ExerciseCatalog(
                    id=uuid.uuid4(),
                    owner_user_id=None,
                    path_key=normalized.path_key,
                    group=normalized.group,
                    family=normalized.family,
                    variation=normalized.variation or None,
                    subvariation=normalized.subvariation or None,
                    aliases=normalized.aliases or None,
                )
            )
            imported += 1
            continue

        aliases = normalized.aliases or []
        changed = (
            row.group != normalized.group
            or row.family != normalized.family
            or (row.variation or "") != normalized.variation
            or (row.subvariation or "") != normalized.subvariation
            or [str(x) for x in (row.aliases or [])] != aliases
        )
        if not changed:
            skipped += 1
            continue

        row.group = normalized.group
        row.family = normalized.family
        row.variation = normalized.variation or None
        row.subvariation = normalized.subvariation or None
        row.aliases = aliases or None
        updated += 1

    db.commit()
    return ExerciseImportResponse(total=total, imported=imported, updated=updated, skipped=skipped)
