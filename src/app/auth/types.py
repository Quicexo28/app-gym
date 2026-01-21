from __future__ import annotations

from enum import StrEnum


class Role(StrEnum):
    USER = "user"
    COACH = "coach"
    ADMIN = "admin"


class Plan(StrEnum):
    FREE = "free"
    PRO = "pro"
    COACH = "coach"
