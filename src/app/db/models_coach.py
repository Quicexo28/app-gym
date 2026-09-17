from __future__ import annotations

import uuid
from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class CoachBillingStatus(StrEnum):
    NONE = "none"
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELED = "canceled"


class CoachProfile(Base):
    __tablename__ = "coach_profiles"

    coach_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True
    )
    invite_code: Mapped[str] = mapped_column(String(16), unique=True, index=True, nullable=False)
    invite_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class CoachBilling(Base):
    __tablename__ = "coach_billing"

    coach_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True
    )
    stripe_customer_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    stripe_base_item_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    stripe_seat_item_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    extra_seats: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[CoachBillingStatus] = mapped_column(
        Enum(CoachBillingStatus, name="coach_billing_status_enum"),
        nullable=False,
        default=CoachBillingStatus.NONE,
    )

    updated_at_utc: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )
