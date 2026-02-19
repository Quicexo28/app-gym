from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from enum import StrEnum

from sqlalchemy import (
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from .base import Base


def now_utc() -> datetime:
    return datetime.now(UTC)


class CycleLevel(StrEnum):
    MICRO = "micro"
    MESO = "meso"
    MACRO = "macro"


class CycleStatus(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    COMPLETED = "completed"
    ARCHIVED = "archived"


class CycleStartMode(StrEnum):
    AUTO_ON_FIRST_SESSION = "auto_on_first_session"
    MANUAL = "manual"


class CycleBlockStatus(StrEnum):
    PENDING = "pending"
    COMPLETED = "completed"
    NOT_APPLICABLE = "not_applicable"


class Athlete(Base):
    __tablename__ = "athletes"

    athlete_id: Mapped[str] = mapped_column(String, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, nullable=False
    )


class CoachAthleteAssignment(Base):
    __tablename__ = "coach_athlete_assignments"
    __table_args__ = (
        UniqueConstraint("coach_user_id", "athlete_id", name="uq_coach_athlete_assignment"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    coach_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        index=True,
        nullable=False,
    )
    athlete_id: Mapped[str] = mapped_column(
        ForeignKey("athletes.athlete_id"),
        index=True,
        nullable=False,
    )
    created_at_utc: Mapped[datetime] = mapped_column(
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


class ExerciseCatalog(Base):
    __tablename__ = "exercise_catalog"
    __table_args__ = (
        Index(
            "ix_exercise_catalog_global_path_key",
            "path_key",
            unique=True,
            postgresql_where=text("owner_user_id IS NULL"),
        ),
        Index(
            "ix_exercise_catalog_custom_owner_path_key",
            "owner_user_id",
            "path_key",
            unique=True,
            postgresql_where=text("owner_user_id IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        index=True,
        nullable=True,
    )
    path_key: Mapped[str] = mapped_column(String(512), nullable=False, index=True)

    group: Mapped[str] = mapped_column(String(120), nullable=False)
    family: Mapped[str] = mapped_column(String(160), nullable=False)
    variation: Mapped[str | None] = mapped_column(String(160), nullable=True)
    subvariation: Mapped[str | None] = mapped_column(String(180), nullable=True)
    aliases: Mapped[list | None] = mapped_column(JSON, nullable=True)

    created_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    updated_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False
    )


class CycleTemplate(Base):
    __tablename__ = "cycle_templates"
    __table_args__ = (
        Index("ix_cycle_templates_owner_level", "owner_user_id", "level"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        index=True,
        nullable=False,
    )
    level: Mapped[CycleLevel] = mapped_column(
        Enum(CycleLevel, name="cycle_level_enum", values_callable=lambda enum_cls: [item.value for item in enum_cls]),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    objective: Mapped[str | None] = mapped_column(String(280), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[CycleStatus] = mapped_column(
        Enum(CycleStatus, name="cycle_status_enum", values_callable=lambda enum_cls: [item.value for item in enum_cls]),
        nullable=False,
        default=CycleStatus.DRAFT,
    )
    training_phase: Mapped[str | None] = mapped_column(String(120), nullable=True)
    nutrition_phase: Mapped[str | None] = mapped_column(String(120), nullable=True)
    focus_tags: Mapped[list | None] = mapped_column(JSON, nullable=True)
    duration_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_weeks: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=now_utc,
        nullable=False,
    )
    updated_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=now_utc,
        onupdate=now_utc,
        nullable=False,
    )


class CycleTemplateLink(Base):
    __tablename__ = "cycle_template_links"
    __table_args__ = (
        UniqueConstraint("parent_template_id", "order_index", name="uq_cycle_template_link_parent_order"),
        UniqueConstraint("parent_template_id", "child_template_id", name="uq_cycle_template_link_parent_child"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    parent_template_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cycle_templates.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    child_template_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cycle_templates.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)


class MicroTemplateBlock(Base):
    __tablename__ = "micro_template_blocks"
    __table_args__ = (
        UniqueConstraint("template_id", "sequence_index", name="uq_micro_template_block_template_seq"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    template_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cycle_templates.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    sequence_index: Mapped[int] = mapped_column(Integer, nullable=False)
    relative_day: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    objective: Mapped[str | None] = mapped_column(String(300), nullable=True)
    routine_snapshot: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
    target_volume: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_intensity: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_fatigue: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_frequency: Mapped[float | None] = mapped_column(Float, nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class CycleAssignment(Base):
    __tablename__ = "cycle_assignments"
    __table_args__ = (
        Index("ix_cycle_assignments_athlete_level_status", "athlete_id", "level", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    athlete_id: Mapped[str] = mapped_column(
        ForeignKey("athletes.athlete_id"),
        index=True,
        nullable=False,
    )
    template_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cycle_templates.id"),
        index=True,
        nullable=False,
    )
    level: Mapped[CycleLevel] = mapped_column(
        Enum(CycleLevel, name="cycle_level_enum", values_callable=lambda enum_cls: [item.value for item in enum_cls]),
        nullable=False,
    )
    assigned_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        index=True,
        nullable=False,
    )
    status: Mapped[CycleStatus] = mapped_column(
        Enum(CycleStatus, name="cycle_status_enum", values_callable=lambda enum_cls: [item.value for item in enum_cls]),
        nullable=False,
        default=CycleStatus.DRAFT,
    )
    start_mode: Mapped[CycleStartMode] = mapped_column(
        Enum(
            CycleStartMode,
            name="cycle_start_mode_enum",
            values_callable=lambda enum_cls: [item.value for item in enum_cls],
        ),
        nullable=False,
        default=CycleStartMode.AUTO_ON_FIRST_SESSION,
    )
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    tolerance_days: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")
    started_at_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archived_at_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    updated_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=now_utc,
        onupdate=now_utc,
        nullable=False,
    )


class CycleAssignmentBlock(Base):
    __tablename__ = "cycle_assignment_blocks"
    __table_args__ = (
        UniqueConstraint("assignment_id", "sequence_index", name="uq_cycle_assignment_block_assignment_seq"),
        Index(
            "ix_cycle_assignment_blocks_assignment_status_target_date",
            "assignment_id",
            "status",
            "target_date",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assignment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cycle_assignments.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    micro_seq: Mapped[int] = mapped_column(Integer, nullable=False)
    sequence_index: Mapped[int] = mapped_column(Integer, nullable=False)
    relative_day: Mapped[int] = mapped_column(Integer, nullable=False)
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    objective: Mapped[str | None] = mapped_column(String(300), nullable=True)
    routine_snapshot: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
    target_volume: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_intensity: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_fatigue: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_frequency: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[CycleBlockStatus] = mapped_column(
        Enum(
            CycleBlockStatus,
            name="cycle_block_status_enum",
            values_callable=lambda enum_cls: [item.value for item in enum_cls],
        ),
        nullable=False,
        default=CycleBlockStatus.PENDING,
    )
    completed_session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sessions.id"),
        nullable=True,
    )
    completed_at_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


import app.db.models_auth  # noqa: F401, E402
