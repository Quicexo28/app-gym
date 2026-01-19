from __future__ import annotations

from coach_ai.latents import compute_latent_states
from coach_ai.suggestions.engine import build_context, generate_scenarios
from coach_ai.suggestions.types import SuggestionResult
from coach_ai.training_core.pipeline import AthleteSeries
from coach_ai.training_core.types import Issue
from coach_ai.trends import compute_trends


def suggest_scenarios(
    series: AthleteSeries,
    *,
    metric_key: str = "volume_load_kg",
    use_normalized: bool = True,
) -> SuggestionResult:
    """Phase 4 pipeline: AthleteSeries -> trends -> latents -> scenario suggestions.

    Returns:
    - ranked scenarios with probabilities and confidences
    - issues aggregated (no silent failure)
    """
    trend = compute_trends(
        series,
        metric_key=metric_key,
        use_normalized=use_normalized,
        smooth_method="ewma",
        ewma_alpha=0.35,
        slope_threshold=0.05 if use_normalized else 1.0,
        lookback=5,
    )
    latents = compute_latent_states(
        series,
        metric_key=metric_key,
        use_normalized=use_normalized,
        trend=trend,
        fatigue_alpha=0.35,
        plateau_lookback=6,
    )

    ctx = build_context(trend=trend, latents=latents)
    scenarios = generate_scenarios(ctx)

    issues: list[Issue] = []
    issues.extend(trend.issues)
    issues.extend(latents.issues)

    summary = {
        "n_scenarios": float(len(scenarios)),
        "top_scenario": scenarios[0].name.value if scenarios else "none",
        "top_probability": float(scenarios[0].probability) if scenarios else 0.0,
        "metric_key": metric_key,
        "used_normalized": str(bool(use_normalized)),
    }

    return SuggestionResult(
        athlete_id=series.athlete_id,
        metric_key=metric_key,
        used_normalized=use_normalized,
        generated_at=SuggestionResult.now_utc(),
        scenarios=scenarios,
        issues=issues,
        summary=summary,
    )
