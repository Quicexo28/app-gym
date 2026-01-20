from __future__ import annotations

import csv
import json
from datetime import UTC, datetime
from pathlib import Path

from .evaluator import evaluate_simulation
from .simulator import simulate_population
from .types import AthleteSimConfig, ValidationReport


def _now_utc_iso() -> str:
    return datetime.now(UTC).isoformat()


def run_simulated_validation(
    *,
    out_dir: str = "data/validation",
    seed: int = 42,
    n_athletes: int = 8,
    days: int = 84,
    sessions_per_week: int = 4,
    missing_exercises_prob: float = 0.02,
) -> ValidationReport:
    """Generate simulated gym data, run pipeline, and write validation artifacts."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    athletes = [
        AthleteSimConfig(
            athlete_id=f"a{i + 1}",
            days=days,
            sessions_per_week=sessions_per_week,
            missing_exercises_prob=missing_exercises_prob,
            # small heterogeneity
            baseline_volume_kg=550.0 + 80.0 * (i % 3),
            progression_per_week=0.015 + 0.005 * (i % 2),
            volume_noise_cv=0.06 + 0.02 * (i % 2),
        )
        for i in range(n_athletes)
    ]

    sessions, truth = simulate_population(athletes, seed=seed)

    metrics, calibration, point_rows = evaluate_simulation(
        sessions,
        truth,
        metric_key="volume_load_kg",
        use_normalized=True,
        normalizer_min_n=10,
        clip_z=5.0,
    )

    # write points.csv
    points_csv = out / "points.csv"
    fieldnames = list(point_rows[0].keys()) if point_rows else ["athlete_id", "t"]
    with points_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for row in point_rows:
            w.writerow(row)

    # write report.json
    report_json = out / "report.json"
    payload = {
        "generated_at_utc": _now_utc_iso(),
        "seed": seed,
        "n_athletes": n_athletes,
        "n_sessions": len(sessions),
        "metrics": metrics,
        "calibration": calibration,
        "files": {"points_csv": str(points_csv), "report_json": str(report_json)},
    }
    report_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    return ValidationReport(
        generated_at_utc=payload["generated_at_utc"],
        seed=seed,
        n_athletes=n_athletes,
        n_sessions=len(sessions),
        metrics=metrics,
        calibration=calibration,
        files=payload["files"],
    )
