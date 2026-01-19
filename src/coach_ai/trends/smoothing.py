from __future__ import annotations

from collections.abc import Sequence

import numpy as np


def rolling_mean(
    values: Sequence[float | None],
    *,
    window: int,
    min_periods: int = 1,
) -> list[float | None]:
    """Count-based rolling mean that ignores None.

    - window: number of last points to include
    - min_periods: minimum number of non-missing points required to output a mean
    """
    if window <= 0:
        raise ValueError("window must be > 0")
    if min_periods <= 0:
        raise ValueError("min_periods must be > 0")

    out: list[float | None] = []

    for i, _x in enumerate(values):
        # maintain a sliding window buffer of the last `window` raw values (including None),
        # but compute mean only on non-missing.
        start = max(0, i - window + 1)
        w = values[start : i + 1]
        finite = [float(v) for v in w if v is not None and np.isfinite(v)]
        if len(finite) < min_periods:
            out.append(None)
        else:
            out.append(float(np.mean(finite)))
    return out


def ewma(
    values: Sequence[float | None],
    *,
    alpha: float,
) -> list[float | None]:
    """Exponentially weighted moving average (None-safe).

    - alpha in (0,1]: higher alpha = more reactive
    - If x is None, EWMA carries forward the previous value (keeps smoothing continuity),
      but remains None until the first finite value appears.
    """
    if not (0 < alpha <= 1):
        raise ValueError("alpha must be in (0, 1]")

    out: list[float | None] = []
    s: float | None = None

    for x in values:
        if x is None or not np.isfinite(x):
            out.append(s)
            continue
        xv = float(x)
        s = xv if s is None else (alpha * xv + (1 - alpha) * s)
        out.append(float(s))
    return out
