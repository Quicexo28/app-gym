from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass(frozen=True, slots=True)
class ExerciseCompliance:
    """How one exercise of one session compared against what was prescribed.

    The app renders one row per prescribed set, so `sets_prescribed` is the
    number of rows and `sets_completed` the ones the athlete ticked. Everything
    here is a plain count or ratio: no smoothing, no model.
    """

    name: str
    group: str | None
    sets_prescribed: int
    sets_completed: int
    reps_in_target: int
    target_reps_min: int | None
    target_reps_max: int | None
    volume_load_kg: float
    top_load_kg: float | None
    mean_effort_rpe: float | None  # RIR is converted to RPE (rpe = 10 - rir)

    @property
    def set_completion_ratio(self) -> float | None:
        if self.sets_prescribed <= 0:
            return None
        return self.sets_completed / self.sets_prescribed

    @property
    def reps_in_target_ratio(self) -> float | None:
        if self.sets_completed <= 0:
            return None
        return self.reps_in_target / self.sets_completed


@dataclass(frozen=True, slots=True)
class SessionCompliance:
    """Session-level view: dose actually done vs dose prescribed."""

    athlete_id: str
    start_time: datetime
    exercises: list[ExerciseCompliance] = field(default_factory=list)
    sleep_1_10: float | None = None
    stress_1_10: float | None = None
    sensations_1_10: float | None = None
    session_rpe: float | None = None

    @property
    def sets_prescribed(self) -> int:
        return sum(e.sets_prescribed for e in self.exercises)

    @property
    def sets_completed(self) -> int:
        return sum(e.sets_completed for e in self.exercises)

    @property
    def set_completion_ratio(self) -> float | None:
        if self.sets_prescribed <= 0:
            return None
        return self.sets_completed / self.sets_prescribed

    @property
    def reps_in_target_ratio(self) -> float | None:
        completed = self.sets_completed
        if completed <= 0:
            return None
        return sum(e.reps_in_target for e in self.exercises) / completed

    @property
    def volume_load_kg(self) -> float:
        return sum(e.volume_load_kg for e in self.exercises)

    @property
    def has_prescription(self) -> bool:
        """False when the session carries no plan to compare against."""
        return any(e.target_reps_min is not None for e in self.exercises)


@dataclass(frozen=True, slots=True)
class BlockFeatures:
    """Dose + compliance of a training block, ready to model against gains.

    One row per (athlete, block). These are the candidate predictors for
    "how much strength do I gain if I follow the program".
    """

    athlete_id: str
    start: datetime
    end: datetime
    weeks: float
    sessions_done: int
    sessions_planned: int | None
    sessions_per_week: float
    hard_sets_per_week: float
    hard_sets_per_week_by_group: dict[str, float]
    volume_load_kg: float
    set_completion_ratio: float | None
    reps_in_target_ratio: float | None
    mean_effort_rpe: float | None
    mean_sleep_1_10: float | None
    mean_stress_1_10: float | None
    mean_sensations_1_10: float | None
    sessions_with_prescription: int

    @property
    def session_adherence(self) -> float | None:
        """Sessions done over sessions the plan asked for, when that is known."""
        if not self.sessions_planned:
            return None
        return self.sessions_done / self.sessions_planned
