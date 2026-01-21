from __future__ import annotations

import uuid
from typing import Annotated

from email_validator import EmailNotValidError, validate_email
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.security import create_access_token, hash_password, verify_password
from app.auth.types import Plan, Role
from app.db.engine import get_db
from app.db.models_auth import User, UserSettings

router = APIRouter(prefix="/auth", tags=["auth"])
DbSession = Session


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: str
    email: str
    role: Role
    plan: Plan


class AuthResponse(BaseModel):
    token: TokenResponse
    user: UserResponse


def _normalize_email(raw: str) -> str:
    try:
        v = validate_email(raw, check_deliverability=False)
        return v.normalized
    except EmailNotValidError as err:
        raise HTTPException(status_code=400, detail="Invalid email.") from err


def _default_modules_for_plan(plan: Plan) -> dict:
    # Free: mínimo para evitar sobrecarga; Pro/Coach: más módulos habilitables.
    if plan == Plan.FREE:
        return {"trends": True, "latents": False, "suggestions": True, "validation": False}
    return {"trends": True, "latents": True, "suggestions": True, "validation": True}


@router.post("/register", response_model=AuthResponse)
def register(
    payload: RegisterRequest,
    db: Annotated[DbSession, Depends(get_db)],
) -> AuthResponse:
    email = _normalize_email(payload.email)

    existing = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Email already registered.")

    user = User(
        id=uuid.uuid4(),
        email=email,
        password_hash=hash_password(payload.password),
        role=Role.USER,
        plan=Plan.FREE,
        is_active=True,
    )
    db.add(user)
    db.add(
        UserSettings(
            user_id=user.id,
            weight_unit="kg",
            effort_mode="rpe",
            modules_enabled=_default_modules_for_plan(user.plan),
        )
    )
    db.commit()

    token = create_access_token(sub=str(user.id), role=user.role, plan=user.plan)
    return AuthResponse(
        token=TokenResponse(access_token=token),
        user=UserResponse(id=str(user.id), email=user.email, role=user.role, plan=user.plan),
    )


@router.post("/login", response_model=AuthResponse)
def login(
    payload: LoginRequest,
    db: Annotated[DbSession, Depends(get_db)],
) -> AuthResponse:
    email = _normalize_email(payload.email)
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    token = create_access_token(sub=str(user.id), role=user.role, plan=user.plan)
    return AuthResponse(
        token=TokenResponse(access_token=token),
        user=UserResponse(id=str(user.id), email=user.email, role=user.role, plan=user.plan),
    )
