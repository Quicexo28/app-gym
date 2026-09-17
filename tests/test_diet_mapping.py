from __future__ import annotations

from app.nutrition.mapping import (
    KJ_TO_KCAL_DIVISOR,
    MACRO_FIELD_MAP,
    MICRO_FIELD_MAP,
    UNIT_CONVERSION_FACTORS,
    map_off_nutriments_to_canonical,
    scale_micronutrients_per_100g,
    scale_per_100g,
)
from app.nutrition.micronutrients import MICRONUTRIENTS_BY_KEY


def test_unit_conversion_factors_are_the_single_source_of_truth() -> None:
    """El contrato exacto: gramos -> mg es x1000, gramos -> ug es x1_000_000."""
    assert UNIT_CONVERSION_FACTORS["direct"] == 1.0
    assert UNIT_CONVERSION_FACTORS["g_to_mg"] == 1_000.0
    assert UNIT_CONVERSION_FACTORS["g_to_ug"] == 1_000_000.0


def test_macro_direct_fields_pass_through_unchanged() -> None:
    nutriments = {
        "proteins_100g": 12.5,
        "carbohydrates_100g": 30.0,
        "sugars_100g": 5.0,
        "fiber_100g": 2.0,
        "fat_100g": 8.0,
        "saturated-fat_100g": 3.0,
        "trans-fat_100g": 0.1,
        "energy-kcal_100g": 250.0,
    }
    macros, _ = map_off_nutriments_to_canonical(nutriments)
    assert macros["energy_kcal"] == 250.0
    assert macros["protein_g"] == 12.5
    assert macros["carbs_g"] == 30.0
    assert macros["sugars_g"] == 5.0
    assert macros["fiber_g"] == 2.0
    assert macros["fat_g"] == 8.0
    assert macros["sat_fat_g"] == 3.0
    assert macros["trans_fat_g"] == 0.1


def test_sodium_converts_grams_to_milligrams() -> None:
    """EL bug de los mil: OFF entrega sodio en gramos, guardamos mg."""
    macros, _ = map_off_nutriments_to_canonical({"sodium_100g": 0.5})
    assert macros["sodium_mg"] == 500.0


def test_cholesterol_converts_grams_to_milligrams() -> None:
    macros, _ = map_off_nutriments_to_canonical({"cholesterol_100g": 0.02})
    assert macros["cholesterol_mg"] == 20.0


def test_vitamin_c_converts_grams_to_milligrams() -> None:
    _, micros = map_off_nutriments_to_canonical({"vitamin-c_100g": 0.012})
    assert micros["vitamin_c_mg"] == 12.0


def test_vitamin_a_converts_grams_to_micrograms() -> None:
    """El factor mas extremo: x1_000_000 para los micros en ug."""
    _, micros = map_off_nutriments_to_canonical({"vitamin-a_100g": 0.0000009})
    assert round(micros["vitamin_a_ug"], 4) == 0.9


def test_calcium_iron_and_other_mg_micros_convert_correctly() -> None:
    nutriments = {
        "calcium_100g": 0.12,
        "iron_100g": 0.0018,
        "magnesium_100g": 0.03,
        "phosphorus_100g": 0.1,
        "potassium_100g": 0.2,
        "zinc_100g": 0.001,
        "copper_100g": 0.00009,
        "manganese_100g": 0.00023,
        "vitamin-e_100g": 0.0015,
        "vitamin-b1_100g": 0.00012,
        "vitamin-b2_100g": 0.00013,
        "vitamin-pp_100g": 0.0016,
        "vitamin-b6_100g": 0.00017,
    }
    _, micros = map_off_nutriments_to_canonical(nutriments)
    assert micros["calcium_mg"] == 120.0
    assert round(micros["iron_mg"], 2) == 1.8
    assert micros["magnesium_mg"] == 30.0
    assert micros["phosphorus_mg"] == 100.0
    assert micros["potassium_mg"] == 200.0
    assert micros["zinc_mg"] == 1.0
    assert round(micros["copper_mg"], 3) == 0.09
    assert round(micros["manganese_mg"], 3) == 0.23
    assert round(micros["vitamin_e_mg"], 2) == 1.5
    assert round(micros["thiamin_mg"], 3) == 0.12
    assert round(micros["riboflavin_mg"], 3) == 0.13
    assert round(micros["niacin_mg"], 2) == 1.6
    assert round(micros["vitamin_b6_mg"], 3) == 0.17


def test_ug_micros_convert_correctly() -> None:
    nutriments = {
        "vitamin-d_100g": 0.000005,
        "vitamin-k_100g": 0.00003,
        "folate_100g": 0.0001,
        "vitamin-b12_100g": 0.0000006,
        "selenium_100g": 0.000014,
        "iodine_100g": 0.00004,
    }
    _, micros = map_off_nutriments_to_canonical(nutriments)
    assert round(micros["vitamin_d_ug"], 2) == 5.0
    assert round(micros["vitamin_k_ug"], 2) == 30.0
    assert round(micros["folate_ug"], 2) == 100.0
    assert round(micros["vitamin_b12_ug"], 2) == 0.6
    assert round(micros["selenium_ug"], 2) == 14.0
    assert round(micros["iodine_ug"], 2) == 40.0


def test_all_micro_field_map_targets_exist_in_canonical_registry() -> None:
    """Ningun mapeo apunta a una clave que no exista en el registro canonico."""
    for field in MICRO_FIELD_MAP.values():
        assert field.target in MICRONUTRIENTS_BY_KEY, field.target


def test_micro_field_map_covers_every_canonical_key_exactly_once() -> None:
    targets = [field.target for field in MICRO_FIELD_MAP.values()]
    assert len(targets) == len(set(targets)), "no debe haber targets duplicados"
    assert set(targets) == set(MICRONUTRIENTS_BY_KEY.keys())


def test_micro_field_map_conversion_matches_registry_unit() -> None:
    """Si el registro dice 'mg', el mapeo debe usar g_to_mg; si dice 'ug', g_to_ug."""
    for field in MICRO_FIELD_MAP.values():
        definition = MICRONUTRIENTS_BY_KEY[field.target]
        expected_conversion = "g_to_mg" if definition.unit == "mg" else "g_to_ug"
        assert field.conversion == expected_conversion, field.target


def test_macro_field_map_has_no_duplicate_targets() -> None:
    targets = [field.target for field in MACRO_FIELD_MAP.values()]
    assert len(targets) == len(set(targets))


def test_missing_fields_yield_none_not_zero() -> None:
    macros, micros = map_off_nutriments_to_canonical({})
    assert macros["protein_g"] is None
    assert macros["sodium_mg"] is None
    assert micros == {}


def test_missing_nutriments_dict_handled_gracefully() -> None:
    macros, micros = map_off_nutriments_to_canonical(None)
    assert macros["energy_kcal"] is None
    assert micros == {}


def test_energy_kj_fallback_when_kcal_missing() -> None:
    macros, _ = map_off_nutriments_to_canonical({"energy-kj_100g": 418.4})
    assert round(macros["energy_kcal"], 2) == round(418.4 / KJ_TO_KCAL_DIVISOR, 2)
    assert round(macros["energy_kcal"], 1) == 100.0


def test_energy_kcal_preferred_over_kj_when_both_present() -> None:
    macros, _ = map_off_nutriments_to_canonical(
        {"energy-kcal_100g": 250.0, "energy-kj_100g": 999.0}
    )
    assert macros["energy_kcal"] == 250.0


def test_non_numeric_values_are_ignored_gracefully() -> None:
    macros, micros = map_off_nutriments_to_canonical(
        {"proteins_100g": "n/a", "sodium_100g": None, "vitamin-c_100g": [1, 2]}
    )
    assert macros["protein_g"] is None
    assert macros["sodium_mg"] is None
    assert "vitamin_c_mg" not in micros


def test_boolean_values_are_not_treated_as_numeric() -> None:
    """bool es subclase de int en Python; no debe colarse como 1/0 valido."""
    macros, _ = map_off_nutriments_to_canonical({"proteins_100g": True})
    assert macros["protein_g"] is None


def test_string_numeric_values_are_parsed() -> None:
    macros, _ = map_off_nutriments_to_canonical({"proteins_100g": "12.5"})
    assert macros["protein_g"] == 12.5


def test_full_realistic_off_payload_conversion() -> None:
    """Un payload realista: macros directos + sodio + varios micros, todo junto."""
    nutriments = {
        "energy-kcal_100g": 155.0,
        "proteins_100g": 13.0,
        "carbohydrates_100g": 0.0,
        "fat_100g": 11.0,
        "saturated-fat_100g": 3.3,
        "sodium_100g": 0.14,
        "cholesterol_100g": 0.372,
        "calcium_100g": 0.056,
        "iron_100g": 0.0018,
        "vitamin-a_100g": 0.00016,
        "vitamin-d_100g": 0.0000019,
    }
    macros, micros = map_off_nutriments_to_canonical(nutriments)
    assert macros["energy_kcal"] == 155.0
    assert macros["protein_g"] == 13.0
    assert macros["sodium_mg"] == 140.0
    assert macros["cholesterol_mg"] == 372.0
    assert micros["calcium_mg"] == 56.0
    assert round(micros["iron_mg"], 2) == 1.8
    assert round(micros["vitamin_a_ug"], 1) == 160.0
    assert round(micros["vitamin_d_ug"], 2) == 1.9


def test_scale_per_100g_halves_for_half_portion() -> None:
    assert scale_per_100g(200.0, 50.0) == 100.0


def test_scale_per_100g_full_100g_returns_same_value() -> None:
    assert scale_per_100g(155.0, 100.0) == 155.0


def test_scale_per_100g_scales_up_for_larger_portion() -> None:
    assert scale_per_100g(50.0, 250.0) == 125.0


def test_scale_per_100g_zero_quantity_returns_zero() -> None:
    assert scale_per_100g(100.0, 0.0) == 0.0


def test_scale_per_100g_none_value_stays_none() -> None:
    assert scale_per_100g(None, 150.0) is None


def test_scale_micronutrients_per_100g_batch_scaling() -> None:
    scaled = scale_micronutrients_per_100g({"vitamin_c_mg": 12.0, "iron_mg": 2.0}, 50.0)
    assert scaled == {"vitamin_c_mg": 6.0, "iron_mg": 1.0}


def test_scale_micronutrients_per_100g_empty_or_none_returns_empty_dict() -> None:
    assert scale_micronutrients_per_100g(None, 100.0) == {}
    assert scale_micronutrients_per_100g({}, 100.0) == {}
