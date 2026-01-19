from __future__ import annotations

from datetime import datetime

from coach_ai.latents import compute_latent_states
from coach_ai.training_core import Session, process_sessions
from coach_ai.training_core.schema import StrengthExercise, StrengthSet


def test_latents_increasing_load_increases_fatigue_and_reduces_readiness():
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

    pr = process_sessions(sessions, normalizer_min_n=2, clip_z=None)
    a1 = pr.by_athlete["a1"]

    lr = compute_latent_states(
        a1, metric_key="volume_load_kg", use_normalized=True, fatigue_alpha=0.8
    )

    f0 = lr.points[0].states["fatigue"]
    fN = lr.points[-1].states["fatigue"]
    r0 = lr.points[0].states["readiness"]
    rN = lr.points[-1].states["readiness"]

    assert f0 is not None and fN is not None and fN >= f0
    assert r0 is not None and rN is not None and rN <= r0


def test_latents_constant_load_can_raise_plateau_probability():
    sessions = [
        Session(
            athlete_id="a1",
            start_time=datetime(2024, 1, 1, 10, 0, 0),
            duration_min=60,
            rpe=7,
            exercises=[
                StrengthExercise(name="Bench", sets=[StrengthSet(reps=8, load_kg=80)])
            ],  # 640
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
                StrengthExercise(name="Bench", sets=[StrengthSet(reps=8, load_kg=80)])
            ],  # 640
        ),
    ]

    pr = process_sessions(sessions, normalizer_min_n=2, clip_z=None)
    a1 = pr.by_athlete["a1"]

    lr = compute_latent_states(
        a1, metric_key="volume_load_kg", use_normalized=True, plateau_lookback=3
    )

    p_last = lr.points[-1].states["plateau"]
    assert p_last is not None
    assert 0.0 <= p_last <= 1.0
