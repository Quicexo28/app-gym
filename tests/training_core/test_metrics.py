from __future__ import annotations

from datetime import UTC, datetime

from coach_ai.training_core import Session, compute_session_metrics


def test_compute_srpe_load():
    s = Session(
        athlete_id="a1",
        start_time=datetime(2024, 1, 1, 10, 0, tzinfo=UTC),
        duration_min=60,
        rpe=7,
        modality="run",
        external_load={"distance_km": 10.0},
    )
    m = compute_session_metrics(s)
    assert m.srpe_load == 420
    assert m.external_load_total == 10.0
    assert m.external_load["distance_km"] == 10.0


def test_metrics_handle_missing_rpe():
    s = Session(
        athlete_id="a1",
        start_time=datetime(2024, 1, 1, 10, 0, tzinfo=UTC),
        duration_min=30,
        rpe=None,
        modality="bike",
        external_load={},
    )
    m = compute_session_metrics(s)
    assert m.srpe_load is None
    assert m.duration_min == 30
