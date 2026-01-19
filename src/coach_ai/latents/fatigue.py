from __future__ import annotations

import numpy as np

from coach_ai.training_core.types import Issue, Severity
from coach_ai.trends.smoothing import ewma

from .probability import to_probability_series


def compute_fatigue(
    load_series: list[float | None],
    *,
    alpha: float = 0.35,
    emphasize_positive: bool = True,
    k: float = 1.2,
    x0: float = 0.0,
) -> tuple[list[float | None], list[float | None], list[Issue]]:
    """Compute Fatigue_t from a (preferably normalized) load series.

    Output:
    - fatigue_raw: EWMA of load (optionally positive-only)
    - fatigue_p: sigmoid-mapped probability in [0,1]
    - issues: uncertainty notes

    Assumptions:
    - Using normalized load (z-scores) makes parameters more portable per athlete.
    - emphasize_positive=True focuses fatigue on above-usual loading.
    """
    issues: list[Issue] = []

    if not (0 < alpha <= 1):
        raise ValueError("alpha must be in (0,1]")

    x: list[float | None] = []
    finite = 0
    for v in load_series:
        if v is None or not np.isfinite(v):
            x.append(None)
            continue
        vv = float(v)
        if emphasize_positive:
            vv = max(0.0, vv)
        x.append(vv)
        finite += 1

    if finite == 0:
        issues.append(
            Issue(
                severity=Severity.ERROR,
                code="fatigue_no_data",
                message="No finite load values available to infer fatigue.",
                field="load_series",
                value=None,
            )
        )
        raw = [None] * len(load_series)
        return raw, [None] * len(load_series), issues

    raw = ewma(x, alpha=alpha)
    fatigue_p = to_probability_series(raw, k=k, x0=x0)
    return raw, fatigue_p, issues
