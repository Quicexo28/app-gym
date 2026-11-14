"""Helpers de fecha y hora compartidos."""

from __future__ import annotations

from datetime import UTC, datetime


def to_utc(value: datetime) -> datetime:
    """Convierte a UTC; una fecha sin zona se asume UTC."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
