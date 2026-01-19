from __future__ import annotations

from coach_ai.trends.smoothing import ewma, rolling_mean


def test_rolling_mean_ignores_none():
    x = [1.0, None, 3.0, 5.0]
    r = rolling_mean(x, window=2, min_periods=1)
    assert r == [1.0, 1.0, 3.0, 4.0]


def test_ewma_carries_forward_on_none():
    x = [1.0, None, 3.0]
    r = ewma(x, alpha=0.5)
    assert r[0] == 1.0
    assert r[1] == 1.0
    assert r[2] == 2.0
