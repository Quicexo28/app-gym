from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from coach_ai.latents.types import LatentResult
from coach_ai.suggestions.types import SuggestionResult
from coach_ai.training_core.pipeline import AthleteSeries, PipelineResult
from coach_ai.training_core.types import Issue
from coach_ai.trends.types import TrendResult


@dataclass(frozen=True, slots=True)
class EndToEndConfig:
    """Config snapshot for one e2e run.

    Important: stays directional / probabilistic. No exact prescriptions.
    """

    athlete_id: str
    metric_key: str = "volume_load_kg"
    use_normalized: bool = True

    # Trends
    smooth_method: str = "ewma"
    ewma_alpha: float = 0.35
    slope_threshold_norm: float = 0.05
    lookback: int = 5

    # Latents
    fatigue_alpha: float = 0.35
    plateau_lookback: int = 6

    # training_core normalization
    normalizer_min_n: int = 10
    clip_z: float | None = 5.0

    # Logging
    log_enabled: bool = True
    log_path: str = "data/logs/decisions.jsonl"


@dataclass(frozen=True, slots=True)
class EndToEndResult:
    """All artifacts produced by one end-to-end run."""

    run_id: str
    generated_at_utc: datetime
    engine_version: str
    config_fingerprint: str
    config: dict[str, Any]

    training_core: PipelineResult | None
    athlete_series: AthleteSeries | None
    trend: TrendResult | None
    latents: LatentResult | None
    suggestions: SuggestionResult | None

    issues: list[Issue]
    summary: dict[str, float | str]
