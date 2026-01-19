from __future__ import annotations

from coach_ai.trends.classification import classify_points
from coach_ai.trends.types import TrendDirection


def test_classify_up_down_stable():
    smooth = [0.0, 0.1, 0.2, 0.3]
    deriv = [None, 0.1, 0.1, 0.1]
    dirs, confs, _ = classify_points(smooth, deriv, slope_threshold=0.05, lookback=3)
    assert dirs[0] == TrendDirection.INSUFFICIENT
    assert dirs[-1] == TrendDirection.UP
    assert confs[-1] > 0.2

    smooth2 = [0.0, -0.1, -0.2, -0.3]
    deriv2 = [None, -0.1, -0.1, -0.1]
    dirs2, _, _ = classify_points(smooth2, deriv2, slope_threshold=0.05, lookback=3)
    assert dirs2[-1] == TrendDirection.DOWN


def test_classify_stable_when_slope_small():
    smooth = [0.0, 0.01, 0.02, 0.01]
    deriv = [None, 0.01, 0.01, -0.01]
    dirs, _, _ = classify_points(smooth, deriv, slope_threshold=0.05, lookback=3)
    assert dirs[-1] == TrendDirection.STABLE
