from __future__ import annotations

from datetime import UTC, datetime, timedelta

from coach_ai.insights import build_insights
from coach_ai.training_core.schema import Session, StrengthExercise, StrengthSet

NOW = datetime(2026, 3, 1, 12, 0, tzinfo=UTC)


def session_with(day_offset: int, loads: list[float], *, name: str = "Press banca") -> Session:
    when = NOW - timedelta(days=day_offset)
    return Session(
        athlete_id="user_1",
        start_time=when,
        duration_min=60,
        exercises=[
            StrengthExercise(
                name=name,
                sets=[StrengthSet(reps=5, load_kg=load) for load in loads],
                meta={"group": "Pecho"},
            )
        ],
    )


def test_without_sessions_it_says_nothing():
    insights = build_insights([], athlete_id="user_1", now=NOW)
    assert insights.exercises == []
    assert insights.predictions == []


def test_abstains_with_short_history():
    sessions = [session_with(day, [60.0]) for day in (20, 15, 10)]
    insights = build_insights(sessions, athlete_id="user_1", now=NOW)

    assert insights.predictions == []
    assert insights.abstained == ["Press banca"]


def test_point_estimate_is_the_last_top_set():
    sessions = [session_with(day, [50.0, 60.0 + day]) for day in (30, 25, 20, 15, 10, 5)]
    insights = build_insights(sessions, athlete_id="user_1", now=NOW)

    prediction = insights.predictions[0]
    assert prediction.point_kg == 65.0  # la ultima sesion (day=5) topo en 65
    assert prediction.low_kg < prediction.point_kg < prediction.high_kg
    assert prediction.coverage == 0.90


def test_interval_never_narrower_than_a_small_plate():
    sessions = [session_with(day, [60.0]) for day in (30, 25, 20, 15, 10, 5)]
    prediction = build_insights(sessions, athlete_id="user_1", now=NOW).predictions[0]

    assert prediction.high_kg - prediction.point_kg >= 2.5


def test_personal_record_is_detected_with_its_rule():
    sessions = [session_with(day, [load]) for day, load in ((30, 60.0), (20, 62.5), (10, 65.0))]
    events = build_insights(sessions, athlete_id="user_1", now=NOW).events

    record = next(e for e in events if e.kind == "personal_record")
    assert "65" in record.detail
    assert record.rule  # la regla viaja con el evento, es auditable


def test_stall_needs_five_sessions_without_beating_the_best():
    loads = [100.0, 102.5, 105.0, 104.0, 103.0, 102.0, 101.0, 100.0, 99.0, 98.0]
    sessions = [session_with(60 - index * 5, [load]) for index, load in enumerate(loads)]
    events = build_insights(sessions, athlete_id="user_1", now=NOW).events

    stall = next(e for e in events if e.kind == "stall")
    assert "105" in stall.detail


def test_dropped_exercise_after_45_days():
    sessions = [session_with(day, [60.0]) for day in (120, 110, 100, 90, 80, 70)]
    events = build_insights(sessions, athlete_id="user_1", now=NOW).events

    assert any(e.kind == "dropped_exercise" for e in events)


def test_weekly_sets_by_group_uses_the_last_four_weeks():
    sessions = [session_with(day, [60.0, 60.0]) for day in (5, 12, 19, 26)]
    insights = build_insights(sessions, athlete_id="user_1", now=NOW)

    assert insights.sessions_last_4w == 4
    assert insights.weekly_sets_by_group == {"Pecho": 2.0}  # 8 series en 4 semanas
