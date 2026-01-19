from __future__ import annotations

from coach_ai.latents.probability import sigmoid


def test_sigmoid_bounds():
    assert 0.0 <= sigmoid(-1000) < 0.01
    assert 0.99 < sigmoid(1000) <= 1.0
    assert abs(sigmoid(0.0) - 0.5) < 1e-6
