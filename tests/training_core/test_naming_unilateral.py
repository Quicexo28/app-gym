from coach_ai.muscle_insights import _exercise_shares
from coach_ai.training_core.naming import normalize_exercise_name, strip_unilateral
from coach_ai.training_core.schema import StrengthExercise


def test_strip_unilateral_both_formats() -> None:
    assert strip_unilateral("prensa de piernas - en máquina - unilateral") == "prensa de piernas - en máquina"
    assert strip_unilateral("curl femoral - en máquina - sentado unilateral") == (
        "curl femoral - en máquina - sentado"
    )
    assert strip_unilateral("sentadilla - en smith") == "sentadilla - en smith"


def test_unilateral_keeps_distinct_name_for_history() -> None:
    assert normalize_exercise_name("Prensa - Unilateral") != normalize_exercise_name("Prensa")


def test_unilateral_session_exercise_uses_bilateral_catalog_group() -> None:
    exercise = StrengthExercise(name="Prensa de Piernas - En Máquina - Unilateral", sets=[])
    shares = _exercise_shares(
        exercise,
        {"prensa de piernas - en máquina": "Cuádriceps"},
        {},
    )
    assert shares == _exercise_shares(
        StrengthExercise(name="Prensa de Piernas - En Máquina", sets=[]),
        {"prensa de piernas - en máquina": "Cuádriceps"},
        {},
    )
    assert shares
