from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.v1.endpoints.progress import display_label
from app.auth.athlete_access import personal_athlete_id_for_user
from app.auth.deps import get_current_user
from app.auth.types import Plan, Role
from app.db.engine import get_db
from app.db.models import CoachAthleteAssignment, Run, TrainingSession
from app.db.models_auth import User, UserSettings

router = APIRouter(prefix="/profile", tags=["profile"])
DbSession = Session


GENDERS = ("male", "female", "other", "unspecified")
MIN_BIRTH_YEAR = 1900
MIN_HEIGHT_CM = 80.0
MAX_HEIGHT_CM = 260.0


class ProfileData(BaseModel):
    display_name: str | None
    username: str | None
    bio: str | None
    birth_date: date | None
    gender: str | None
    height_cm: float | None


class TrainingStats(BaseModel):
    sessions_total: int
    runs_total: int
    last_session_at: str | None
    last_run_at: str | None


class ProfileContact(BaseModel):
    user_id: str
    label: str


class ProfileNetwork(BaseModel):
    """Vinculo coach<->atleta: con quien puede interactuar este perfil."""

    athlete_id: str
    coaches: list[ProfileContact]
    athletes_total: int


class ProfileResponse(BaseModel):
    email: str
    role: Role
    plan: Plan
    profile: ProfileData
    training_stats: TrainingStats
    network: ProfileNetwork


class ProfileUpdateRequest(BaseModel):
    """Campos omitidos se dejan intactos; enviados como null se borran."""

    display_name: str | None = Field(default=None, max_length=64)
    username: str | None = Field(default=None, max_length=64)
    bio: str | None = Field(default=None, max_length=280)
    birth_date: date | None = Field(default=None)
    gender: str | None = Field(default=None)
    height_cm: float | None = Field(default=None)

    @field_validator("gender")
    @classmethod
    def _check_gender(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if not normalized:
            return None
        if normalized not in GENDERS:
            raise ValueError(f"Gender must be one of: {', '.join(GENDERS)}.")
        return normalized

    @field_validator("birth_date")
    @classmethod
    def _check_birth_date(cls, value: date | None) -> date | None:
        if value is None:
            return None
        if value > datetime.now(UTC).date():
            raise ValueError("Birth date cannot be in the future.")
        if value.year < MIN_BIRTH_YEAR:
            raise ValueError(f"Birth date must be after {MIN_BIRTH_YEAR}.")
        return value

    @field_validator("height_cm")
    @classmethod
    def _check_height(cls, value: float | None) -> float | None:
        if value is None:
            return None
        if not MIN_HEIGHT_CM <= value <= MAX_HEIGHT_CM:
            raise ValueError(f"Height must be between {MIN_HEIGHT_CM} and {MAX_HEIGHT_CM} cm.")
        return round(float(value), 1)


def _clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = " ".join(value.split()).strip()
    return cleaned or None


def _ensure_settings(db: DbSession, user: User) -> UserSettings:
    row = db.get(UserSettings, user.id)
    if row is not None:
        return row

    row = UserSettings(user_id=user.id, weight_unit="kg", effort_mode="rpe", modules_enabled={})
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _training_stats_for_user(db: DbSession, user: User) -> TrainingStats:
    athlete_id = personal_athlete_id_for_user(user)

    sessions_total, last_session_at = db.execute(
        select(func.count(TrainingSession.id), func.max(TrainingSession.start_time)).where(
            TrainingSession.athlete_id == athlete_id
        )
    ).one()
    runs_total, last_run_at = db.execute(
        select(func.count(Run.run_id), func.max(Run.generated_at_utc)).where(
            Run.athlete_id == athlete_id
        )
    ).one()

    return TrainingStats(
        sessions_total=int(sessions_total or 0),
        runs_total=int(runs_total or 0),
        last_session_at=last_session_at.isoformat() if last_session_at else None,
        last_run_at=last_run_at.isoformat() if last_run_at else None,
    )


def _network_for_user(db: DbSession, user: User) -> ProfileNetwork:
    athlete_id = personal_athlete_id_for_user(user)

    coach_rows = db.execute(
        select(User.id, User.email, UserSettings.profile_username)
        .join(CoachAthleteAssignment, CoachAthleteAssignment.coach_user_id == User.id)
        .join(UserSettings, UserSettings.user_id == User.id, isouter=True)
        .where(CoachAthleteAssignment.athlete_id == athlete_id)
        .order_by(User.email.asc())
    ).all()

    athletes_total = int(
        db.execute(
            select(func.count(CoachAthleteAssignment.id)).where(
                CoachAthleteAssignment.coach_user_id == user.id
            )
        ).scalar_one()
        or 0
    )

    return ProfileNetwork(
        athlete_id=athlete_id,
        coaches=[
            ProfileContact(user_id=str(coach_id), label=display_label(username, email))
            for coach_id, email, username in coach_rows
        ],
        athletes_total=athletes_total,
    )


def _to_response(db: DbSession, user: User, row: UserSettings) -> ProfileResponse:
    return ProfileResponse(
        email=user.email,
        role=user.role,
        plan=user.plan,
        profile=ProfileData(
            display_name=row.profile_display_name,
            username=row.profile_username,
            bio=row.profile_bio,
            birth_date=row.profile_birth_date,
            gender=row.profile_gender,
            height_cm=row.profile_height_cm,
        ),
        training_stats=_training_stats_for_user(db, user),
        network=_network_for_user(db, user),
    )


@router.get("/me", response_model=ProfileResponse)
def get_my_profile(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> ProfileResponse:
    row = _ensure_settings(db, user)
    return _to_response(db, user, row)


@router.put("/me", response_model=ProfileResponse)
def update_my_profile(
    payload: ProfileUpdateRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> ProfileResponse:
    row = _ensure_settings(db, user)
    sent = payload.model_fields_set

    if "username" in sent:
        username = _clean_text(payload.username)
        if username is not None and len(username) < 3:
            raise HTTPException(status_code=400, detail="Username must be at least 3 characters.")
        row.profile_username = username

    if "display_name" in sent:
        row.profile_display_name = _clean_text(payload.display_name)

    if "bio" in sent:
        row.profile_bio = _clean_text(payload.bio)

    if "birth_date" in sent:
        row.profile_birth_date = payload.birth_date

    if "gender" in sent:
        row.profile_gender = payload.gender

    if "height_cm" in sent:
        row.profile_height_cm = payload.height_cm

    db.commit()
    db.refresh(row)
    return _to_response(db, user, row)
