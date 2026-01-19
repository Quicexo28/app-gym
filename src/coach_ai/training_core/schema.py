from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class Session(BaseModel):
    """Domain-level representation of a training session.

    Notes:
    - Keep this model *light*: it should parse types reliably.
    - Semantic validation lives in `coach_ai.training_core.validation`.
    - `external_load` is a flexible dict to avoid premature ontology decisions.
    """

    model_config = ConfigDict(extra="forbid")

    athlete_id: str = Field(..., min_length=1, description="Athlete identifier")
    start_time: datetime = Field(..., description="Session start datetime")
    duration_min: float = Field(..., description="Duration in minutes (raw)")
    rpe: float | None = Field(default=None, description="Session RPE 0-10 (optional)")
    modality: str | None = Field(default=None, description="Optional modality label")
    external_load: dict[str, float] = Field(
        default_factory=dict,
        description="Optional external load signals (e.g., distance_km, tonnage_kg).",
    )
    source: str | None = Field(
        default=None,
        description="Optional data source (manual, device name, platform).",
    )
    meta: dict[str, Any] = Field(
        default_factory=dict,
        description="Free-form metadata (kept for traceability; not used by core rules).",
    )
