from __future__ import annotations

from app.nutrition.micronutrients import (
    MICRONUTRIENT_KEYS,
    MICRONUTRIENTS,
    MICRONUTRIENTS_BY_KEY,
    get_micronutrient,
)

_EXPECTED_KEYS = {
    "vitamin_a_ug",
    "vitamin_c_mg",
    "vitamin_d_ug",
    "vitamin_e_mg",
    "vitamin_k_ug",
    "thiamin_mg",
    "riboflavin_mg",
    "niacin_mg",
    "vitamin_b6_mg",
    "folate_ug",
    "vitamin_b12_ug",
    "calcium_mg",
    "iron_mg",
    "magnesium_mg",
    "phosphorus_mg",
    "potassium_mg",
    "zinc_mg",
    "copper_mg",
    "manganese_mg",
    "selenium_ug",
    "iodine_ug",
}


def test_registry_has_exactly_the_21_keys_from_the_spec() -> None:
    assert MICRONUTRIENT_KEYS == _EXPECTED_KEYS
    assert len(MICRONUTRIENTS) == 21


def test_registry_keys_are_unique() -> None:
    keys = [item.key for item in MICRONUTRIENTS]
    assert len(keys) == len(set(keys))


def test_registry_units_are_only_mg_or_ug() -> None:
    for item in MICRONUTRIENTS:
        assert item.unit in {"mg", "ug"}
        assert item.key.endswith(f"_{item.unit}")


def test_registry_labels_are_non_empty_and_have_no_stray_underscores() -> None:
    for item in MICRONUTRIENTS:
        assert item.label
        assert "_" not in item.label


def test_registry_rda_values_are_positive() -> None:
    for item in MICRONUTRIENTS:
        assert item.rda > 0


def test_registry_upper_limit_when_present_is_positive() -> None:
    # Nota: el UL de magnesio (350 mg) es menor que su RDA (420 mg) a
    # proposito - ese limite aplica solo a magnesio suplementario, no al de
    # los alimentos, que el cuerpo regula por absorcion. No es un error de
    # tipeo del registro.
    for item in MICRONUTRIENTS:
        if item.upper_limit is not None:
            assert item.upper_limit > 0


def test_get_micronutrient_returns_definition_for_known_key() -> None:
    definition = get_micronutrient("vitamin_c_mg")
    assert definition is not None
    assert definition.unit == "mg"
    assert definition.rda == 90.0


def test_get_micronutrient_returns_none_for_unknown_key() -> None:
    assert get_micronutrient("not_a_real_key") is None


def test_micronutrients_by_key_is_consistent_with_the_tuple() -> None:
    assert set(MICRONUTRIENTS_BY_KEY.keys()) == {item.key for item in MICRONUTRIENTS}
    for key, definition in MICRONUTRIENTS_BY_KEY.items():
        assert definition.key == key
