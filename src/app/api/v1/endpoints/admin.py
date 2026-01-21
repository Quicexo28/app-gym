from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import require_role
from app.auth.types import Plan, Role
from app.db.engine import get_db
from app.db.models_auth import User

router = APIRouter(prefix="/admin/dev", tags=["admin"])
DbSession = Session


class SwitchPlanRequest(BaseModel):
    email: str
    plan: Plan
    role: Role | None = None


@router.post("/switch-plan")
def switch_plan(
    payload: SwitchPlanRequest,
    admin: Annotated[User, Depends(require_role(Role.ADMIN))],
    db: Annotated[DbSession, Depends(get_db)],
) -> dict:
    _ = admin  # explicit: only used for auth gate

    user = db.execute(select(User).where(User.email == payload.email)).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")

    user.plan = payload.plan
    if payload.role is not None:
        user.role = payload.role

    db.commit()
    return {"ok": True, "email": user.email, "plan": user.plan, "role": user.role}
