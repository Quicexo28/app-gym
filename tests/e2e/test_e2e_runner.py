from __future__ import annotations

import json
from datetime import datetime

from coach_ai.e2e import EndToEndConfig, run_end_to_end
from coach_ai.training_core import Session
from coach_ai.training_core.schema import StrengthExercise, StrengthSet


def test_e2e_runner_creates_suggestions_and_log(tmp_path):
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

    log_path = tmp_path / "decisions.jsonl"
    cfg = EndToEndConfig(
        athlete_id="a1",
        metric_key="volume_load_kg",
        use_normalized=True,
        normalizer_min_n=2,
        clip_z=None,
        log_enabled=True,
        log_path=str(log_path),
    )

    res = run_end_to_end(sessions, config=cfg)

    assert res.suggestions is not None
    assert res.suggestions.scenarios
    assert abs(sum(s.probability for s in res.suggestions.scenarios) - 1.0) < 1e-9

    # Log exists and is valid JSONL
    text = log_path.read_text(encoding="utf-8").strip().splitlines()
    assert len(text) == 1
    obj = json.loads(text[0])
    assert obj["run_id"] == res.run_id
    assert obj["athlete_id"] == "a1"
    assert obj["metric_key"] == "volume_load_kg"


def test_e2e_runner_handles_missing_athlete_gracefully(tmp_path):
    sessions = [
        Session(
            athlete_id="aX",
            start_time=datetime(2024, 1, 1, 10, 0, 0),
            duration_min=60,
            rpe=7,
            exercises=[StrengthExercise(name="Bench", sets=[StrengthSet(reps=8, load_kg=80)])],
        )
    ]

    cfg = EndToEndConfig(
        athlete_id="a1",  # not present
        metric_key="volume_load_kg",
        use_normalized=True,
        normalizer_min_n=2,
        clip_z=None,
        log_enabled=False,
        log_path=str(tmp_path / "decisions.jsonl"),
    )

    res = run_end_to_end(sessions, config=cfg)
    assert res.athlete_series is None
    assert any(i.code == "athlete_not_found" for i in res.issues)
