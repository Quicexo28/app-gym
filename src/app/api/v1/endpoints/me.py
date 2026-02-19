from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.deps import get_current_user
from app.auth.types import Plan, Role
from app.auth.view_mode import (
    ViewMode,
    allowed_view_modes_for_user,
    effective_plan_for_mode,
    effective_role_for_mode,
    get_current_view_mode,
)
from app.db.models_auth import User

router = APIRouter(prefix="/me", tags=["auth"])


class MeResponse(BaseModel):
    id: str
    email: str
    phone_number: str | None
    role: Role
    plan: Plan
    effective_mode: ViewMode
    effective_role: Role
    effective_plan: Plan
    allowed_view_modes: list[ViewMode]


@router.get("", response_model=MeResponse)
def me(user: Annotated[User, Depends(get_current_user)]) -> MeResponse:
    mode = get_current_view_mode(user)
    return MeResponse(
        id=str(user.id),
        email=user.email,
        phone_number=user.phone_number,
        role=user.role,
        plan=user.plan,
        effective_mode=mode,
        effective_role=effective_role_for_mode(user, mode),
        effective_plan=effective_plan_for_mode(user, mode),
        allowed_view_modes=allowed_view_modes_for_user(user),
    )
