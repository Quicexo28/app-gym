from __future__ import annotations

from datetime import datetime, timedelta

from coach_ai.trends.derivatives import discrete_derivative_per_day


def test_discrete_derivative_per_day_basic():
    t0 = datetime(2024, 1, 1, 0, 0, 0)
    times = [t0, t0 + timedelta(days=2), t0 + timedelta(days=3)]
    values = [0.0, 2.0, 5.0]  # smooth values

    d, issues = discrete_derivative_per_day(times, values)
    assert d[0] is None
    assert d[1] == 1.0  # (2-0)/2
    assert d[2] == 3.0  # (5-2)/1
    assert issues == []


def test_derivative_handles_missing():
    t0 = datetime(2024, 1, 1, 0, 0, 0)
    times = [t0, t0 + timedelta(days=1)]
    values = [None, 2.0]
    d, issues = discrete_derivative_per_day(times, values)
    assert d == [None, None]
    assert issues == []
