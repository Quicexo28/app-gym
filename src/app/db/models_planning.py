from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


def now_utc() -> datetime:
    return datetime.now(UTC)


class CycleTemplate(Base):
    __tablename__ = "cycle_templates"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        index=True,
        nullable=False,
    )
    level: Mapped[str] = mapped_column(String(16), index=True, nullable=False)  # micro | meso | macro
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    objective: Mapped[str | None] = mapped_column(String(240), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    status: Mapped[str] = mapped_column(String(16), index=True, nullable=False, default="draft")
    training_phase: Mapped[str | None] = mapped_column(String(64), nullable=True)
    nutrition_phase: Mapped[str | None] = mapped_column(String(64), nullable=True)
    focus_tags: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    duration_days: Mapped[float | None] = mapped_column(Float, nullable=True)
    duration_weeks: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    updated_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False
    )


class CycleTemplateLink(Base):
    __tablename__ = "cycle_template_links"
    __table_args__ = (
        UniqueConstraint("parent_template_id", "child_template_id", name="uq_cycle_template_parent_child"),
        UniqueConstraint("parent_template_id", "order_index", name="uq_cycle_template_parent_order"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    parent_template_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cycle_templates.id"),
        index=True,
        nullable=False,
    )
    child_template_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cycle_templates.id"),
        index=True,
        nullable=False,
    )
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)


class MicroTemplateBlock(Base):
    __tablename__ = "micro_template_blocks"
    __table_args__ = (
        UniqueConstraint("template_id", "sequence_index", name="uq_micro_template_sequence"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    template_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cycle_templates.id"),
        index=True,
        nullable=False,
    )
    sequence_index: Mapped[int] = mapped_column(Integer, nullable=False)
    relative_day: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    objective: Mapped[str | None] = mapped_column(String(400), nullable=True)
    routine_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    target_volume: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_intensity: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_fatigue: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_frequency: Mapped[float | None] = mapped_column(Float, nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    updated_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False
    )


class CycleAssignment(Base):
    __tablename__ = "cycle_assignments"
    __table_args__ = (
        Index("ix_cycle_assignments_athlete_level_status", "athlete_id", "level", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    athlete_id: Mapped[str] = mapped_column(ForeignKey("athletes.athlete_id"), index=True, nullable=False)
    template_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cycle_templates.id"),
        index=True,
        nullable=False,
    )
    level: Mapped[str] = mapped_column(String(16), index=True, nullable=False)
    assigned_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        index=True,
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(16), index=True, nullable=False, default="draft")
    start_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="auto_on_first_session")
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    tolerance_days: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")
    started_at_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archived_at_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    updated_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False
    )


class CycleAssignmentBlock(Base):
    __tablename__ = "cycle_assignment_blocks"
    __table_args__ = (
        UniqueConstraint("assignment_id", "sequence_index", name="uq_assignment_sequence"),
        Index("ix_assignment_blocks_assignment_micro", "assignment_id", "micro_seq"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assignment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cycle_assignments.id"),
        index=True,
        nullable=False,
    )
    micro_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    sequence_index: Mapped[int] = mapped_column(Integer, nullable=False)
    relative_day: Mapped[int] = mapped_column(Integer, nullable=False)
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    objective: Mapped[str | None] = mapped_column(String(400), nullable=True)
    routine_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    target_volume: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_intensity: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_fatigue: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_frequency: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(16), index=True, nullable=False, default="pending")
    completed_session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sessions.id"),
        nullable=True,
    )
    completed_at_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    updated_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False
    )
