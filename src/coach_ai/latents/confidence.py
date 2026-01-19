from __future__ import annotations

import numpy as np

from coach_ai.training_core.types import Issue, Severity


def issue_penalty(issues: list[Issue]) -> float:
    """Map issues to a penalty in [0,1].

    Heuristic:
    - ERROR strongly reduces confidence (data likely unreliable)
    - WARN moderately reduces confidence (uncertainty)
    - INFO minimal effect
    """
    p = 0.0
    for i in issues:
        if i.severity == Severity.ERROR:
            p += 0.35
        elif i.severity == Severity.WARN:
            p += 0.12
        else:
            p += 0.03
    return float(np.clip(p, 0.0, 1.0))


def combine_confidence(
    *,
    coverage: float,
    trend_confidence: float | None,
    issues: list[Issue],
) -> float:
    """Combine evidence into a 0..1 confidence score."""
    cov = float(np.clip(coverage, 0.0, 1.0))
    tc = 0.5 if trend_confidence is None else float(np.clip(trend_confidence, 0.0, 1.0))
    pen = issue_penalty(issues)

    # Base: coverage and trend confidence, reduced by penalties.
    base = 0.15 + 0.85 * (0.65 * cov + 0.35 * tc)
    return float(np.clip(base * (1.0 - pen), 0.0, 1.0))
