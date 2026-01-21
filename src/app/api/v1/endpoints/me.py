from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth.deps import get_current_user
from app.auth.types import Plan, Role
from app.db.models_auth import User

router = APIRouter(prefix="/me", tags=["auth"])


class MeResponse(BaseModel):
    id: str
    email: str
    role: Role
    plan: Plan


@router.get("", response_model=MeResponse)
def me(user: Annotated[User, Depends(get_current_user)]) -> MeResponse:
    return MeResponse(id=str(user.id), email=user.email, role=user.role, plan=user.plan)
