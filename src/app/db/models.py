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


class CoachNoteScope(StrEnum):
    ROUTINE_EXERCISE = "routine_exercise"
    PROGRAMMING = "programming"


class CoachReportKind(StrEnum):
    SESSION_COMPLETED = "session_completed"
    MEASUREMENT_TAKEN = "measurement_taken"


class Athlete(Base):
    __tablename__ = "athletes"

    athlete_id: Mapped[str] = mapped_column(String, primary_key=True)
    display_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
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
    last_viewed_at_utc: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, nullable=False
    )


class AthletePlan(Base):
    """Plan editable de un atleta: musculos prioritarios definidos por su coach."""

    __tablename__ = "athlete_plans"

    athlete_id: Mapped[str] = mapped_column(
        ForeignKey("athletes.athlete_id", ondelete="CASCADE"),
        primary_key=True,
    )
    priority_muscle_groups: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False
    )


class CoachNote(Base):
    """Feedback del coach sobre un ejercicio de rutina o sobre programacion general.

    read_at_utc queda en null hasta que el atleta expande la nota en su
    sesion activa (pinta el punto rojo de notificacion mientras tanto).
    """

    __tablename__ = "coach_notes"
    __table_args__ = (
        Index(
            "ix_coach_notes_athlete_scope_lookup",
            "athlete_id",
            "scope_type",
            "routine_id",
            "exercise_name_normalized",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    athlete_id: Mapped[str] = mapped_column(
        ForeignKey("athletes.athlete_id"),
        index=True,
        nullable=False,
    )
    author_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        index=True,
        nullable=False,
    )
    scope_type: Mapped[CoachNoteScope] = mapped_column(
        Enum(
            CoachNoteScope,
            name="coach_note_scope_enum",
            values_callable=lambda enum_cls: [item.value for item in enum_cls],
        ),
        nullable=False,
    )
    routine_id: Mapped[str | None] = mapped_column(String, nullable=True)
    exercise_name_normalized: Mapped[str | None] = mapped_column(String(200), nullable=True)
    assignment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cycle_assignments.id", ondelete="CASCADE"),
        nullable=True,
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, nullable=False
    )
    read_at_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CoachReport(Base):
    """Reporte automatico generado al completar sesion o tomar medidas."""

    __tablename__ = "coach_reports"
    __table_args__ = (Index("ix_coach_reports_athlete_created", "athlete_id", "created_at_utc"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    athlete_id: Mapped[str] = mapped_column(
        ForeignKey("athletes.athlete_id"),
        index=True,
        nullable=False,
    )
    kind: Mapped[CoachReportKind] = mapped_column(
        Enum(
            CoachReportKind,
            name="coach_report_kind_enum",
            values_callable=lambda enum_cls: [item.value for item in enum_cls],
        ),
        nullable=False,
    )
    ref_id: Mapped[str] = mapped_column(String, nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, nullable=False
    )


class ActiveSessionHeartbeat(Base):
    """Ultimo ping de una sesion en curso, usado para el filtro 'activo ahora'."""

    __tablename__ = "active_session_heartbeats"

    athlete_id: Mapped[str] = mapped_column(
        ForeignKey("athletes.athlete_id", ondelete="CASCADE"),
        primary_key=True,
    )
    started_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, nullable=False
    )
    last_ping_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False, index=True
    )
    routine_id: Mapped[str | None] = mapped_column(String, nullable=True)
    routine_name: Mapped[str | None] = mapped_column(String(200), nullable=True)


class BodyMeasurement(Base):
    __tablename__ = "body_measurements"
    __table_args__ = (
        Index("ix_body_measurements_athlete_measured_at", "athlete_id", "measured_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    athlete_id: Mapped[str] = mapped_column(
        ForeignKey("athletes.athlete_id"),
        index=True,
        nullable=False,
    )
    measured_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        index=True,
        nullable=False,
    )
    measured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True, nullable=False
    )

    # Stored in metric units for consistency.
    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    height_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    neck_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    shoulders_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    chest_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    waist_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    hip_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    arm_relaxed_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    arm_flexed_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    forearm_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    thigh_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    calf_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    body_fat_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=now_utc,
        nullable=False,
    )


class ProgressShare(Base):
    """Reporte de progreso que el atleta comparte con su coach (y viceversa).

    Solo datos numericos/textuales: las fotos de progreso viven en el
    dispositivo del usuario y nunca llegan al servidor.
    """

    __tablename__ = "progress_shares"
    __table_args__ = (Index("ix_progress_shares_athlete_created", "athlete_id", "created_at_utc"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    athlete_id: Mapped[str] = mapped_column(
        ForeignKey("athletes.athlete_id"),
        index=True,
        nullable=False,
    )
    author_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        index=True,
        nullable=False,
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    snapshot: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, nullable=False
    )


class ProgressShareComment(Base):
    """Respuesta de coach o atleta sobre un reporte de progreso."""

    __tablename__ = "progress_share_comments"
    __table_args__ = (
        Index("ix_progress_share_comments_share_created", "share_id", "created_at_utc"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    share_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("progress_shares.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    author_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        index=True,
        nullable=False,
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
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
    sets_total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reps_total: Mapped[int | None] = mapped_column(Integer, nullable=True)

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
    # Capa nueva: descripcion + eventos con su regla + prediccion con intervalo.
    # Convive con las anteriores mientras se migra la UI.
    insights: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class PredictionLog(Base):
    """Cada prediccion que la app muestra, con lo que paso despues.

    Sin esto no hay forma de saber si el motor sirve: los backtests miden el
    pasado, este registro mide lo que el usuario realmente vio. `resolved_at_utc`
    y `actual_value` se llenan cuando llega la sesion que la contesta.
    """

    __tablename__ = "prediction_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    athlete_id: Mapped[str] = mapped_column(
        ForeignKey("athletes.athlete_id"), index=True, nullable=False
    )
    created_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, nullable=False
    )

    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    exercise_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    method: Mapped[str] = mapped_column(String(80), nullable=False)

    predicted_value: Mapped[float] = mapped_column(Float, nullable=False)
    interval_low: Mapped[float | None] = mapped_column(Float, nullable=True)
    interval_high: Mapped[float | None] = mapped_column(Float, nullable=True)
    coverage: Mapped[float | None] = mapped_column(Float, nullable=True)

    context: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    resolved_at_utc: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    actual_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    inside_interval: Mapped[bool | None] = mapped_column(nullable=True)

    __table_args__ = (
        Index("ix_prediction_logs_athlete_kind", "athlete_id", "kind"),
        Index("ix_prediction_logs_pending", "athlete_id", "resolved_at_utc"),
    )


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

    created_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, nullable=False
    )
    updated_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False
    )


class RoutineStore(Base):
    """Copia servidor del store de rutinas del frontend (scopes -> rutinas).

    Una fila por usuario; el payload replica el formato localStorage v2 para
    que el cliente pueda hidratar/restaurar sin transformaciones.
    """

    __tablename__ = "routine_stores"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    store: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, nullable=False
    )
    updated_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False
    )


class RoutineTemplateExerciseIndex(Base):
    """Indice materializado (coach, atleta, rutina, ejercicio) reconstruido en
    cada PUT /routines/store del coach dueno de la fila.

    Permite responder "que atletas usan esta plantilla/ejercicio" sin parsear
    el JSON de RoutineStore en cada request; se borra e inserta completo por
    coach_user_id en cada guardado (el volumen es cartera-de-un-coach, no global).
    """

    __tablename__ = "routine_template_exercise_index"
    __table_args__ = (
        Index("ix_rtei_coach_template", "coach_user_id", "template_key"),
        Index("ix_rtei_coach_exercise", "coach_user_id", "exercise_name_normalized"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    coach_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    athlete_id: Mapped[str] = mapped_column(
        ForeignKey("athletes.athlete_id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    routine_id: Mapped[str] = mapped_column(String, nullable=False)
    routine_name: Mapped[str] = mapped_column(String(200), nullable=False)
    template_key: Mapped[str] = mapped_column(String(200), nullable=False)
    exercise_name_normalized: Mapped[str] = mapped_column(String(200), nullable=False)
    muscle_group: Mapped[str | None] = mapped_column(String(120), nullable=True)
    target_sets_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_sets_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_reps_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_reps_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False
    )


class CycleTemplate(Base):
    __tablename__ = "cycle_templates"
    __table_args__ = (Index("ix_cycle_templates_owner_level", "owner_user_id", "level"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        index=True,
        nullable=False,
    )
    level: Mapped[CycleLevel] = mapped_column(
        Enum(
            CycleLevel,
            name="cycle_level_enum",
            values_callable=lambda enum_cls: [item.value for item in enum_cls],
        ),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    objective: Mapped[str | None] = mapped_column(String(280), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[CycleStatus] = mapped_column(
        Enum(
            CycleStatus,
            name="cycle_status_enum",
            values_callable=lambda enum_cls: [item.value for item in enum_cls],
        ),
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
        UniqueConstraint(
            "parent_template_id", "order_index", name="uq_cycle_template_link_parent_order"
        ),
        UniqueConstraint(
            "parent_template_id", "child_template_id", name="uq_cycle_template_link_parent_child"
        ),
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
        UniqueConstraint(
            "template_id", "sequence_index", name="uq_micro_template_block_template_seq"
        ),
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
        Enum(
            CycleLevel,
            name="cycle_level_enum",
            values_callable=lambda enum_cls: [item.value for item in enum_cls],
        ),
        nullable=False,
    )
    assigned_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        index=True,
        nullable=False,
    )
    status: Mapped[CycleStatus] = mapped_column(
        Enum(
            CycleStatus,
            name="cycle_status_enum",
            values_callable=lambda enum_cls: [item.value for item in enum_cls],
        ),
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
    completed_at_utc: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    archived_at_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, nullable=False
    )
    updated_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=now_utc,
        onupdate=now_utc,
        nullable=False,
    )


class CycleAssignmentBlock(Base):
    __tablename__ = "cycle_assignment_blocks"
    __table_args__ = (
        UniqueConstraint(
            "assignment_id", "sequence_index", name="uq_cycle_assignment_block_assignment_seq"
        ),
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
        ForeignKey("sessions.id", ondelete="SET NULL"),
        nullable=True,
    )
    completed_at_utc: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class FoodProduct(Base):
    """Catalogo de alimentos: global (owner_user_id NULL) o personal de un usuario.

    Mismo patron que ExerciseCatalog. El barcode solo es unico dentro del
    catalogo global; un alimento personal puede repetir un barcode ya usado
    globalmente sin romper nada. Macros siempre normalizados a 100 g/ml.
    """

    __tablename__ = "food_products"
    __table_args__ = (
        Index(
            "ix_food_products_global_barcode",
            "barcode",
            unique=True,
            postgresql_where=text("owner_user_id IS NULL AND barcode IS NOT NULL"),
        ),
        Index("ix_food_products_owner_name", "owner_user_id", "name"),
        Index("ix_food_products_name_search", "name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        index=True,
        nullable=True,
    )
    barcode: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    source: Mapped[str] = mapped_column(
        String(24), nullable=False
    )  # off | user_photo | user_manual
    source_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    brand: Mapped[str | None] = mapped_column(String(200), nullable=True)
    country_code: Mapped[str | None] = mapped_column(
        String(2), nullable=True
    )  # 'CO'; NULL = global
    category: Mapped[str | None] = mapped_column(
        String(80), index=True, nullable=True
    )  # grupo del catalogo de origen (p.ej. categorias TCAC); NULL si no aplica
    serving_size_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    serving_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    package_qty_g: Mapped[float | None] = mapped_column(Float, nullable=True)

    basis: Mapped[str] = mapped_column(
        String(12), nullable=False, default="per_100g"
    )  # per_100g | per_100ml

    # Macros SIEMPRE normalizados a 100 g/ml.
    energy_kcal: Mapped[float | None] = mapped_column(Float, nullable=True)
    protein_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    carbs_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    sugars_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    fiber_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    fat_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    sat_fat_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    trans_fat_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    sodium_mg: Mapped[float | None] = mapped_column(Float, nullable=True)
    cholesterol_mg: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Micronutrientes: JSON keyed por el registro canonico (app.nutrition.micronutrients).
    micronutrients: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    image_front_path: Mapped[str | None] = mapped_column(String(300), nullable=True)
    image_nutrition_path: Mapped[str | None] = mapped_column(String(300), nullable=True)

    verified_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="active"
    )  # active | pending | rejected
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )
    created_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, nullable=False
    )
    updated_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False
    )


class MealEntry(Base):
    """Registro de una comida consumida.

    Regla critica: los valores nutricionales son un snapshot congelado para
    la cantidad consumida en el momento del registro, no una referencia viva
    al catalogo. Si el producto se corrige despues, este historial no cambia.
    """

    __tablename__ = "meal_entries"
    __table_args__ = (
        Index("ix_meal_entries_athlete_consumed", "athlete_id", "consumed_at"),
        # Idempotencia del registro offline: un `client_ref` lo genera el
        # cliente al encolar (no al enviar), asi que reintentar el mismo
        # payload tras un timeout no duplica la comida. Unico por atleta,
        # solo cuando viene informado (mismo patron que ExerciseCatalog/FoodProduct).
        Index(
            "ix_meal_entries_athlete_client_ref",
            "athlete_id",
            "client_ref",
            unique=True,
            postgresql_where=text("client_ref IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    athlete_id: Mapped[str] = mapped_column(
        ForeignKey("athletes.athlete_id"),
        index=True,
        nullable=False,
    )
    logged_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        index=True,
        nullable=False,
    )
    consumed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True, nullable=False
    )
    meal_slot: Mapped[str] = mapped_column(
        String(16), nullable=False
    )  # desayuno | almuerzo | cena | snack
    food_product_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("food_products.id"),
        nullable=True,
    )

    # SNAPSHOT congelado al momento de registrar.
    food_name: Mapped[str] = mapped_column(String(300), nullable=False)
    # `quantity_g` es la cantidad NORMALIZADA a la unidad base del alimento
    # (gramos si basis=per_100g, mililitros si per_100ml): es la unica que
    # entra en la aritmetica de macros. `quantity_value`/`quantity_unit`
    # guardan lo que el usuario escribio ("2 porciones", "1.5 tazas") para
    # poder mostrarlo y reeditarlo igual. NULL en entradas anteriores a las
    # unidades: ahi se asume la unidad base. Ver `app.nutrition.units`.
    quantity_g: Mapped[float] = mapped_column(Float, nullable=False)
    quantity_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    quantity_unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    energy_kcal: Mapped[float | None] = mapped_column(Float, nullable=True)
    protein_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    carbs_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    sugars_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    fiber_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    fat_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    sat_fat_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    sodium_mg: Mapped[float | None] = mapped_column(Float, nullable=True)
    micronutrients: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_ref: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, nullable=False
    )


class MealPreset(Base):
    """Comida preestablecida: lista de items con snapshot nutricional propio."""

    __tablename__ = "meal_presets"
    __table_args__ = (Index("ix_meal_presets_owner_name", "owner_user_id", "name", unique=True),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        index=True,
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    meal_slot: Mapped[str | None] = mapped_column(String(16), nullable=True)
    items: Mapped[list] = mapped_column(
        JSON, nullable=False
    )  # [{food_product_id, food_name, quantity_g, ...}]
    created_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, nullable=False
    )
    updated_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False
    )


class NutritionTarget(Base):
    """Objetivos diarios de nutricion de un atleta."""

    __tablename__ = "nutrition_targets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    athlete_id: Mapped[str] = mapped_column(
        ForeignKey("athletes.athlete_id"),
        unique=True,
        nullable=False,
    )
    energy_kcal: Mapped[float | None] = mapped_column(Float, nullable=True)
    protein_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    carbs_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    fat_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    fiber_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    micronutrient_targets: Mapped[dict | None] = mapped_column(
        JSON, nullable=True
    )  # overrides sobre el RDA
    meal_labels: Mapped[list | None] = mapped_column(
        JSON, nullable=True
    )  # nombres personalizados de comidas, en orden (None = default "Comida N")
    updated_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False
    )


import app.db.models_auth  # noqa: F401, E402
