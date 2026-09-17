from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.athlete_access import require_athlete_access
from app.auth.deps import get_current_user
from app.auth.types import Plan, Role
from app.auth.view_scopes import (
    can_use_admin_view,
    can_use_coach_view,
    effective_role_for_scopes,
    get_current_view_scopes,
)
from app.db.engine import get_db
from app.db.models import ActiveSessionHeartbeat
from app.db.models_auth import User

router = APIRouter(prefix="/me", tags=["auth"])
DbSession = Annotated[Session, Depends(get_db)]


class MeResponse(BaseModel):
    id: str
    email: str
    phone_number: str | None
    role: Role
    plan: Plan
    can_admin_view: bool
    can_coach_view: bool
    admin_view: bool
    coach_view: bool
    effective_role: Role


@router.get("", response_model=MeResponse)
def me(user: Annotated[User, Depends(get_current_user)]) -> MeResponse:
    scopes = get_current_view_scopes()
    return MeResponse(
        id=str(user.id),
        email=user.email,
        phone_number=user.phone_number,
        role=user.role,
        plan=user.plan,
        can_admin_view=can_use_admin_view(user),
        can_coach_view=can_use_coach_view(user),
        admin_view=scopes.admin,
        coach_view=scopes.coach,
        effective_role=effective_role_for_scopes(user, scopes),
    )


class SessionHeartbeatRequest(BaseModel):
    athlete_id: str
    routine_id: str | None = None
    routine_name: str | None = None


@router.post("/session-heartbeat")
def session_heartbeat(
    payload: SessionHeartbeatRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
) -> dict:
    """Ping periodico (~60s) mientras hay una sesion activa en el dispositivo -
    unica senal server-side de "quien esta entrenando ahora" (la sesion en si
    vive solo en localStorage hasta completarse).
    """
    athlete_id = payload.athlete_id.strip()
    require_athlete_access(db, user, athlete_id)

    now = datetime.now(UTC)
    row = db.get(ActiveSessionHeartbeat, athlete_id)
    if row is None:
        row = ActiveSessionHeartbeat(
            athlete_id=athlete_id,
            started_at_utc=now,
            last_ping_at_utc=now,
            routine_id=payload.routine_id,
            routine_name=payload.routine_name,
        )
        db.add(row)
    else:
        row.last_ping_at_utc = now
        row.routine_id = payload.routine_id
        row.routine_name = payload.routine_name

    db.commit()
    return {"ok": True}
