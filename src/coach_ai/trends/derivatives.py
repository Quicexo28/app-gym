from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

import numpy as np

from coach_ai.training_core.types import Issue, Severity


def discrete_derivative_per_day(
    times: Sequence[datetime],
    values: Sequence[float | None],
) -> tuple[list[float | None], list[Issue]]:
    """Compute discrete derivative dv/dt per day.

    Returns (derivatives, issues).
    - derivative[i] corresponds to slope between i-1 and i (derivative[0]=None).
    - If time difference <= 0 or missing values, derivative is None and an issue may be emitted.
    """
    if len(times) != len(values):
        raise ValueError("times and values must have same length")

    out: list[float | None] = [None]
    issues: list[Issue] = []

    for i in range(1, len(times)):
        t0, t1 = times[i - 1], times[i]
        v0, v1 = values[i - 1], values[i]

        if v0 is None or v1 is None:
            out.append(None)
            continue
        if not (np.isfinite(v0) and np.isfinite(v1)):
            out.append(None)
            continue

        dt_days = (t1 - t0).total_seconds() / 86400.0
        if dt_days <= 0:
            out.append(None)
            issues.append(
                Issue(
                    severity=Severity.WARN,
                    code="non_increasing_time",
                    message="Non-increasing timestamps encountered; derivative undefined at this step.",
                    field=f"times[{i}]",
                    value=t1.isoformat(),
                    meta={"prev_time": t0.isoformat(), "dt_days": dt_days},
                )
            )
            continue

        out.append(float((float(v1) - float(v0)) / dt_days))

    return out, issues
