from __future__ import annotations

import numpy as np

from coach_ai.latents import compute_latent_states
from coach_ai.suggestions import suggest_scenarios
from coach_ai.training_core.pipeline import process_sessions
from coach_ai.trends import compute_trends

from .stats import bucket_by_confidence, mean_abs_error, spearman_corr
from .types import SimulatedTruthPoint


def _truth_by_athlete(truth: list[SimulatedTruthPoint]) -> dict[str, list[SimulatedTruthPoint]]:
    out: dict[str, list[SimulatedTruthPoint]] = {}
    for p in truth:
        out.setdefault(p.athlete_id, []).append(p)
    return out


def evaluate_simulation(
    sessions,
    truth: list[SimulatedTruthPoint],
    *,
    metric_key: str = "volume_load_kg",
    use_normalized: bool = True,
    normalizer_min_n: int = 10,
    clip_z: float | None = 5.0,
) -> tuple[dict, list[dict], list[dict]]:
    """Run pipeline on simulated data and compute internal validation metrics.

    Returns:
      - metrics_summary (dict)
      - calibration_buckets (list)
      - point_rows (list of dict rows for CSV)
    """
    tc = process_sessions(
        sessions,
        metric_keys=(metric_key, "srpe_load"),
        normalizer_min_n=normalizer_min_n,
        clip_z=clip_z,
    )

    truth_map = _truth_by_athlete(truth)

    all_pred_fatigue: list[float | None] = []
    all_true_fatigue: list[float | None] = []
    all_conf: list[float | None] = []
    all_abs_err: list[float | None] = []
    coverage_list: list[float] = []

    point_rows: list[dict] = []

    for athlete_id, series in tc.by_athlete.items():
        # Align truth by time (both are sorted by time)
        t_points = truth_map.get(athlete_id, [])

        trend = compute_trends(series, metric_key=metric_key, use_normalized=use_normalized)
        lat = compute_latent_states(
            series, metric_key=metric_key, use_normalized=use_normalized, trend=trend
        )
        sug = suggest_scenarios(series, metric_key=metric_key, use_normalized=use_normalized)

        # map time -> truth
        truth_by_time = {p.t: p for p in t_points}

        # coverage
        values = series.normalized[metric_key] if use_normalized else series.metrics[metric_key]
        finite = sum(1 for v in values if v is not None and np.isfinite(v))
        coverage = finite / max(1, len(values))
        coverage_list.append(float(coverage))

        for i, lp in enumerate(lat.points):
            tt = truth_by_time.get(lp.t)
            tf = None if tt is None else tt.true_fatigue_p
            pf = lp.states.get("fatigue")

            c = float(lp.confidence)
            e = None
            if tf is not None and pf is not None:
                e = float(abs(float(pf) - float(tf)))

            all_true_fatigue.append(tf)
            all_pred_fatigue.append(pf)
            all_conf.append(c)
            all_abs_err.append(e)

            top = sug.scenarios[0].name.value if sug.scenarios else "none"

            point_rows.append(
                {
                    "athlete_id": athlete_id,
                    "t": lp.t.isoformat(),
                    "metric_key": metric_key,
                    "coverage_athlete": coverage,
                    "pred_fatigue": pf,
                    "true_fatigue": tf,
                    "abs_error": e,
                    "confidence": c,
                    "trend_dir": trend.points[i].direction.value
                    if i < len(trend.points)
                    else "none",
                    "trend_conf": float(trend.points[i].confidence)
                    if i < len(trend.points)
                    else None,
                    "top_scenario": top,
                }
            )

    # summary metrics
    fatigue_spearman = spearman_corr(all_pred_fatigue, all_true_fatigue)
    mae = mean_abs_error(all_pred_fatigue, all_true_fatigue)

    metrics = {
        "coverage_mean": float(np.mean(coverage_list)) if coverage_list else 0.0,
        "fatigue_spearman": fatigue_spearman,
        "fatigue_mae": mae,
        "n_points_eval": sum(
            1
            for x, y in zip(all_pred_fatigue, all_true_fatigue, strict=False)
            if x is not None and y is not None
        ),
    }

    calibration = bucket_by_confidence(all_conf, all_abs_err, bins=6)
    return metrics, calibration, point_rows
