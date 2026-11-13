from datetime import datetime, timedelta

from coach_ai.muscle_insights import _build_group_series
from coach_ai.training_core.muscle_groups import SECONDARY_WEIGHT, muscle_shares
from coach_ai.training_core.schema import Session, StrengthExercise, StrengthSet


def test_primary_only_weighs_one():
    assert muscle_shares("Pecho") == {"Pecho": 1.0}


def test_secondary_default_weight_is_half():
    shares = muscle_shares("Pecho", [{"group": "Tríceps"}])
    assert shares == {"Pecho": 1.0, "Triceps": SECONDARY_WEIGHT}
    assert SECONDARY_WEIGHT == 0.5


def test_two_main_muscles_both_weigh_one():
    shares = muscle_shares("Pecho", [{"group": "Tríceps", "weight": 1.0}])
    assert shares == {"Pecho": 1.0, "Triceps": 1.0}


def test_extra_never_lowers_primary_and_weight_is_capped():
    shares = muscle_shares("Pecho", [{"group": "Pecho", "weight": 0.5}, {"group": "Hombros", "weight": 7}])
    assert shares == {"Pecho": 1.0, "Hombros": 1.0}


def test_invalid_extras_are_ignored():
    extras = [{"group": "xyz"}, {"group": "Hombros", "weight": 0}, {"group": "Hombros", "weight": "a"}, "mal"]
    assert muscle_shares("Pecho", extras) == {"Pecho": 1.0}


def test_unknown_primary_still_counts_extras():
    assert muscle_shares("???", [{"group": "Triceps"}]) == {"Triceps": 0.5}


def _session(name: str) -> Session:
    return Session(
        athlete_id="a",
        start_time=datetime(2026, 1, 1) + timedelta(days=0),
        duration_min=60,
        exercises=[StrengthExercise(name=name, sets=[StrengthSet(reps=10, load_kg=10)])],
    )


def test_group_series_counts_extra_muscles_by_weight():
    sessions = [_session("Fondos - Con Peso Corporal")]
    series = _build_group_series(
        sessions,
        {"fondos - con peso corporal": "Pecho"},
        {"fondos - con peso corporal": [{"group": "Tríceps", "weight": 0.5}]},
    )
    assert series["Pecho"][1] == [100.0]
    assert series["Triceps"][1] == [50.0]


def test_group_series_without_extras_is_unchanged():
    series = _build_group_series([_session("Press")], {"press": "Pecho"}, {})
    assert list(series) == ["Pecho"]
    assert series["Pecho"][1] == [100.0]


def test_back_is_split_in_four_groups():
    from coach_ai.training_core.muscle_groups import MUSCLE_GROUPS, canonicalize_muscle_group

    assert "Espalda" not in MUSCLE_GROUPS
    assert len(MUSCLE_GROUPS) == 15
    assert canonicalize_muscle_group("Dorsales") == "Dorsales"
    assert canonicalize_muscle_group("Espalda Alta") == "Espalda Alta"
    assert canonicalize_muscle_group("Trapecio") == "Trapecio"
    assert canonicalize_muscle_group("Lumbares") == "Lumbares"
    assert canonicalize_muscle_group("Espalda baja") == "Lumbares"
    # "Espalda" suelta (historial viejo) cae en Espalda Alta.
    assert canonicalize_muscle_group("Espalda") == "Espalda Alta"


def test_every_canonical_group_resolves_to_itself():
    from coach_ai.training_core.muscle_groups import MUSCLE_GROUPS, canonicalize_muscle_group

    for group in MUSCLE_GROUPS:
        assert canonicalize_muscle_group(group) == group


def test_legacy_espalda_in_session_uses_catalog_group():
    session = Session(
        athlete_id="a",
        start_time=datetime(2026, 1, 1),
        duration_min=60,
        exercises=[
            StrengthExercise(
                name="Jalón al Pecho - En Polea",
                meta={"group": "Espalda"},
                sets=[StrengthSet(reps=10, load_kg=10)],
            )
        ],
    )
    series = _build_group_series([session], {"jalón al pecho - en polea": "Dorsales"}, {})
    assert list(series) == ["Dorsales"]


def test_deadlift_counts_hamstrings_glutes_and_lower_back():
    extras = [{"group": "Glúteos", "weight": 1.0}, {"group": "Lumbares", "weight": 1.0}]
    assert muscle_shares("Femorales", extras) == {"Femorales": 1.0, "Gluteos": 1.0, "Lumbares": 1.0}
