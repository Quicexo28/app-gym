from __future__ import annotations

import json
import re
import secrets
import uuid
from typing import Annotated
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen

from email_validator import EmailNotValidError, validate_email
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth.athlete_access import personal_athlete_id_for_user
from app.auth.deps import get_current_user
from app.auth.security import create_access_token, hash_password, verify_password
from app.auth.types import Plan, Role
from app.core.config import Settings
from app.core.rate_limit import SlidingWindowRateLimiter, rate_limit_dependency
from app.db.engine import get_db
from app.db.models import Athlete, CoachAthleteAssignment, ExerciseCatalog, Run, TrainingSession
from app.db.models_auth import User, UserSettings

router = APIRouter(prefix="/auth", tags=["auth"])
DbSession = Session
settings = Settings()

_LOGIN_LIMITER = SlidingWindowRateLimiter(max_requests=10, window_seconds=60)
_REGISTER_LIMITER = SlidingWindowRateLimiter(max_requests=5, window_seconds=60)
login_rate_limit = rate_limit_dependency(_LOGIN_LIMITER, "login")
register_rate_limit = rate_limit_dependency(_REGISTER_LIMITER, "register")

PHONE_MIN_DIGITS = 8
PHONE_MAX_DIGITS = 15
PHONE_DIGITS_RE = re.compile(r"\D+")
DEBUG_GUEST_EMAIL = "invitado.debug@coach.local"


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=128)
    phone_number: str | None = Field(default=None, min_length=7, max_length=32)


class LoginRequest(BaseModel):
    identifier: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=128)


class GoogleLoginRequest(BaseModel):
    id_token: str = Field(min_length=20, max_length=4096)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: str
    email: str
    phone_number: str | None
    role: Role
    plan: Plan


class AuthResponse(BaseModel):
    token: TokenResponse
    user: UserResponse


class DeleteAccountRequest(BaseModel):
    confirm: str = Field(min_length=1, max_length=64)


def _normalize_email(raw: str) -> str:
    try:
        validated = validate_email(raw, check_deliverability=False)
        return validated.normalized
    except EmailNotValidError as err:
        raise HTTPException(status_code=400, detail="Invalid email.") from err


def _normalize_phone(raw: str) -> str:
    digits = PHONE_DIGITS_RE.sub("", raw.strip())
    if not digits or len(digits) < PHONE_MIN_DIGITS or len(digits) > PHONE_MAX_DIGITS:
        raise HTTPException(status_code=400, detail="Invalid phone number.")
    return f"+{digits}"


def _normalize_identifier(raw: str) -> tuple[str, str]:
    identifier = raw.strip()
    if "@" in identifier:
        return "email", _normalize_email(identifier)
    return "phone", _normalize_phone(identifier)


def _auth_response_for_user(user: User) -> AuthResponse:
    token = create_access_token(sub=str(user.id), role=user.role, plan=user.plan)
    return AuthResponse(
        token=TokenResponse(access_token=token),
        user=UserResponse(
            id=str(user.id),
            email=user.email,
            phone_number=user.phone_number,
            role=user.role,
            plan=user.plan,
        ),
    )


def _default_modules_for_plan(plan: Plan) -> dict:
    # Free: minimal set to avoid overload; Pro/Coach: all modules available.
    if plan == Plan.FREE:
        return {"trends": True, "latents": False, "suggestions": True, "validation": False}
    return {"trends": True, "latents": True, "suggestions": True, "validation": True}


def _is_guest_login_enabled() -> bool:
    return settings.env.strip().lower() != "prod"


def _fetch_google_tokeninfo(id_token: str) -> dict[str, str]:
    query = urlencode({"id_token": id_token})
    url = f"https://oauth2.googleapis.com/tokeninfo?{query}"
    try:
        with urlopen(url, timeout=8) as response:
            raw = response.read().decode("utf-8")
    except HTTPError as err:
        raise HTTPException(status_code=401, detail="Invalid Google token.") from err
    except URLError as err:
        raise HTTPException(status_code=502, detail="Could not validate Google token.") from err

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as err:
        raise HTTPException(status_code=502, detail="Could not validate Google token.") from err

    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="Could not validate Google token.")
    return {str(k): str(v) for k, v in payload.items()}


def _validate_google_identity(id_token: str) -> tuple[str, str]:
    if not settings.google_client_id:
        raise HTTPException(status_code=503, detail="Google login is not configured.")

    payload = _fetch_google_tokeninfo(id_token)
    token_audience = payload.get("aud")
    if token_audience != settings.google_client_id:
        raise HTTPException(status_code=401, detail="Invalid Google token audience.")

    email = payload.get("email", "").strip()
    sub = payload.get("sub", "").strip()
    email_verified = payload.get("email_verified", "").lower() == "true"

    if not email or not sub or not email_verified:
        raise HTTPException(status_code=401, detail="Invalid Google token payload.")

    return _normalize_email(email), sub


@router.post("/register", response_model=AuthResponse, dependencies=[Depends(register_rate_limit)])
def register(
    payload: RegisterRequest,
    db: Annotated[DbSession, Depends(get_db)],
) -> AuthResponse:
    email = _normalize_email(payload.email)
    phone_number = _normalize_phone(payload.phone_number) if payload.phone_number else None

    existing_email = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if existing_email is not None:
        raise HTTPException(status_code=409, detail="Email already registered.")

    if phone_number:
        existing_phone = db.execute(select(User).where(User.phone_number == phone_number)).scalar_one_or_none()
        if existing_phone is not None:
            raise HTTPException(status_code=409, detail="Phone already registered.")

    user = User(
        id=uuid.uuid4(),
        email=email,
        phone_number=phone_number,
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
    db.refresh(user)

    return _auth_response_for_user(user)


@router.post("/login", response_model=AuthResponse, dependencies=[Depends(login_rate_limit)])
def login(
    payload: LoginRequest,
    db: Annotated[DbSession, Depends(get_db)],
) -> AuthResponse:
    identifier_type, normalized_identifier = _normalize_identifier(payload.identifier)
    if identifier_type == "email":
        user = db.execute(select(User).where(User.email == normalized_identifier)).scalar_one_or_none()
    else:
        user = db.execute(select(User).where(User.phone_number == normalized_identifier)).scalar_one_or_none()

    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    return _auth_response_for_user(user)


@router.post("/guest", response_model=AuthResponse, dependencies=[Depends(login_rate_limit)])
def guest_login(
    db: Annotated[DbSession, Depends(get_db)],
) -> AuthResponse:
    if not _is_guest_login_enabled():
        raise HTTPException(status_code=403, detail="Guest login is disabled in production.")

    user = db.execute(select(User).where(User.email == DEBUG_GUEST_EMAIL)).scalar_one_or_none()
    if user is None:
        user = User(
            id=uuid.uuid4(),
            email=DEBUG_GUEST_EMAIL,
            phone_number=None,
            google_sub=None,
            password_hash=hash_password(secrets.token_urlsafe(32)),
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
        try:
            db.commit()
            db.refresh(user)
        except IntegrityError as err:
            db.rollback()
            user = db.execute(select(User).where(User.email == DEBUG_GUEST_EMAIL)).scalar_one_or_none()
            if user is None:
                raise HTTPException(status_code=500, detail="Could not create guest user.") from err
        except SQLAlchemyError as err:
            db.rollback()
            raise HTTPException(
                status_code=500,
                detail="Guest login failed. Ensure database migrations are up to date.",
            ) from err

    if not user.is_active:
        raise HTTPException(status_code=401, detail="Guest user is inactive.")

    return _auth_response_for_user(user)


@router.post("/google", response_model=AuthResponse, dependencies=[Depends(login_rate_limit)])
def google_login(
    payload: GoogleLoginRequest,
    db: Annotated[DbSession, Depends(get_db)],
) -> AuthResponse:
    email, google_sub = _validate_google_identity(payload.id_token)

    user = db.execute(select(User).where(User.google_sub == google_sub)).scalar_one_or_none()
    should_commit = False

    if user is None:
        user_by_email = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if user_by_email is not None:
            if user_by_email.google_sub and user_by_email.google_sub != google_sub:
                raise HTTPException(status_code=409, detail="Google account already linked.")
            user_by_email.google_sub = google_sub
            user = user_by_email
            should_commit = True
        else:
            user = User(
                id=uuid.uuid4(),
                email=email,
                phone_number=None,
                google_sub=google_sub,
                password_hash=hash_password(secrets.token_urlsafe(32)),
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
            should_commit = True

    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    if should_commit:
        db.commit()
        db.refresh(user)

    return _auth_response_for_user(user)


@router.delete("/me")
def delete_my_account(
    payload: DeleteAccountRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> dict:
    if payload.confirm.strip() != "ELIMINAR CUENTA":
        raise HTTPException(status_code=400, detail='Confirmacion invalida. Debe ser "ELIMINAR CUENTA".')

    personal_athlete_id = personal_athlete_id_for_user(user)

    db.execute(delete(Run).where(Run.athlete_id == personal_athlete_id))
    db.execute(delete(TrainingSession).where(TrainingSession.athlete_id == personal_athlete_id))
    db.execute(delete(Athlete).where(Athlete.athlete_id == personal_athlete_id))

    db.execute(delete(CoachAthleteAssignment).where(CoachAthleteAssignment.coach_user_id == user.id))
    db.execute(delete(ExerciseCatalog).where(ExerciseCatalog.owner_user_id == user.id))
    db.execute(delete(UserSettings).where(UserSettings.user_id == user.id))
    db.execute(delete(User).where(User.id == user.id))
    db.commit()

    return {"ok": True}
