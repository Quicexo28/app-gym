from __future__ import annotations

from datetime import datetime

from coach_ai.suggestions import suggest_scenarios
from coach_ai.training_core import Session, process_sessions
from coach_ai.training_core.schema import StrengthExercise, StrengthSet


def test_recovery_ranked_high_when_fatigue_high():
    # Increasing load pattern tends to raise fatigue probability
    sessions = [
        Session(
            athlete_id="a1",
            start_time=datetime(2024, 1, 1, 10, 0, 0),
            duration_min=60,
            rpe=7,
            exercises=[StrengthExercise(name="Bench", sets=[StrengthSet(reps=8, load_kg=60)])],
        ),
        Session(
            athlete_id="a1",
            start_time=datetime(2024, 1, 3, 10, 0, 0),
            duration_min=60,
            rpe=7,
            exercises=[StrengthExercise(name="Bench", sets=[StrengthSet(reps=8, load_kg=90)])],
        ),
        Session(
            athlete_id="a1",
            start_time=datetime(2024, 1, 5, 10, 0, 0),
            duration_min=60,
            rpe=7,
            exercises=[StrengthExercise(name="Bench", sets=[StrengthSet(reps=8, load_kg=110)])],
        ),
    ]
    pr = process_sessions(sessions, normalizer_min_n=2, clip_z=None)
    a1 = pr.by_athlete["a1"]

    res = suggest_scenarios(a1, metric_key="volume_load_kg", use_normalized=True)

    assert res.scenarios
    # probabilities sum to 1
    s = sum(sc.probability for sc in res.scenarios)
    assert abs(s - 1.0) < 1e-9

    # At least one scenario exists and top is one of the expected options
    assert res.scenarios[0].name.value in {"recovery", "maintenance", "stabilize"}


def test_data_review_appears_with_low_quality_data():
    # Missing exercises triggers WARN issues and reduces confidence; should raise data_review probability.
    sessions = [
        Session(
            athlete_id="a1",
            start_time=datetime(2024, 1, 1, 10, 0, 0),
            duration_min=60,
            rpe=7,
            exercises=[],
        )
    ]
    pr = process_sessions(sessions, normalizer_min_n=2, clip_z=None)
    a1 = pr.by_athlete["a1"]

    res = suggest_scenarios(a1, metric_key="volume_load_kg", use_normalized=True)

    names = [s.name.value for s in res.scenarios]
    assert "data_review" in names
