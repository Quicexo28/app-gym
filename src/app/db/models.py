from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from .base import Base


def now_utc() -> datetime:
    return datetime.now(UTC)


class Athlete(Base):
    __tablename__ = "athletes"

    athlete_id: Mapped[str] = mapped_column(String, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, nullable=False
    )


class TrainingSession(Base):
    __tablename__ = "sessions"
    __table_args__ = (
        UniqueConstraint("athlete_id", "start_time", name="uq_session_athlete_start"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    athlete_id: Mapped[str] = mapped_column(
        ForeignKey("athletes.athlete_id"), index=True, nullable=False
    )

    start_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True, nullable=False
    )
    duration_min: Mapped[float] = mapped_column(Float, nullable=False)
    rpe: Mapped[float | None] = mapped_column(Float, nullable=True)
    modality: Mapped[str | None] = mapped_column(String, nullable=True)
    source: Mapped[str | None] = mapped_column(String, nullable=True)

    exercises: Mapped[list | None] = mapped_column(JSON, nullable=True)  # list of exercises (raw)
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # cached derived metrics (optional but useful)
    volume_load_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    srpe_load: Mapped[float | None] = mapped_column(Float, nullable=True)
    sets_total: Mapped[int | None] = mapped_column(Float, nullable=True)
    reps_total: Mapped[int | None] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, nullable=False
    )


class Run(Base):
    __tablename__ = "runs"

    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    athlete_id: Mapped[str] = mapped_column(
        ForeignKey("athletes.athlete_id"), index=True, nullable=False
    )

    generated_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, nullable=False
    )
    engine_version: Mapped[str] = mapped_column(String, nullable=False)
    config_fingerprint: Mapped[str] = mapped_column(String, index=True, nullable=False)

    metric_key: Mapped[str] = mapped_column(String, nullable=False)
    used_normalized: Mapped[bool] = mapped_column(nullable=False)

    config: Mapped[dict] = mapped_column(JSON, nullable=False)
    summary: Mapped[dict] = mapped_column(JSON, nullable=False)

    trend: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    latents: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    suggestions: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    issues: Mapped[list | None] = mapped_column(JSON, nullable=True)


import app.db.models_auth  # noqa: F401, E402
