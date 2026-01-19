from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from .metrics import SessionMetrics, compute_session_metrics
from .normalization import NormalizerParams, fit_normalizer, normalize_series
from .schema import Session
from .types import Issue

MetricKey = Literal["srpe_load", "volume_load_kg"]


@dataclass(frozen=True, slots=True)
class ProcessedSession:
    """One session processed through Phase 1 pipeline steps.

    - Keeps input order (same index as provided).
    - Surfaces uncertainty via issues; does not auto-correct or decide.
    """

    index: int
    session: Session
    issues: list[Issue]
    metrics: SessionMetrics


@dataclass(frozen=True, slots=True)
class AthleteSeries:
    """Time-ordered series for one athlete.

    order: indices into `PipelineResult.processed` (sorted by start_time, tie by original index)
    metrics: raw metric series aligned to `order`
    normalized: normalized (z-score) series aligned to `order`
    """

    athlete_id: str
    order: list[int]
    start_times: list[datetime]
    metrics: dict[str, list[float | None]]
    normalizers: dict[str, NormalizerParams]
    normalizer_issues: dict[str, list[Issue]]
    normalized: dict[str, list[float | None]]


@dataclass(frozen=True, slots=True)
class PipelineResult:
    """Result of Phase 1 batch pipeline.

    processed: per-session results in input order.
    by_athlete: time-ordered series per athlete (ready for trends in Phase 2).
    """

    processed: list[ProcessedSession]
    by_athlete: dict[str, AthleteSeries]


def _extract_metric(metrics: SessionMetrics, key: str) -> float | None:
    """Extract a metric from SessionMetrics by name.

    Returns None if not present or not numeric.
    """
    v = getattr(metrics, key, None)
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def process_sessions(
    sessions: list[Session],
    *,
    metric_keys: tuple[MetricKey, ...] = ("volume_load_kg", "srpe_load"),
    normalizer_min_n: int = 10,
    clip_z: float | None = 5.0,
) -> PipelineResult:
    """Phase 1 batch pipeline: sessions -> issues + metrics -> per-athlete series -> normalization.

    Pipeline steps (no skipping):
      1) Data (Session)
      2) Validation (Issues)
      3) Derived metrics (SessionMetrics)
      4) Time ordering per athlete (for series correctness)
      5) Individual normalization per athlete & metric (median/MAD)

    Notes:
    - This function does not prescribe training and does not decide outcomes.
    - It surfaces uncertainty via issues.
    - Time ordering is a deterministic transform for time-series consumption (Phase 2).
    """
    # Local import to avoid circular import in __init__ exports
    from .validation import validate_session

    processed: list[ProcessedSession] = []
    for idx, s in enumerate(sessions):
        issues = validate_session(s)
        metrics = compute_session_metrics(s)
        processed.append(ProcessedSession(index=idx, session=s, issues=issues, metrics=metrics))

    # Group indices by athlete
    by_athlete_indices: dict[str, list[int]] = {}
    for ps in processed:
        by_athlete_indices.setdefault(ps.session.athlete_id, []).append(ps.index)

    by_athlete: dict[str, AthleteSeries] = {}

    for athlete_id, indices in by_athlete_indices.items():
        # Sort by start_time for correct time-series alignment (tie-breaker: original index)
        order = sorted(indices, key=lambda i: (processed[i].session.start_time, i))
        start_times = [processed[i].session.start_time for i in order]

        metric_series: dict[str, list[float | None]] = {}
        for key in metric_keys:
            metric_series[key] = [_extract_metric(processed[i].metrics, key) for i in order]

        normalizers: dict[str, NormalizerParams] = {}
        normalizer_issues: dict[str, list[Issue]] = {}
        normalized: dict[str, list[float | None]] = {}

        for key in metric_keys:
            values = metric_series[key]
            params, iss = fit_normalizer(values, min_n=normalizer_min_n)
            normalizers[key] = params
            normalizer_issues[key] = iss
            normalized[key] = normalize_series(values, params, clip_z=clip_z)

        by_athlete[athlete_id] = AthleteSeries(
            athlete_id=athlete_id,
            order=order,
            start_times=start_times,
            metrics=metric_series,
            normalizers=normalizers,
            normalizer_issues=normalizer_issues,
            normalized=normalized,
        )

    return PipelineResult(processed=processed, by_athlete=by_athlete)
