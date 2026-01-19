from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np

from .types import TrendDirection


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def classify_points(
    smooth: Sequence[float | None],
    derivative: Sequence[float | None],
    *,
    slope_threshold: float = 0.05,
    volatile_threshold: float = 0.20,
    lookback: int = 5,
) -> tuple[list[TrendDirection], list[float], list[str]]:
    """Classify trend per point.

    Assumptions (explicit):
    - Designed primarily for *normalized* series (z-scores).
      If used on raw metrics, tune thresholds accordingly.
    - slope_threshold: minimum |slope| (z/day) to call UP/DOWN
    - volatile_threshold: if recent slope sign flips and magnitude is high -> VOLATILE

    Returns: (direction, confidence, explanation) per point.
    """
    n = len(smooth)
    if len(derivative) != n:
        raise ValueError("smooth and derivative must have same length")

    dirs: list[TrendDirection] = []
    confs: list[float] = []
    expl: list[str] = []

    for i in range(n):
        s = smooth[i]
        d = derivative[i]

        if s is None or d is None or not np.isfinite(s) or not np.isfinite(d):
            dirs.append(TrendDirection.INSUFFICIENT)
            confs.append(0.0)
            expl.append("Insufficient data (missing smooth/derivative).")
            continue

        # recent derivative window
        j0 = max(0, i - lookback + 1)
        recent = [x for x in derivative[j0 : i + 1] if x is not None and np.isfinite(x)]
        if len(recent) < max(2, lookback // 2):
            dirs.append(TrendDirection.INSUFFICIENT)
            confs.append(0.15)
            expl.append("Too few recent derivative points to classify reliably.")
            continue

        mean_slope = float(np.mean(recent))
        abs_mean = abs(mean_slope)

        # sign flip count (volatility proxy)
        signs = []
        for x in recent:
            if abs(float(x)) < slope_threshold:
                continue
            signs.append(1 if float(x) > 0 else -1)
        flips = sum(1 for k in range(1, len(signs)) if signs[k] != signs[k - 1])

        if flips >= 2 and abs_mean >= volatile_threshold:
            dirs.append(TrendDirection.VOLATILE)
            # confidence: high that it's volatile when flips + magnitude exist
            c = 0.4 + 0.6 * _sigmoid(
                (abs_mean - volatile_threshold) / max(1e-6, volatile_threshold)
            )
            confs.append(float(min(1.0, c)))
            expl.append(
                f"Volatile: frequent sign flips (flips={flips}) with sizable slope (mean={mean_slope:.3f})."
            )
            continue

        if abs_mean < slope_threshold:
            dirs.append(TrendDirection.STABLE)
            # confidence higher when mean slope is near 0 and recent slopes are small
            c = 0.35 + 0.65 * _sigmoid((slope_threshold - abs_mean) / max(1e-6, slope_threshold))
            confs.append(float(min(1.0, c)))
            expl.append(
                f"Stable: mean slope below threshold (mean={mean_slope:.3f} < {slope_threshold})."
            )
            continue

        if mean_slope > 0:
            dirs.append(TrendDirection.UP)
            c = 0.2 + 0.8 * _sigmoid((abs_mean - slope_threshold) / max(1e-6, slope_threshold))
            confs.append(float(min(1.0, c)))
            expl.append(f"Up: positive mean slope above threshold (mean={mean_slope:.3f}).")
        else:
            dirs.append(TrendDirection.DOWN)
            c = 0.2 + 0.8 * _sigmoid((abs_mean - slope_threshold) / max(1e-6, slope_threshold))
            confs.append(float(min(1.0, c)))
            expl.append(f"Down: negative mean slope above threshold (mean={mean_slope:.3f}).")

    return dirs, confs, expl
