from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from coach_ai.training_core.types import Issue


class ScenarioName(StrEnum):
    RECOVERY = "recovery"
    MAINTENANCE = "maintenance"
    PROGRESSION = "progression"
    VARIATION = "variation"
    STABILIZE = "stabilize"
    DATA_REVIEW = "data_review"


@dataclass(frozen=True, slots=True)
class Scenario:
    """One suggested scenario (not an order).

    probability: relative preference among scenarios (sums to 1 across list)
    confidence: quality of evidence (0..1), penalized by issues and low coverage
    levers: suggested knobs (directional, non-prescriptive)
    load_zone_z: optional *relative* target zone in normalized units (z-score range)
                This is intentionally abstract (not kg, not sets).
    """

    name: ScenarioName
    probability: float
    confidence: float
    title: str
    explanation: list[str]
    tradeoffs: list[str]
    levers: dict[str, Any]
    load_zone_z: tuple[float, float] | None = None


@dataclass(frozen=True, slots=True)
class SuggestionResult:
    athlete_id: str
    metric_key: str
    used_normalized: bool
    generated_at: datetime
    scenarios: list[Scenario]
    issues: list[Issue]
    summary: dict[str, float | str]

    @staticmethod
    def now_utc() -> datetime:
        return datetime.now(UTC)
