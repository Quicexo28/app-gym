from __future__ import annotations

import math
from collections.abc import Iterable

import numpy as np

from coach_ai.training_core.types import Issue, Severity


def softmax(scores: list[float]) -> list[float]:
    if not scores:
        return []
    m = float(np.max(scores))
    exps = [math.exp(float(s) - m) for s in scores]
    z = float(sum(exps))
    if z <= 0:
        return [1.0 / len(scores)] * len(scores)
    return [float(e / z) for e in exps]


def issue_penalty(issues: Iterable[Issue]) -> float:
    """Penalty in [0,1] for data quality / uncertainty."""
    p = 0.0
    for i in issues:
        if i.severity == Severity.ERROR:
            p += 0.35
        elif i.severity == Severity.WARN:
            p += 0.12
        else:
            p += 0.03
    return float(np.clip(p, 0.0, 1.0))


def clamp01(x: float) -> float:
    return float(np.clip(x, 0.0, 1.0))
