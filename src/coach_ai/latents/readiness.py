from __future__ import annotations

import numpy as np

from coach_ai.trends.types import TrendDirection, TrendResult

from .probability import to_probability_series


def compute_readiness(
    fatigue_raw: list[float | None],
    trend: TrendResult | None,
    *,
    k: float = 1.2,
    x0: float = 0.0,
) -> tuple[list[float | None], list[float | None], list[str]]:
    """Compute Readiness_t as a probabilistic state.

    Heuristic (explicit):
    - readiness_raw is inversely related to fatigue_raw
    - small modulation from the current load trend direction:
        DOWN  -> slightly higher readiness (possible recovery context)
        UP    -> slightly lower readiness (possible accumulating context)
        VOLATILE -> slightly lower (uncertainty)
        STABLE/INSUFFICIENT -> neutral

    Returns:
    - readiness_raw
    - readiness_p in [0,1]
    - explanations per point
    """
    n = len(fatigue_raw)
    readiness_raw: list[float | None] = []
    expl: list[str] = []

    for i in range(n):
        f = fatigue_raw[i]
        if f is None or not np.isfinite(f):
            readiness_raw.append(None)
            expl.append("Insufficient fatigue signal (missing).")
            continue

        bonus = 0.0
        note = "Base readiness from inverse fatigue."

        if trend is not None and i < len(trend.points):
            d = trend.points[i].direction
            c = float(np.clip(trend.points[i].confidence, 0.0, 1.0))

            if d == TrendDirection.DOWN:
                bonus = +0.30 * c
                note = f"Inverse fatigue + small recovery bonus (load trend DOWN, c={c:.2f})."
            elif d == TrendDirection.UP:
                bonus = -0.30 * c
                note = f"Inverse fatigue + small accumulation penalty (load trend UP, c={c:.2f})."
            elif d == TrendDirection.VOLATILE:
                bonus = -0.15 * c
                note = f"Inverse fatigue + volatility penalty (c={c:.2f})."

        readiness_raw.append(float((-float(f)) + bonus))
        expl.append(note)

    readiness_p = to_probability_series(readiness_raw, k=k, x0=x0)
    return readiness_raw, readiness_p, expl
