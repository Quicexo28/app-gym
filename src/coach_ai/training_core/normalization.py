from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np

from .types import Issue, Severity

Method = Literal["median_mad"]


@dataclass(frozen=True, slots=True)
class NormalizerParams:
    """Parameters for individual normalization.

    For method='median_mad':
    - center: median(x)
    - scale: MAD(x) * 1.4826 (robust std-like scale)
    """

    method: Method
    center: float
    scale: float
    n: int
    epsilon: float = 1e-8

    def to_dict(self) -> dict[str, Any]:
        return {
            "method": self.method,
            "center": self.center,
            "scale": self.scale,
            "n": self.n,
            "epsilon": self.epsilon,
        }


def _as_finite_array(values: Sequence[float | int | None]) -> np.ndarray:
    arr = np.array(values, dtype=float)
    arr = arr[np.isfinite(arr)]
    return arr


def fit_normalizer(
    values: Sequence[float | int | None],
    *,
    method: Method = "median_mad",
    min_n: int = 10,
    epsilon: float = 1e-8,
) -> tuple[NormalizerParams, list[Issue]]:
    """Fit an individual normalizer on a history of values.

    Returns (params, issues). Issues capture uncertainty about the fit:
    - too few data points
    - zero/near-zero scale (flat history)

    This function does not assume stationarity; it just summarizes history.
    Later phases can use rolling windows / EWMA.
    """

    issues: list[Issue] = []
    x = _as_finite_array(values)
    n = int(x.size)

    if n == 0:
        params = NormalizerParams(method=method, center=0.0, scale=1.0, n=0, epsilon=epsilon)
        issues.append(
            Issue(
                severity=Severity.ERROR,
                code="normalizer_no_data",
                message="No finite data points available to fit normalizer.",
                field=None,
                value=None,
            )
        )
        return params, issues

    if n < min_n:
        issues.append(
            Issue(
                severity=Severity.WARN,
                code="normalizer_low_sample",
                message=f"Only {n} points used to fit normalizer (< min_n={min_n}). Uncertainty is higher.",
                value=n,
                meta={"min_n": min_n},
            )
        )

    if method != "median_mad":
        raise ValueError(f"Unsupported method: {method}")

    center = float(np.median(x))
    mad = float(np.median(np.abs(x - center)))
    # 1.4826 makes MAD comparable to standard deviation under normality assumptions
    scale = mad * 1.4826

    if not math.isfinite(scale) or scale < epsilon:
        issues.append(
            Issue(
                severity=Severity.WARN,
                code="normalizer_flat_history",
                message=(
                    "History has near-zero variability; normalization scale was clamped. "
                    "Interpret z-scores cautiously."
                ),
                value=scale,
                meta={"epsilon": epsilon},
            )
        )
        scale = 1.0

    return NormalizerParams(
        method=method, center=center, scale=float(scale), n=n, epsilon=epsilon
    ), issues


def normalize_value(x: float | int | None, params: NormalizerParams) -> float | None:
    """Normalize a single value using fitted params.

    Returns None if x is None or non-finite.

    Note: epsilon is only applied when scale is too small to be numerically safe.
    """
    if x is None:
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v):
        return None

    denom = params.scale
    if (not math.isfinite(denom)) or abs(denom) < params.epsilon:
        denom = denom + params.epsilon

    return (v - params.center) / denom


def normalize_series(
    values: Sequence[float | int | None],
    params: NormalizerParams,
    *,
    clip_z: float | None = None,
) -> list[float | None]:
    """Normalize a series, optionally clipping z-scores.

    Clipping is useful to prevent extreme outliers from dominating downstream steps.
    It is *not* a correction; it is a bounded transform.
    """

    out: list[float | None] = []
    for x in values:
        z = normalize_value(x, params)
        if z is None:
            out.append(None)
            continue
        if clip_z is not None:
            z = float(np.clip(z, -clip_z, clip_z))
        out.append(float(z))
    return out
