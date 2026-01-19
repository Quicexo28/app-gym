from __future__ import annotations

from typing import Literal

import numpy as np

from coach_ai.training_core.pipeline import AthleteSeries
from coach_ai.training_core.types import Issue, Severity

from .classification import classify_points
from .derivatives import discrete_derivative_per_day
from .smoothing import ewma, rolling_mean
from .types import TrendPoint, TrendResult

SmoothMethod = Literal["ewma", "rolling_mean"]


def compute_trends(
    series: AthleteSeries,
    *,
    metric_key: str = "volume_load_kg",
    use_normalized: bool = True,
    smooth_method: SmoothMethod = "ewma",
    ewma_alpha: float = 0.35,
    rolling_window: int = 5,
    slope_threshold: float = 0.05,
    volatile_threshold: float = 0.20,
    lookback: int = 5,
) -> TrendResult:
    """Compute trend signals for one athlete series and one metric.

    - metric_key: "volume_load_kg" or "srpe_load" (or future metrics)
    - use_normalized: prefer normalized series (z-scores) to make thresholds comparable per athlete

    Returns TrendResult with:
    - TrendPoint per time
    - Issues (e.g. missing metric, time problems)
    - Summary (coverage, last direction/confidence, etc.)
    """
    issues: list[Issue] = []

    if use_normalized:
        values = series.normalized.get(metric_key)
        if values is None:
            issues.append(
                Issue(
                    severity=Severity.ERROR,
                    code="metric_missing_normalized",
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
                    code="metric_missing_raw",
                    message="Requested metric not present in raw metrics series.",
                    field="metrics",
                    value=metric_key,
                )
            )
            values = [None] * len(series.start_times)

    # Smoothing
    if smooth_method == "ewma":
        smooth = ewma(values, alpha=ewma_alpha)
    elif smooth_method == "rolling_mean":
        smooth = rolling_mean(
            values, window=rolling_window, min_periods=max(1, rolling_window // 2)
        )
    else:
        raise ValueError(f"Unsupported smooth_method: {smooth_method}")

    deriv, deriv_issues = discrete_derivative_per_day(series.start_times, smooth)
    issues.extend(deriv_issues)

    dirs, confs, expl = classify_points(
        smooth,
        deriv,
        slope_threshold=slope_threshold,
        volatile_threshold=volatile_threshold,
        lookback=lookback,
    )

    points: list[TrendPoint] = []
    for t, v, s, d, di, c, e in zip(
        series.start_times, values, smooth, deriv, dirs, confs, expl, strict=True
    ):
        points.append(
            TrendPoint(
                t=t,
                value=None if v is None else float(v),
                smooth=None if s is None else float(s),
                derivative=None if d is None else float(d),
                direction=di,
                confidence=float(np.clip(c, 0.0, 1.0)),
                explanation=e,
            )
        )

    # Summary (no deterministic "conclusion", just a compact description)
    finite_count = sum(1 for v in values if v is not None and np.isfinite(v))
    coverage = finite_count / max(1, len(values))
    last = points[-1] if points else None

    summary: dict[str, float | str] = {
        "n_points": float(len(points)),
        "coverage": float(coverage),
        "last_direction": last.direction.value if last else "none",
        "last_confidence": float(last.confidence) if last else 0.0,
        "used_smooth": smooth_method,
        "used_normalized": str(bool(use_normalized)),
    }

    # propagate normalizer uncertainty if any (WARN only)
    if use_normalized and metric_key in series.normalizer_issues:
        for ni in series.normalizer_issues[metric_key]:
            issues.append(ni)

    return TrendResult(
        athlete_id=series.athlete_id,
        metric_key=metric_key,
        used_normalized=use_normalized,
        points=points,
        issues=issues,
        summary=summary,
    )
