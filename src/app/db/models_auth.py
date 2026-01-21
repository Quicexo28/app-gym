from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.auth.types import Plan, Role
from app.db.models import Base  # ajusta si tu Base está en otro módulo


def utcnow() -> datetime:
    return datetime.now(UTC)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    role: Mapped[Role] = mapped_column(
        Enum(Role, name="role_enum"), nullable=False, default=Role.USER
    )
    plan: Mapped[Plan] = mapped_column(
        Enum(Plan, name="plan_enum"), nullable=False, default=Plan.FREE
    )

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    settings: Mapped[UserSettings] = relationship(back_populates="user", uselist=False)


class UserSettings(Base):
    __tablename__ = "user_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True
    )

    weight_unit: Mapped[str] = mapped_column(String(8), nullable=False, default="kg")  # kg | lb
    effort_mode: Mapped[str] = mapped_column(String(8), nullable=False, default="rpe")  # rpe | rir

    modules_enabled: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    created_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    user: Mapped[User] = relationship(back_populates="settings")
