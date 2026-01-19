from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from coach_ai.training_core.types import Issue


class LatentName(StrEnum):
    FATIGUE = "fatigue"
    READINESS = "readiness"
    PLATEAU = "plateau"


@dataclass(frozen=True, slots=True)
class LatentPoint:
    """One time point with probabilistic latent states.

    states: probabilities in [0,1] (or None if missing data)
    confidence: 0..1 heuristic confidence about the quality of the inference
    explanation: short human-readable rationale per latent
    """

    t: datetime
    states: dict[str, float | None]
    confidence: float
    explanation: dict[str, str]


@dataclass(frozen=True, slots=True)
class LatentResult:
    """Latent states for one athlete (Phase 3 output)."""

    athlete_id: str
    metric_key: str
    used_normalized: bool
    points: list[LatentPoint]
    issues: list[Issue]
    summary: dict[str, float | str]
