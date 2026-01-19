from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class StrengthSet(BaseModel):
    """One set in a strength exercise.

    We keep schema permissive (no ge/le constraints) so semantic issues can be emitted
    by validation instead of failing parsing.
    """

    model_config = ConfigDict(extra="forbid")

    reps: int = Field(..., description="Repetitions performed (raw; validated semantically).")
    load_kg: float = Field(..., description="External load in kg (raw; validated semantically).")
    rir: float | None = Field(default=None, description="Reps in reserve (optional).")
    rpe: float | None = Field(default=None, description="Set RPE 0-10 (optional).")
    is_warmup: bool = Field(default=False, description="Warm-up flag (optional).")
    meta: dict[str, Any] = Field(default_factory=dict, description="Free-form set metadata.")


class StrengthExercise(BaseModel):
    """An exercise entry with its sets."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, description="Exercise name (e.g., Bench Press).")
    sets: list[StrengthSet] = Field(default_factory=list, description="List of performed sets.")
    meta: dict[str, Any] = Field(default_factory=dict, description="Free-form exercise metadata.")


class Session(BaseModel):
    """Domain-level representation of a gym training session."""

    model_config = ConfigDict(extra="forbid")

    athlete_id: str = Field(..., min_length=1, description="Athlete identifier")
    start_time: datetime = Field(..., description="Session start datetime")
    duration_min: float = Field(..., description="Duration in minutes (raw)")
    rpe: float | None = Field(default=None, description="Session RPE 0-10 (optional)")
    modality: str | None = Field(
        default="strength", description="Modality label (default: strength)."
    )

    exercises: list[StrengthExercise] = Field(
        default_factory=list,
        description="Gym-specific structure: exercises and sets.",
    )

    source: str | None = Field(default=None, description="Optional data source")
    meta: dict[str, Any] = Field(default_factory=dict, description="Free-form session metadata")
