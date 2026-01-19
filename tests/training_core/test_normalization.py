from __future__ import annotations

import math

import pytest

from coach_ai.training_core import fit_normalizer, normalize_series, normalize_value


def test_fit_normalizer_median_mad_basic():
    values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    params, issues = fit_normalizer(values, min_n=5)
    assert params.method == "median_mad"
    assert params.n == 10
    assert issues == []  # enough data, non-flat

    # For 1..10, median is 5.5
    assert params.center == 5.5
    # MAD around 5.5 is median(|x-5.5|) => 2.5 ; scale = 2.5*1.4826
    assert math.isclose(params.scale, 2.5 * 1.4826, rel_tol=1e-9)


def test_normalize_value_and_series():
    values = [10, 10, 10, 10, 10, 10]
    params, issues = fit_normalizer(values, min_n=3)
    # flat history -> WARN and scale clamped to 1.0
    assert any(i.code == "normalizer_flat_history" for i in issues)

    assert normalize_value(11, params) == pytest.approx(1.0, abs=1e-12)
    zs = normalize_series([None, 10, 11], params, clip_z=2.0)
    assert zs[0] is None
    assert zs[1] == 0.0
    assert zs[2] == 1.0
