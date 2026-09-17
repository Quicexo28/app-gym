from __future__ import annotations

import pytest

from app.nutrition.units import (
    MAX_QUANTITY_G,
    QUANTITY_UNITS,
    QUANTITY_UNITS_BY_KEY,
    QuantityUnitError,
    default_unit_for_basis,
    resolve_quantity_grams,
)


def test_grams_pass_through_unchanged() -> None:
    assert resolve_quantity_grams(150, "g") == 150.0


@pytest.mark.parametrize(
    ("value", "unit", "expected"),
    [
        (1, "kg", 1000.0),
        (1, "oz", 28.3495),
        (2, "lb", 907.1847),
        (1.5, "l", 1500.0),
        (1, "taza", 240.0),
        (3, "cucharada", 45.0),
        (2, "cucharadita", 10.0),
        (1, "fl_oz", 29.5735),
    ],
)
def test_converts_each_unit_to_the_base_unit(value: float, unit: str, expected: float) -> None:
    assert resolve_quantity_grams(value, unit) == pytest.approx(expected, abs=0.001)


def test_servings_use_the_serving_size_of_the_food() -> None:
    assert resolve_quantity_grams(2, "porcion", serving_size_g=45) == 90.0


@pytest.mark.parametrize("serving_size_g", [None, 0, -10])
def test_servings_rejected_when_the_food_has_no_serving_size(serving_size_g: float | None) -> None:
    with pytest.raises(QuantityUnitError):
        resolve_quantity_grams(2, "porcion", serving_size_g=serving_size_g)


def test_unknown_unit_is_rejected() -> None:
    with pytest.raises(QuantityUnitError):
        resolve_quantity_grams(1, "pizca")


@pytest.mark.parametrize("value", [0, -5])
def test_non_positive_quantities_are_rejected(value: float) -> None:
    with pytest.raises(QuantityUnitError):
        resolve_quantity_grams(value, "g")


def test_upper_bound_applies_after_converting_not_before() -> None:
    # 6 escrito no dice nada; 6 kg si pasa el tope.
    assert resolve_quantity_grams(5, "kg") == MAX_QUANTITY_G
    with pytest.raises(QuantityUnitError):
        resolve_quantity_grams(6, "kg")


def test_default_unit_follows_the_basis_of_the_food() -> None:
    assert default_unit_for_basis("per_100ml") == "ml"
    assert default_unit_for_basis("per_100g") == "g"
    assert default_unit_for_basis(None) == "g"


def test_catalog_has_no_duplicate_keys() -> None:
    assert len(QUANTITY_UNITS_BY_KEY) == len(QUANTITY_UNITS)
