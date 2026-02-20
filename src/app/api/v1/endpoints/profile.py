from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.athlete_access import personal_athlete_id_for_user
from app.auth.deps import get_current_user
from app.auth.types import Plan, Role
from app.db.engine import get_db
from app.db.models import Run, TrainingSession
from app.db.models_auth import User, UserSettings
from app.profile import build_profile_gamification

router = APIRouter(prefix="/profile", tags=["profile"])
DbSession = Session


class ProfileData(BaseModel):
    username: str | None
    bio: str | None


class TrainingStats(BaseModel):
    sessions_total: int
    runs_total: int
    last_session_at: str | None
    last_run_at: str | None


class BasicLiftsPrKg(BaseModel):
    back_squat: float | None
    bench_press: float | None
    deadlift: float | None


class PlanningProgress(BaseModel):
    completed_days_total: int
    current_streak_days: int
    longest_streak_days: int
    streak_gap_tolerance_days: int
    last_training_day: str | None


class RelativeStrengthSnapshot(BaseModel):
    body_weight_kg: float | None
    back_squat: float | None
    bench_press: float | None
    deadlift: float | None


class ShowcaseItem(BaseModel):
    title: str
    emblem_png: str | None


class ProfileShowcase(BaseModel):
    achievements: list[ShowcaseItem]
    medals: list[ShowcaseItem]


class ProfileGamification(BaseModel):
    planning: PlanningProgress
    basic_lifts_pr_kg: BasicLiftsPrKg
    relative_strength: RelativeStrengthSnapshot
    showcase: ProfileShowcase
    unlocked_achievements: list[str]
    unlocked_medals: list[str]
    next_targets: list[str]


class ProfileResponse(BaseModel):
    email: str
    role: Role
    plan: Plan
    profile: ProfileData
    training_stats: TrainingStats
    gamification: ProfileGamification


class ProfileUpdateRequest(BaseModel):
    username: str | None = Field(default=None, max_length=64)
    bio: str | None = Field(default=None, max_length=280)


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


def _to_response(db: DbSession, user: User, row: UserSettings) -> ProfileResponse:
    athlete_id = personal_athlete_id_for_user(user)
    gamification_payload = build_profile_gamification(db, athlete_id=athlete_id)
    return ProfileResponse(
        email=user.email,
        role=user.role,
        plan=user.plan,
        profile=ProfileData(
            username=row.profile_username,
            bio=row.profile_bio,
        ),
        training_stats=_training_stats_for_user(db, user),
        gamification=ProfileGamification.model_validate(gamification_payload),
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

    if payload.username is not None:
        username = _clean_text(payload.username)
        if username is not None and len(username) < 3:
            raise HTTPException(status_code=400, detail="Username must be at least 3 characters.")
        row.profile_username = username

    if payload.bio is not None:
        row.profile_bio = _clean_text(payload.bio)

    db.commit()
    db.refresh(row)
    return _to_response(db, user, row)
