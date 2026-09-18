from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass(frozen=True, slots=True)
class ExerciseState:
    """Descriptive state of one exercise. No model, no forecast."""

    name: str
    sessions: int
    last_top_load_kg: float
    best_top_load_kg: float
    e1rm_kg: float
    best_e1rm_kg: float
    last_session_at: datetime
    days_since_last: int
    sets_last_4w: int


@dataclass(frozen=True, slots=True)
class TrainingEvent:
    """Something that happened, with the rule that detected it written down.

    `rule` is part of the payload on purpose: an event the athlete cannot audit
    is indistinguishable from an opinion.
    """

    kind: str  # personal_record | stall | dropped_exercise | volume_drop
    exercise: str | None
    at: datetime
    detail: str
    rule: str


@dataclass(frozen=True, slots=True)
class NextSetPrediction:
    """Next top set for one exercise.

    The point estimate is the last top set: three backtests over real logs
    showed no model beating that baseline (MAE 6.14 kg vs 6.44 kg for the best
    fitted model). What the engine adds is the interval, calibrated on the
    athlete's own history, and the honesty to abstain.
    """

    exercise: str
    point_kg: float
    low_kg: float
    high_kg: float
    coverage: float
    basis_sessions: int
    method: str


@dataclass(frozen=True, slots=True)
class AthleteInsights:
    athlete_id: str
    generated_at: datetime
    exercises: list[ExerciseState] = field(default_factory=list)
    events: list[TrainingEvent] = field(default_factory=list)
    predictions: list[NextSetPrediction] = field(default_factory=list)
    abstained: list[str] = field(default_factory=list)
    weekly_sets_by_group: dict[str, float] = field(default_factory=dict)
    sessions_last_4w: int = 0
