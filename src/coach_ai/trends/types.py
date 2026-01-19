from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from coach_ai.training_core.types import Issue


class TrendDirection(StrEnum):
    UP = "up"
    DOWN = "down"
    STABLE = "stable"
    INSUFFICIENT = "insufficient"
    VOLATILE = "volatile"


@dataclass(frozen=True, slots=True)
class TrendPoint:
    """One time point with derived trend info.

    All fields are optional to preserve missingness explicitly.
    """

    t: datetime
    value: float | None  # raw or normalized (depending on pipeline)
    smooth: float | None  # smoothed value
    derivative: float | None  # discrete slope per day
    direction: TrendDirection
    confidence: float  # 0..1 (heuristic, not truth)
    explanation: str  # human-readable rationale


@dataclass(frozen=True, slots=True)
class TrendResult:
    """Trend analysis result for one athlete + one metric key."""

    athlete_id: str
    metric_key: str
    used_normalized: bool
    points: list[TrendPoint]
    issues: list[Issue]
    summary: dict[str, float | str]
