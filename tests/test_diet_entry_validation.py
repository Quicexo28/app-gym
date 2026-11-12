from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

import pytest
from diet_support import (
    FakeDietDb,
    _make_food,
    _make_meal_entry,
    _make_user,
)
from fastapi import HTTPException, Response
from pydantic import ValidationError

from app.api.v1.endpoints import diet
from app.auth.athlete_access import personal_athlete_id_for_user
from app.db.models import FoodProduct, MealEntry

# ---------------------------------------------------------------------------
# Validacion Pydantic
# ---------------------------------------------------------------------------


def test_meal_entry_requires_food_product_id_or_food_name() -> None:
    with pytest.raises(ValidationError):
        diet.MealEntryCreateRequest(athlete_id="athlete_1", meal_slot="almuerzo", quantity_g=100.0)


def test_meal_entry_accepts_food_product_id_without_name() -> None:
    payload = diet.MealEntryCreateRequest(
        athlete_id="athlete_1",
        meal_slot="almuerzo",
        quantity_g=100.0,
        food_product_id=str(uuid.uuid4()),
    )
    assert payload.food_name is None


def test_meal_entry_accepts_food_name_without_product_id() -> None:
    payload = diet.MealEntryCreateRequest(
        athlete_id="athlete_1", meal_slot="snack", quantity_g=30.0, food_name="Manzana"
    )
    assert payload.food_product_id is None


def test_meal_entry_meal_slot_restricted_to_known_values() -> None:
    with pytest.raises(ValidationError):
        diet.MealEntryCreateRequest(
            athlete_id="athlete_1", meal_slot="brunch", quantity_g=100.0, food_name="Arroz"
        )


def test_meal_entry_quantity_must_be_positive() -> None:
    with pytest.raises(ValidationError):
        diet.MealEntryCreateRequest(
            athlete_id="athlete_1", meal_slot="almuerzo", quantity_g=0, food_name="Arroz"
        )


def test_meal_entry_quantity_has_an_upper_bound() -> None:
    with pytest.raises(ValidationError):
        diet.MealEntryCreateRequest(
            athlete_id="athlete_1", meal_slot="almuerzo", quantity_g=999999, food_name="Arroz"
        )


def test_meal_entry_requires_some_quantity() -> None:
    with pytest.raises(ValidationError):
        diet.MealEntryCreateRequest(athlete_id="athlete_1", meal_slot="almuerzo", food_name="Arroz")


def test_meal_entry_rejects_a_unit_without_a_value_and_viceversa() -> None:
    with pytest.raises(ValidationError):
        diet.MealEntryCreateRequest(
            athlete_id="athlete_1", meal_slot="almuerzo", food_name="Arroz", quantity_unit="taza"
        )
    with pytest.raises(ValidationError):
        diet.MealEntryCreateRequest(
            athlete_id="athlete_1", meal_slot="almuerzo", food_name="Arroz", quantity_value=2
        )


def test_meal_entry_rejects_unknown_units() -> None:
    with pytest.raises(ValidationError):
        diet.MealEntryCreateRequest(
            athlete_id="athlete_1",
            meal_slot="almuerzo",
            food_name="Arroz",
            quantity_value=1,
            quantity_unit="pizca",
        )


# ---------------------------------------------------------------------------
# Cantidad en distintas unidades (doc modulo-dieta.md #2.2)
# ---------------------------------------------------------------------------


def test_resolve_quantity_converts_the_unit_the_user_chose() -> None:
    grams, value, unit = diet._resolve_entry_quantity(
        quantity_g=None, quantity_value=2, quantity_unit="oz", product=None
    )

    assert grams == pytest.approx(56.699, abs=0.001)
    # Se guarda lo que escribio el usuario, no solo el resultado.
    assert (value, unit) == (2, "oz")


def test_resolve_quantity_uses_the_serving_size_of_the_catalog_for_servings() -> None:
    product = _make_food(serving_size_g=45.0)

    grams, value, unit = diet._resolve_entry_quantity(
        quantity_g=None, quantity_value=2, quantity_unit="porcion", product=product
    )

    assert (grams, value, unit) == (90.0, 2, "porcion")


def test_resolve_quantity_rejects_servings_when_the_food_has_no_serving_size() -> None:
    product = _make_food(serving_size_g=None)

    with pytest.raises(HTTPException) as err:
        diet._resolve_entry_quantity(
            quantity_g=None, quantity_value=1, quantity_unit="porcion", product=product
        )

    assert err.value.status_code == 422


def test_resolve_quantity_rejects_what_exceeds_the_cap_once_converted() -> None:
    with pytest.raises(HTTPException) as err:
        diet._resolve_entry_quantity(
            quantity_g=None, quantity_value=6, quantity_unit="kg", product=None
        )

    assert err.value.status_code == 422


def test_resolve_quantity_without_a_unit_assumes_the_base_unit_of_the_food() -> None:
    solid = _make_food(basis="per_100g")
    liquid = _make_food(basis="per_100ml")

    assert diet._resolve_entry_quantity(
        quantity_g=100.0, quantity_value=None, quantity_unit=None, product=solid
    ) == (100.0, 100.0, "g")
    # Un cliente viejo que manda "250" sobre leche esta diciendo 250 ml.
    assert diet._resolve_entry_quantity(
        quantity_g=250.0, quantity_value=None, quantity_unit=None, product=liquid
    ) == (250.0, 250.0, "ml")


def test_resolve_quantity_prefers_the_pair_over_a_stale_quantity_g() -> None:
    # Regla unica: si viene el par valor+unidad, manda el par. Asi un cliente
    # desactualizado no puede escribir un quantity_g que no cuadre con la unidad.
    grams, _value, _unit = diet._resolve_entry_quantity(
        quantity_g=999.0, quantity_value=1, quantity_unit="taza", product=None
    )

    assert grams == 240.0


def test_create_meal_entry_scales_the_snapshot_from_the_converted_quantity() -> None:
    user = _make_user()
    athlete_id = personal_athlete_id_for_user(user)
    product = _make_food(serving_size_g=50.0, energy_kcal=200.0, protein_g=10.0)
    db = FakeDietDb(get_map={(FoodProduct, product.id): product})
    response = Response()

    payload = diet.MealEntryCreateRequest(
        athlete_id=athlete_id,
        meal_slot="almuerzo",
        food_product_id=str(product.id),
        quantity_value=2,
        quantity_unit="porcion",
    )

    result = diet.create_meal_entry(payload=payload, response=response, user=user, db=db)

    # 2 porciones de 50 g = 100 g, que es justo la base del catalogo.
    assert result.quantity_g == 100.0
    assert result.quantity_value == 2
    assert result.quantity_unit == "porcion"
    assert result.energy_kcal == 200.0
    assert result.protein_g == 10.0


def test_update_meal_entry_reconverts_and_rescales_when_the_unit_changes() -> None:
    user = _make_user()
    athlete_id = personal_athlete_id_for_user(user)
    product = _make_food(energy_kcal=100.0, protein_g=2.0)
    entry = _make_meal_entry(
        athlete_id=athlete_id,
        food_product_id=product.id,
        quantity_g=100.0,
        quantity_value=100.0,
        quantity_unit="g",
    )
    db = FakeDietDb(
        get_map={(MealEntry, entry.id): entry, (FoodProduct, product.id): product},
    )

    payload = diet.MealEntryUpdateRequest(quantity_value=1, quantity_unit="taza")
    result = diet.update_meal_entry(entry_id=entry.id, payload=payload, user=user, db=db)

    assert result.quantity_g == 240.0
    assert (result.quantity_value, result.quantity_unit) == (1, "taza")
    # El snapshot se rehace con la cantidad nueva, no se queda en la vieja.
    assert result.energy_kcal == 240.0
    assert result.protein_g == pytest.approx(4.8)


# ---------------------------------------------------------------------------
# Agregacion de totales diarios
# ---------------------------------------------------------------------------


def test_aggregate_daily_totals_sums_across_entries() -> None:
    entry1 = _make_meal_entry(athlete_id="athlete_1", energy_kcal=200.0, protein_g=10.0)
    entry2 = _make_meal_entry(athlete_id="athlete_1", energy_kcal=300.0, protein_g=20.0)

    totals = diet._aggregate_daily_totals([entry1, entry2])

    assert totals.energy_kcal == 500.0
    assert totals.protein_g == 30.0


def test_aggregate_daily_totals_treats_missing_values_as_zero() -> None:
    entry = _make_meal_entry(athlete_id="athlete_1", energy_kcal=None, fat_g=None, protein_g=5.0)

    totals = diet._aggregate_daily_totals([entry])

    assert totals.energy_kcal == 0.0
    assert totals.fat_g == 0.0
    assert totals.protein_g == 5.0


def test_aggregate_daily_totals_sums_micronutrients() -> None:
    entry1 = _make_meal_entry(
        athlete_id="athlete_1", micronutrients={"vitamin_c_mg": 10.0, "iron_mg": 2.0}
    )
    entry2 = _make_meal_entry(athlete_id="athlete_1", micronutrients={"vitamin_c_mg": 5.0})

    totals = diet._aggregate_daily_totals([entry1, entry2])

    assert totals.micronutrients["vitamin_c_mg"] == 15.0
    assert totals.micronutrients["iron_mg"] == 2.0


def test_aggregate_daily_totals_empty_list_returns_zeros() -> None:
    totals = diet._aggregate_daily_totals([])

    assert totals.energy_kcal == 0.0
    assert totals.sodium_mg == 0.0
    assert totals.micronutrients == {}


def test_aggregate_daily_totals_rounds_results() -> None:
    entry1 = _make_meal_entry(athlete_id="athlete_1", energy_kcal=100.111)
    entry2 = _make_meal_entry(athlete_id="athlete_1", energy_kcal=0.222)

    totals = diet._aggregate_daily_totals([entry1, entry2])

    assert totals.energy_kcal == 100.33


# ---------------------------------------------------------------------------
# Aritmetica porcion <-> 100 g a nivel de endpoint
# ---------------------------------------------------------------------------


def test_snapshot_from_food_product_scales_quantity() -> None:
    product = _make_food(
        name="Pollo",
        energy_kcal=200.0,
        protein_g=30.0,
        sodium_mg=70.0,
        micronutrients={"iron_mg": 1.0},
    )

    snapshot = diet._snapshot_from_food_product(product, quantity_g=150.0)

    assert snapshot["food_name"] == "Pollo"
    assert snapshot["energy_kcal"] == 300.0
    assert snapshot["protein_g"] == 45.0
    assert snapshot["sodium_mg"] == 105.0
    assert snapshot["micronutrients"]["iron_mg"] == 1.5


def test_snapshot_from_food_product_at_exactly_100g_matches_catalog() -> None:
    product = _make_food(energy_kcal=250.0, protein_g=12.0)

    snapshot = diet._snapshot_from_food_product(product, quantity_g=100.0)

    assert snapshot["energy_kcal"] == 250.0
    assert snapshot["protein_g"] == 12.0


def test_day_range_utc_produces_correct_24h_boundaries() -> None:
    start, end = diet._day_range_utc(date(2026, 8, 1))

    assert start == datetime(2026, 8, 1, tzinfo=UTC)
    assert end == datetime(2026, 8, 2, tzinfo=UTC)
    assert (end - start).total_seconds() == 86400
