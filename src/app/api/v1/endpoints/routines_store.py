from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db.engine import get_db
from app.db.models import RoutineStore
from app.db.models_auth import User

router = APIRouter(prefix="/routines", tags=["routines"])
DbSession = Session

ROUTINES_SCHEMA = "coach_ai_routines_v2"
MAX_STORE_BYTES = 1_000_000
MAX_SCOPES = 200
MAX_ROUTINES_PER_SCOPE = 200


class RoutineStorePayload(BaseModel):
    schema_version: str = Field(default=ROUTINES_SCHEMA, alias="schema", max_length=64)
    scopes: dict[str, list[dict]] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class RoutineStoreResponse(BaseModel):
    schema_version: str = Field(default=ROUTINES_SCHEMA, serialization_alias="schema")
    scopes: dict[str, list[dict]]
    updated_at_utc: str | None


def _validate_store(payload: RoutineStorePayload) -> dict:
    if len(payload.scopes) > MAX_SCOPES:
        raise HTTPException(status_code=400, detail="Too many routine scopes.")
    for scope, routines in payload.scopes.items():
        if not scope or len(scope) > 255:
            raise HTTPException(status_code=400, detail="Invalid scope key.")
        if len(routines) > MAX_ROUTINES_PER_SCOPE:
            raise HTTPException(status_code=400, detail="Too many routines in a scope.")

    store = {"schema": ROUTINES_SCHEMA, "scopes": payload.scopes}
    encoded = json.dumps(store, ensure_ascii=False)
    if len(encoded.encode("utf-8")) > MAX_STORE_BYTES:
        raise HTTPException(status_code=413, detail="Routine store too large.")
    return store


def _to_response(row: RoutineStore | None) -> RoutineStoreResponse:
    if row is None:
        return RoutineStoreResponse(scopes={}, updated_at_utc=None)
    store = row.store if isinstance(row.store, dict) else {}
    scopes = store.get("scopes")
    if not isinstance(scopes, dict):
        scopes = {}
    clean_scopes = {
        str(scope): routines
        for scope, routines in scopes.items()
        if isinstance(routines, list)
    }
    return RoutineStoreResponse(
        scopes=clean_scopes,
        updated_at_utc=row.updated_at_utc.isoformat(),
    )


@router.get("/store", response_model=RoutineStoreResponse, response_model_by_alias=True)
def get_routine_store(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> RoutineStoreResponse:
    row = db.get(RoutineStore, user.id)
    return _to_response(row)


@router.put("/store", response_model=RoutineStoreResponse, response_model_by_alias=True)
def put_routine_store(
    payload: RoutineStorePayload,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> RoutineStoreResponse:
    store = _validate_store(payload)

    row = db.get(RoutineStore, user.id)
    if row is None:
        row = RoutineStore(user_id=user.id, store=store)
        db.add(row)
    else:
        row.store = store
        row.updated_at_utc = datetime.now(UTC)

    db.commit()
    db.refresh(row)
    return _to_response(row)
