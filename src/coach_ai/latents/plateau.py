from __future__ import annotations

import numpy as np

from coach_ai.trends.types import TrendDirection, TrendResult

from .probability import sigmoid


def compute_plateau_probability(
    trend: TrendResult | None,
    *,
    lookback: int = 6,
    slope_ref: float = 0.05,
    k: float = 6.0,
) -> tuple[list[float | None], list[str]]:
    """Compute Plateau_t probability per point from trend classification.

    Interpretation (explicit, gym-focused):
    - Plateau here means "stagnation-like pattern in the *chosen metric trend*",
      not a diagnosis, not a performance guarantee.
    - High probability when recent points are mostly STABLE with low slope magnitude,
      and not VOLATILE.

    Returns:
    - plateau_p per point (None if no trend)
    - explanations per point
    """
    if trend is None:
        return [], []

    n = len(trend.points)
    out: list[float | None] = []
    expl: list[str] = []

    for i in range(n):
        j0 = max(0, i - lookback + 1)
        window = trend.points[j0 : i + 1]

        dirs = [p.direction for p in window]
        confs = [float(np.clip(p.confidence, 0.0, 1.0)) for p in window]
        slopes = [
            p.derivative for p in window if p.derivative is not None and np.isfinite(p.derivative)
        ]

        stable_ratio = dirs.count(TrendDirection.STABLE) / max(1, len(dirs))
        volatile_ratio = dirs.count(TrendDirection.VOLATILE) / max(1, len(dirs))
        conf_avg = float(np.mean(confs)) if confs else 0.0
        mean_abs_slope = float(np.mean([abs(float(s)) for s in slopes])) if slopes else 0.0

        # score: stable helps, volatile hurts, high slope hurts
        score = (
            (stable_ratio * conf_avg)
            - (0.8 * volatile_ratio)
            - (mean_abs_slope / max(1e-6, slope_ref))
        )
        p = sigmoid(score, k=k, x0=0.0)

        out.append(float(np.clip(p, 0.0, 1.0)))
        expl.append(
            f"Plateau score from window: stable={stable_ratio:.2f}, volatile={volatile_ratio:.2f}, "
            f"|slope|={mean_abs_slope:.3f}, conf={conf_avg:.2f}."
        )

    return out, expl
