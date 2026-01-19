from __future__ import annotations

import math

import numpy as np


def sigmoid(x: float, *, k: float = 1.0, x0: float = 0.0) -> float:
    """Logistic mapping to (0,1).

    p = 1 / (1 + exp(-k*(x-x0)))

    - k controls steepness
    - x0 is the midpoint where p=0.5
    """
    z = -k * (x - x0)
    # numerical safety
    z = float(np.clip(z, -60.0, 60.0))
    return 1.0 / (1.0 + math.exp(z))


def to_probability_series(
    values: list[float | None],
    *,
    k: float = 1.0,
    x0: float = 0.0,
) -> list[float | None]:
    out: list[float | None] = []
    for v in values:
        if v is None:
            out.append(None)
            continue
        out.append(float(sigmoid(float(v), k=k, x0=x0)))
    return out
