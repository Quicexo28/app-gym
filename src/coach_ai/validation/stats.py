from __future__ import annotations

import math
from collections.abc import Iterable

import numpy as np


def _finite_pairs(
    x: Iterable[float | None], y: Iterable[float | None]
) -> tuple[np.ndarray, np.ndarray]:
    xx = []
    yy = []
    for a, b in zip(x, y, strict=False):
        if a is None or b is None:
            continue
        if not (np.isfinite(a) and np.isfinite(b)):
            continue
        xx.append(float(a))
        yy.append(float(b))
    return np.array(xx, dtype=float), np.array(yy, dtype=float)


def pearson_corr(x: list[float | None], y: list[float | None]) -> float | None:
    xx, yy = _finite_pairs(x, y)
    if xx.size < 3:
        return None
    vx = float(np.std(xx))
    vy = float(np.std(yy))
    if vx <= 1e-12 or vy <= 1e-12:
        return None
    return float(np.corrcoef(xx, yy)[0, 1])


def spearman_corr(x: list[float | None], y: list[float | None]) -> float | None:
    xx, yy = _finite_pairs(x, y)
    if xx.size < 3:
        return None

    # rank with average for ties (simple, good enough for validation)
    def rank(a: np.ndarray) -> np.ndarray:
        order = np.argsort(a)
        ranks = np.empty_like(order, dtype=float)
        ranks[order] = np.arange(1, a.size + 1, dtype=float)

        # average ties
        sorted_a = a[order]
        i = 0
        while i < sorted_a.size:
            j = i + 1
            while j < sorted_a.size and math.isclose(
                sorted_a[j], sorted_a[i], rel_tol=0.0, abs_tol=1e-12
            ):
                j += 1
            if j - i > 1:
                avg = float(np.mean(ranks[order[i:j]]))
                ranks[order[i:j]] = avg
            i = j
        return ranks

    rx = rank(xx)
    ry = rank(yy)
    return pearson_corr(rx.tolist(), ry.tolist())


def mean_abs_error(x: list[float | None], y: list[float | None]) -> float | None:
    xx, yy = _finite_pairs(x, y)
    if xx.size == 0:
        return None
    return float(np.mean(np.abs(xx - yy)))


def bucket_by_confidence(
    confidence: list[float | None],
    error: list[float | None],
    *,
    bins: int = 5,
) -> list[dict[str, float]]:
    """Return calibration-like buckets: mean_conf vs mean_error vs count."""
    pairs = []
    for c, e in zip(confidence, error, strict=False):
        if c is None or e is None:
            continue
        if not (np.isfinite(c) and np.isfinite(e)):
            continue
        pairs.append((float(c), float(e)))

    if not pairs:
        return []

    pairs.sort(key=lambda t: t[0])
    out: list[dict[str, float]] = []
    n = len(pairs)
    step = max(1, n // bins)

    for i in range(0, n, step):
        chunk = pairs[i : i + step]
        cc = [t[0] for t in chunk]
        ee = [t[1] for t in chunk]
        out.append(
            {
                "count": float(len(chunk)),
                "confidence_mean": float(np.mean(cc)),
                "error_mean": float(np.mean(ee)),
                "confidence_min": float(np.min(cc)),
                "confidence_max": float(np.max(cc)),
            }
        )
    return out
