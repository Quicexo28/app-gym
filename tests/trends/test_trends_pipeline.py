from __future__ import annotations

from datetime import datetime

from coach_ai.training_core import Session, process_sessions
from coach_ai.training_core.schema import StrengthExercise, StrengthSet
from coach_ai.trends import compute_trends
from coach_ai.trends.types import TrendDirection


def test_compute_trends_on_normalized_volume():
    sessions = [
        Session(
            athlete_id="a1",
            start_time=datetime(2024, 1, 1, 10, 0, 0),
            duration_min=60,
            rpe=7,
            exercises=[
                StrengthExercise(name="Bench", sets=[StrengthSet(reps=8, load_kg=60)])
            ],  # 480
        ),
        Session(
            athlete_id="a1",
            start_time=datetime(2024, 1, 3, 10, 0, 0),
            duration_min=60,
            rpe=7,
            exercises=[
                StrengthExercise(name="Bench", sets=[StrengthSet(reps=8, load_kg=80)])
            ],  # 640
        ),
        Session(
            athlete_id="a1",
            start_time=datetime(2024, 1, 5, 10, 0, 0),
            duration_min=60,
            rpe=7,
            exercises=[
                StrengthExercise(name="Bench", sets=[StrengthSet(reps=8, load_kg=90)])
            ],  # 720
        ),
    ]

    res = process_sessions(sessions, normalizer_min_n=2, clip_z=None)
    a1 = res.by_athlete["a1"]

    tr = compute_trends(
        a1,
        metric_key="volume_load_kg",
        use_normalized=True,
        smooth_method="ewma",
        ewma_alpha=0.6,
        slope_threshold=0.01,
        lookback=2,
    )

    assert tr.athlete_id == "a1"
    assert tr.metric_key == "volume_load_kg"
    assert len(tr.points) == 3

    # last point should generally be UP in this synthetic increasing series
    assert tr.points[-1].direction in {TrendDirection.UP, TrendDirection.STABLE}
    assert 0.0 <= tr.points[-1].confidence <= 1.0
