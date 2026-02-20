from __future__ import annotations

from datetime import date

from app.profile.achievements import (
    _build_reward_snapshot,
    compute_streak_metrics,
    normalize_basic_lift_key,
    normalize_gamification_config,
)


def test_normalize_basic_lift_key_detects_expected_basics() -> None:
    assert normalize_basic_lift_key("Sentadilla posterior libre") == "back_squat"
    assert normalize_basic_lift_key("Press banca plano") == "bench_press"
    assert normalize_basic_lift_key("Peso muerto convencional") == "deadlift"
    assert normalize_basic_lift_key("Back squat") == "back_squat"
    assert normalize_basic_lift_key("Flat bench press") == "bench_press"


def test_normalize_basic_lift_key_excludes_variants() -> None:
    assert normalize_basic_lift_key("Sentadilla frontal") is None
    assert normalize_basic_lift_key("Press banca inclinado") is None
    assert normalize_basic_lift_key("Peso muerto rumano") is None


def test_compute_streak_metrics_active_and_longest() -> None:
    completed_days = {
        date(2026, 2, 15),
        date(2026, 2, 16),
        date(2026, 2, 17),
        date(2026, 2, 19),
        date(2026, 2, 20),
    }
    current, longest = compute_streak_metrics(completed_days, today=date(2026, 2, 20))

    assert current == 2
    assert longest == 3


def test_compute_streak_metrics_expires_when_inactive() -> None:
    completed_days = {
        date(2026, 1, 10),
        date(2026, 1, 11),
        date(2026, 1, 12),
    }
    current, longest = compute_streak_metrics(completed_days, today=date(2026, 2, 20))

    assert current == 0
    assert longest == 3


def test_build_reward_snapshot_reports_unlocked_and_next_targets() -> None:
    achievements, medals, next_targets = _build_reward_snapshot(
        completed_days_total=24,
        current_streak_days=8,
        lift_prs_kg={
            "back_squat": 95.0,
            "bench_press": 62.5,
            "deadlift": 130.0,
        },
    )

    assert "Racha semanal completa" in achievements
    assert "20 dias de planificacion completados" in achievements
    assert "Racha de Plata" in medals
    assert any("Sentadilla posterior libre" in item for item in achievements)
    assert any("objetivo 14 dias" in target for target in next_targets)
    assert any("objetivo 120 kg" in target for target in next_targets)


def test_build_reward_snapshot_supports_custom_titles_from_config() -> None:
    raw_config = {
        "streak_tiers": [{"threshold": 2, "achievement": "Racha Mini", "medal": "Mini Medal"}],
        "planning_days_tiers": [{"threshold": 3, "achievement": "Plan Mini", "medal": "Plan Medal"}],
        "lift_tiers": {
            "back_squat": [{"threshold": 20, "achievement": "SQ20", "medal": "SQ Medal"}],
            "bench_press": [{"threshold": 20, "achievement": "BP20", "medal": "BP Medal"}],
            "deadlift": [{"threshold": 20, "achievement": "DL20", "medal": "DL Medal"}],
        },
        "trilogy_achievement": "Tri Ready",
        "trilogy_medal": "Tri Medal",
    }
    config = normalize_gamification_config(raw_config)

    achievements, medals, _ = _build_reward_snapshot(
        completed_days_total=5,
        current_streak_days=3,
        lift_prs_kg={
            "back_squat": 25.0,
            "bench_press": 25.0,
            "deadlift": 25.0,
        },
        config_payload=config,
    )

    assert "Racha Mini" in achievements
    assert "Plan Mini" in achievements
    assert "SQ20" in achievements
    assert "Tri Ready" in achievements
    assert "Mini Medal" in medals
    assert "Tri Medal" in medals
