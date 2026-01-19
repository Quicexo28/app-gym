from __future__ import annotations

import numpy as np

from coach_ai.training_core.pipeline import AthleteSeries
from coach_ai.training_core.types import Issue, Severity
from coach_ai.trends import compute_trends
from coach_ai.trends.types import TrendResult

from .confidence import combine_confidence
from .fatigue import compute_fatigue
from .plateau import compute_plateau_probability
from .readiness import compute_readiness
from .types import LatentName, LatentPoint, LatentResult


def compute_latent_states(
    series: AthleteSeries,
    *,
    metric_key: str = "volume_load_kg",
    use_normalized: bool = True,
    trend: TrendResult | None = None,
    fatigue_alpha: float = 0.35,
    fatigue_k: float = 1.2,
    readiness_k: float = 1.2,
    plateau_lookback: int = 6,
) -> LatentResult:
    """Phase 3 pipeline: trends -> latent probabilistic states.

    Inputs:
    - AthleteSeries (from training_core.process_sessions)
    - TrendResult for the same metric (from trends.compute_trends); if not provided, it is computed here.

    Outputs:
    - per-time probabilities for fatigue/readiness/plateau
    - confidence + explanations
    - issues (uncertainty surfaced, not hidden)
    """
    issues: list[Issue] = []

    # Pull metric series
    if use_normalized:
        values = series.normalized.get(metric_key)
        if values is None:
            issues.append(
                Issue(
                    severity=Severity.ERROR,
                    code="latent_metric_missing_normalized",
                    message="Requested metric not present in normalized series.",
                    field="normalized",
                    value=metric_key,
                )
            )
            values = [None] * len(series.start_times)
    else:
        values = series.metrics.get(metric_key)
        if values is None:
            issues.append(
                Issue(
                    severity=Severity.ERROR,
                    code="latent_metric_missing_raw",
                    message="Requested metric not present in raw metrics series.",
                    field="metrics",
                    value=metric_key,
                )
            )
            values = [None] * len(series.start_times)

    # Ensure we have a trend aligned to time ordering
    if trend is None:
        trend = compute_trends(
            series,
            metric_key=metric_key,
            use_normalized=use_normalized,
            smooth_method="ewma",
            ewma_alpha=0.35,
            slope_threshold=0.05 if use_normalized else 1.0,  # raw requires tuning later
            lookback=5,
        )

    # Fatigue
    fatigue_raw, fatigue_p, fat_issues = compute_fatigue(
        values,
        alpha=fatigue_alpha,
        emphasize_positive=True,
        k=fatigue_k,
        x0=0.0,
    )
    issues.extend(fat_issues)

    # Readiness
    readiness_raw, readiness_p, readiness_expl = compute_readiness(
        fatigue_raw,
        trend,
        k=readiness_k,
        x0=0.0,
    )

    # Plateau
    plateau_p, plateau_expl = compute_plateau_probability(
        trend,
        lookback=plateau_lookback,
        slope_ref=0.05 if use_normalized else 1.0,
    )

    # Align lengths safely
    n = len(series.start_times)
    if len(plateau_p) == 0:
        plateau_p = [None] * n
        plateau_expl = ["No trend available."] * n
    else:
        plateau_p = (plateau_p + [None] * n)[:n]
        plateau_expl = (plateau_expl + [""] * n)[:n]

    # Confidence per point
    points: list[LatentPoint] = []
    finite = sum(1 for v in values if v is not None and np.isfinite(v))
    coverage = finite / max(1, n)

    for i in range(n):
        tc = trend.points[i].confidence if i < len(trend.points) else None
        conf = combine_confidence(
            coverage=coverage, trend_confidence=tc, issues=issues + trend.issues
        )

        points.append(
            LatentPoint(
                t=series.start_times[i],
                states={
                    LatentName.FATIGUE.value: fatigue_p[i] if i < len(fatigue_p) else None,
                    LatentName.READINESS.value: readiness_p[i] if i < len(readiness_p) else None,
                    LatentName.PLATEAU.value: plateau_p[i],
                },
                confidence=float(np.clip(conf, 0.0, 1.0)),
                explanation={
                    LatentName.FATIGUE.value: "Fatigue from EWMA of (normalized) load, mapped via sigmoid.",
                    LatentName.READINESS.value: readiness_expl[i]
                    if i < len(readiness_expl)
                    else "Readiness unavailable.",
                    LatentName.PLATEAU.value: plateau_expl[i],
                },
            )
        )

    last = points[-1] if points else None
    summary: dict[str, float | str] = {
        "n_points": float(n),
        "coverage": float(coverage),
        "last_fatigue": float(last.states[LatentName.FATIGUE.value])
        if last and last.states[LatentName.FATIGUE.value] is not None
        else "none",
        "last_readiness": float(last.states[LatentName.READINESS.value])
        if last and last.states[LatentName.READINESS.value] is not None
        else "none",
        "last_plateau": float(last.states[LatentName.PLATEAU.value])
        if last and last.states[LatentName.PLATEAU.value] is not None
        else "none",
        "used_normalized": str(bool(use_normalized)),
        "metric_key": metric_key,
    }

    # Include trend issues (propagate uncertainty)
    issues.extend(trend.issues)

    return LatentResult(
        athlete_id=series.athlete_id,
        metric_key=metric_key,
        used_normalized=use_normalized,
        points=points,
        issues=issues,
        summary=summary,
    )
