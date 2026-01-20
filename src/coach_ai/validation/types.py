from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass(frozen=True, slots=True)
class AthleteSimConfig:
    athlete_id: str
    days: int = 84  # ~12 weeks
    sessions_per_week: int = 4

    # Load model
    baseline_volume_kg: float = 600.0
    progression_per_week: float = 0.02  # +2%/week on build weeks
    deload_every_weeks: int = 4
    deload_multiplier: float = 0.65

    # Noise / data quality
    volume_noise_cv: float = 0.08  # coefficient of variation
    missing_exercises_prob: float = 0.02
    naming_noise_prob: float = 0.02

    # Exercise structure
    sets_per_session: int = 3
    reps_per_set: int = 8

    # Session RPE (optional signal)
    include_session_rpe: bool = True
    rpe_base: float = 7.0
    rpe_fatigue_gain: float = 1.2  # how much true fatigue raises RPE


@dataclass(frozen=True, slots=True)
class SimulationConfig:
    seed: int = 42
    start_utc: datetime | None = None
    athletes: list[AthleteSimConfig] = None  # type: ignore[assignment]


@dataclass(frozen=True, slots=True)
class SimulatedTruthPoint:
    athlete_id: str
    t: datetime
    volume_load_kg: float | None

    # "Ground truth" latent signals (for internal validation only)
    true_fatigue_raw: float | None
    true_fatigue_p: float | None
    true_plateau_flag: int | None  # 0/1 based on a simple rule

    meta: dict[str, Any]


@dataclass(frozen=True, slots=True)
class ValidationReport:
    generated_at_utc: str
    seed: int
    n_athletes: int
    n_sessions: int

    metrics: dict[str, Any]
    calibration: list[dict[str, Any]]

    files: dict[str, str]
