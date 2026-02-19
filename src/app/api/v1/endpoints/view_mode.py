from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.deps import get_current_user
from app.auth.types import Plan, Role
from app.auth.view_mode import (
    ViewMode,
    allowed_view_modes_for_user,
    effective_plan_for_mode,
    effective_role_for_mode,
    get_current_view_mode,
    parse_view_mode,
    resolve_view_mode_for_user,
)
from app.db.models_auth import User

router = APIRouter(prefix="/view-mode", tags=["view-mode"])


class ViewModeResponse(BaseModel):
    mode: ViewMode
    allowed_modes: list[ViewMode]
    role: Role
    plan: Plan
    effective_role: Role
    effective_plan: Plan


class SetViewModeRequest(BaseModel):
    mode: ViewMode


def _to_response(user: User, mode: ViewMode) -> ViewModeResponse:
    return ViewModeResponse(
        mode=mode,
        allowed_modes=allowed_view_modes_for_user(user),
        role=user.role,
        plan=user.plan,
        effective_role=effective_role_for_mode(user, mode),
        effective_plan=effective_plan_for_mode(user, mode),
    )


@router.get("", response_model=ViewModeResponse)
def get_view_mode(
    user: Annotated[User, Depends(get_current_user)],
) -> ViewModeResponse:
    mode = get_current_view_mode(user)
    return _to_response(user, mode)


@router.put("", response_model=ViewModeResponse)
def set_view_mode(
    payload: SetViewModeRequest,
    user: Annotated[User, Depends(get_current_user)],
) -> ViewModeResponse:
    parsed = parse_view_mode(payload.mode.value)
    if parsed is None:
        raise HTTPException(status_code=400, detail="Invalid view mode.")

    resolved = resolve_view_mode_for_user(user, parsed.value)
    if resolved != parsed:
        raise HTTPException(status_code=403, detail="View mode is not allowed for current account.")

    return _to_response(user, parsed)
