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


def test_compute_streak_metrics_allows_weekly_tolerance() -> None:
    completed_days = {
        date(2026, 1, 6),
        date(2026, 1, 12),
        date(2026, 1, 18),
        date(2026, 1, 24),
    }
    current, longest = compute_streak_metrics(
        completed_days,
        today=date(2026, 1, 27),
        gap_tolerance_days=7,
    )

    assert current == 4
    assert longest == 4


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


def test_normalize_gamification_config_supports_emblems_and_relative_tiers() -> None:
    png_data = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
    config = normalize_gamification_config(
        {
            "streak_gap_tolerance_days": 9,
            "streak_tiers": [
                {
                    "threshold": 3,
                    "achievement": "Racha 3",
                    "medal": "Racha medal",
                    "emblem_png": png_data,
                }
            ],
            "planning_days_tiers": [{"threshold": 2, "achievement": "Plan 2", "medal": "Plan medal"}],
            "lift_tiers": {
                "back_squat": [{"threshold": 20, "achievement": "SQ", "medal": "SQ M"}],
                "bench_press": [{"threshold": 20, "achievement": "BP", "medal": "BP M"}],
                "deadlift": [{"threshold": 20, "achievement": "DL", "medal": "DL M"}],
            },
            "relative_strength_tiers": {
                "back_squat": [{"threshold": 1.0, "achievement": "RSQ", "medal": "RSQ M"}],
                "bench_press": [{"threshold": 0.8, "achievement": "RBP", "medal": "RBP M"}],
                "deadlift": [{"threshold": 1.4, "achievement": "RDL", "medal": "RDL M"}],
            },
            "trilogy_achievement": "Tri",
            "trilogy_medal": "Tri medal",
            "trilogy_emblem_png": png_data,
        }
    )

    assert config["streak_gap_tolerance_days"] == 9
    assert config["streak_tiers"][0]["emblem_png"] == png_data
    assert config["relative_strength_tiers"]["back_squat"][0]["achievement"] == "RSQ"
    assert config["trilogy_emblem_png"] == png_data


def test_build_reward_snapshot_unlocks_relative_strength_tiers() -> None:
    config = normalize_gamification_config(
        {
            "streak_tiers": [{"threshold": 2, "achievement": "Racha 2", "medal": "Racha M"}],
            "planning_days_tiers": [{"threshold": 2, "achievement": "Plan 2", "medal": "Plan M"}],
            "lift_tiers": {
                "back_squat": [{"threshold": 20, "achievement": "SQ20", "medal": "SQM"}],
                "bench_press": [{"threshold": 20, "achievement": "BP20", "medal": "BPM"}],
                "deadlift": [{"threshold": 20, "achievement": "DL20", "medal": "DLM"}],
            },
            "relative_strength_tiers": {
                "back_squat": [{"threshold": 1.0, "achievement": "RSQ1", "medal": "RSQM"}],
                "bench_press": [{"threshold": 0.6, "achievement": "RBP06", "medal": "RBPM"}],
                "deadlift": [{"threshold": 1.2, "achievement": "RDL12", "medal": "RDLM"}],
            },
            "trilogy_achievement": "Tri",
            "trilogy_medal": "Tri medal",
        }
    )

    achievements, medals, next_targets = _build_reward_snapshot(
        completed_days_total=5,
        current_streak_days=3,
        lift_prs_kg={
            "back_squat": 120.0,
            "bench_press": 70.0,
            "deadlift": 160.0,
        },
        body_weight_kg=80.0,
        config_payload=config,
    )

    assert "RSQ1" in achievements
    assert "RBP06" in achievements
    assert "RDL12" in achievements
    assert "RSQM" in medals
    assert all("peso corporal" not in target.lower() for target in next_targets)
