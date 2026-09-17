from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Any

import pytest
from fastapi import HTTPException, Response
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from app.api.v1.endpoints import diet
from app.auth.athlete_access import personal_athlete_id_for_user, require_athlete_access
from app.auth.types import Plan, Role
from app.auth.view_scopes import ViewScopes, reset_current_view_scopes, set_current_view_scopes
from app.db.models import FoodProduct, MealEntry, MealPreset, NutritionTarget
from app.db.models_auth import User

# ---------------------------------------------------------------------------
# Fixtures / helpers (mismo espiritu que el FakeDb de tests/test_auth_flow.py)
# ---------------------------------------------------------------------------


def _make_user(*, role: Role = Role.USER, plan: Plan = Plan.FREE) -> User:
    return User(
        id=uuid.uuid4(),
        email=f"{uuid.uuid4().hex}@example.com",
        phone_number=None,
        google_sub=None,
        password_hash="x",
        role=role,
        plan=plan,
        is_active=True,
    )


def _make_meal_entry(*, athlete_id: str, **overrides: Any) -> MealEntry:
    defaults: dict[str, Any] = dict(
        id=uuid.uuid4(),
        athlete_id=athlete_id,
        logged_by_user_id=uuid.uuid4(),
        consumed_at=datetime(2026, 8, 1, 12, 0, tzinfo=UTC),
        meal_slot="almuerzo",
        food_product_id=None,
        food_name="Arroz",
        quantity_g=150.0,
        energy_kcal=195.0,
        protein_g=4.0,
        carbs_g=42.0,
        sugars_g=0.0,
        fiber_g=1.0,
        fat_g=0.5,
        sat_fat_g=0.1,
        sodium_mg=2.0,
        micronutrients=None,
        notes=None,
        created_at_utc=datetime(2026, 8, 1, 12, 1, tzinfo=UTC),
    )
    defaults.update(overrides)
    return MealEntry(**defaults)


def _make_food(**overrides: Any) -> FoodProduct:
    defaults: dict[str, Any] = dict(
        id=uuid.uuid4(),
        owner_user_id=None,
        barcode=None,
        source="user_manual",
        source_ref=None,
        name="Producto",
        brand=None,
        country_code=None,
        serving_size_g=None,
        serving_label=None,
        package_qty_g=None,
        basis="per_100g",
        energy_kcal=100.0,
        protein_g=1.0,
        carbs_g=1.0,
        sugars_g=0.0,
        fiber_g=0.0,
        fat_g=0.0,
        sat_fat_g=0.0,
        trans_fat_g=0.0,
        sodium_mg=0.0,
        cholesterol_mg=0.0,
        micronutrients=None,
        image_front_path=None,
        image_nutrition_path=None,
        verified_count=0,
        status="active",
        created_by_user_id=None,
        created_at_utc=datetime(2026, 8, 1, tzinfo=UTC),
        updated_at_utc=datetime(2026, 8, 1, tzinfo=UTC),
    )
    defaults.update(overrides)
    return FoodProduct(**defaults)


def _make_preset(*, owner_user_id: uuid.UUID, **overrides: Any) -> MealPreset:
    defaults: dict[str, Any] = dict(
        id=uuid.uuid4(),
        owner_user_id=owner_user_id,
        name="Desayuno tipico",
        meal_slot="desayuno",
        items=[
            {"food_name": "Huevos", "quantity_g": 100.0, "energy_kcal": 150.0},
            {"food_name": "Pan", "quantity_g": 50.0, "energy_kcal": 130.0},
        ],
        created_at_utc=datetime(2026, 8, 1, tzinfo=UTC),
        updated_at_utc=datetime(2026, 8, 1, tzinfo=UTC),
    )
    defaults.update(overrides)
    return MealPreset(**defaults)


class _FakeScalars:
    def __init__(self, items: list[Any]) -> None:
        self._items = items

    def all(self) -> list[Any]:
        return self._items

    def first(self) -> Any:
        return self._items[0] if self._items else None


class _FakeExecuteResult:
    def __init__(self, scalar_result: Any, scalars_list: list[Any]) -> None:
        self._scalar_result = scalar_result
        self._scalars_list = scalars_list

    def scalar_one_or_none(self) -> Any:
        return self._scalar_result

    def scalars(self) -> _FakeScalars:
        return _FakeScalars(self._scalars_list)


class FakeDietDb:
    """Doble minimo de Session: solo lo que tocan los endpoints bajo prueba.

    `scalar_results`/`scalars_lists` son colas opcionales: si se dan, cada
    llamada a `execute()` consume el siguiente elemento (para simular una
    secuencia de consultas distintas, p.ej. "no existe" y luego, tras un
    commit fallido, "ya existe"). Sin cola, cae al valor fijo de siempre
    (`scalar_result`/`scalars_list`), igual que antes.
    """

    def __init__(
        self,
        *,
        get_map: dict[tuple[type, Any], Any] | None = None,
        scalar_result: Any = None,
        scalar_results: list[Any] | None = None,
        scalars_list: list[Any] | None = None,
        scalars_lists: list[list[Any]] | None = None,
        commit_raises: Exception | None = None,
    ) -> None:
        self._get_map = get_map or {}
        self._scalar_result = scalar_result
        self._scalar_results = list(scalar_results) if scalar_results is not None else None
        self._scalars_list = scalars_list or []
        self._scalars_lists = list(scalars_lists) if scalars_lists is not None else None
        self._commit_raises = commit_raises
        self.deleted: list[Any] = []
        self.added: list[Any] = []
        self.committed = False
        self.rolled_back = False
        self.execute_calls = 0
        self.last_stmt: Any = None

    def get(self, model: type, pk: Any) -> Any:
        return self._get_map.get((model, pk))

    def execute(self, stmt: Any) -> _FakeExecuteResult:
        self.execute_calls += 1
        self.last_stmt = stmt
        scalar_result = self._scalar_results.pop(0) if self._scalar_results else self._scalar_result
        scalars_list = self._scalars_lists.pop(0) if self._scalars_lists else self._scalars_list
        return _FakeExecuteResult(scalar_result, scalars_list)

    def delete(self, obj: Any) -> None:
        self.deleted.append(obj)

    def add(self, obj: Any) -> None:
        self.added.append(obj)

    def commit(self) -> None:
        if self._commit_raises is not None:
            exc, self._commit_raises = self._commit_raises, None
            raise exc
        self.committed = True

    def rollback(self) -> None:
        self.rolled_back = True

    def refresh(self, obj: Any) -> None:
        # Simula lo que el flush real de la BD asignaria (id/created_at_utc
        # vienen de un `default=` de columna, que solo aplica al insertar de
        # verdad; aqui no hay INSERT real, asi que hay que rellenarlos).
        if getattr(obj, "id", None) is None:
            obj.id = uuid.uuid4()
        if getattr(obj, "created_at_utc", None) is None:
            obj.created_at_utc = datetime(2026, 8, 1, 12, 0, tzinfo=UTC)


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


# ---------------------------------------------------------------------------
# Aislamiento de acceso: usuario A NO puede leer/escribir el diario de B
# ---------------------------------------------------------------------------


def test_require_athlete_access_blocks_other_users_athlete_id() -> None:
    user_a = _make_user()
    user_b = _make_user()

    with pytest.raises(HTTPException) as exc:
        require_athlete_access(None, user_a, personal_athlete_id_for_user(user_b))

    assert exc.value.status_code == 403


def test_require_athlete_access_allows_own_athlete_id() -> None:
    user_a = _make_user()

    require_athlete_access(None, user_a, personal_athlete_id_for_user(user_a))


def test_get_nutrition_targets_blocks_cross_athlete_access() -> None:
    user_a = _make_user()
    user_b = _make_user()

    with pytest.raises(HTTPException) as exc:
        diet.get_nutrition_targets(
            user=user_a, db=None, athlete_id=personal_athlete_id_for_user(user_b)
        )

    assert exc.value.status_code == 403


def test_get_nutrition_targets_allows_own_athlete_id_with_no_target_set() -> None:
    user_a = _make_user()
    own_id = personal_athlete_id_for_user(user_a)
    db = FakeDietDb(scalar_result=None)

    result = diet.get_nutrition_targets(user=user_a, db=db, athlete_id=own_id)

    assert result.athlete_id == own_id
    assert result.energy_kcal is None
    assert result.micronutrient_targets == {}
    assert result.meal_labels is None


def test_put_nutrition_targets_saves_custom_meal_labels() -> None:
    user_a = _make_user()
    own_id = personal_athlete_id_for_user(user_a)
    row = NutritionTarget(athlete_id=own_id, updated_at_utc=datetime(2026, 8, 1, 12, 0, tzinfo=UTC))
    db = FakeDietDb(scalar_result=row)

    payload = diet.NutritionTargetPayload(
        athlete_id=own_id,
        meal_labels=["Primer bocado", " Almuerzo fuerte ", "Comida 3"],
    )
    result = diet.put_nutrition_targets(payload, user=user_a, db=db)

    assert result.meal_labels == ["Primer bocado", "Almuerzo fuerte", "Comida 3"]
    assert db.committed is True


def test_nutrition_target_payload_rejects_empty_meal_label() -> None:
    with pytest.raises(ValidationError):
        diet.NutritionTargetPayload(athlete_id="athlete_1", meal_labels=["Comida 1", "   "])


def test_nutrition_target_payload_rejects_too_many_meal_labels() -> None:
    with pytest.raises(ValidationError):
        diet.NutritionTargetPayload(athlete_id="athlete_1", meal_labels=[f"Comida {i}" for i in range(9)])


def test_list_meal_entries_blocks_cross_athlete_access() -> None:
    user_a = _make_user()
    user_b = _make_user()

    with pytest.raises(HTTPException) as exc:
        diet.list_meal_entries(
            user=user_a,
            db=None,
            date=date(2026, 8, 1),
            athlete_id=personal_athlete_id_for_user(user_b),
        )

    assert exc.value.status_code == 403


def test_delete_meal_entry_blocks_other_users_entry() -> None:
    owner = _make_user()
    attacker = _make_user()
    entry = _make_meal_entry(athlete_id=personal_athlete_id_for_user(owner))
    db = FakeDietDb(get_map={(MealEntry, entry.id): entry})

    with pytest.raises(HTTPException) as exc:
        diet.delete_meal_entry(entry_id=entry.id, user=attacker, db=db)

    assert exc.value.status_code == 403
    assert db.deleted == []


def test_delete_meal_entry_allows_owner() -> None:
    owner = _make_user()
    entry = _make_meal_entry(athlete_id=personal_athlete_id_for_user(owner))
    db = FakeDietDb(get_map={(MealEntry, entry.id): entry})

    result = diet.delete_meal_entry(entry_id=entry.id, user=owner, db=db)

    assert result == {"ok": True, "id": str(entry.id)}
    assert entry in db.deleted
    assert db.committed is True


def test_delete_meal_entry_missing_entry_returns_404() -> None:
    user = _make_user()
    db = FakeDietDb()

    with pytest.raises(HTTPException) as exc:
        diet.delete_meal_entry(entry_id=uuid.uuid4(), user=user, db=db)

    assert exc.value.status_code == 404


# ---------------------------------------------------------------------------
# Idempotencia offline: client_ref (doc modulo-dieta.md #7 criterio 6)
# ---------------------------------------------------------------------------


def test_create_meal_entry_without_client_ref_behaves_as_before() -> None:
    user = _make_user()
    athlete_id = personal_athlete_id_for_user(user)
    db = FakeDietDb()
    response = Response()

    payload = diet.MealEntryCreateRequest(
        athlete_id=athlete_id, meal_slot="almuerzo", quantity_g=100.0, food_name="Arroz"
    )

    result = diet.create_meal_entry(payload=payload, response=response, user=user, db=db)

    created = [obj for obj in db.added if isinstance(obj, MealEntry)]
    assert len(created) == 1
    assert created[0].client_ref is None
    assert result.food_name == "Arroz"
    assert db.committed is True
    # Sin client_ref no hay chequeo de duplicado: cero SELECT antes del commit.
    assert db.execute_calls == 0


def test_create_meal_entry_same_client_ref_returns_existing_without_creating() -> None:
    user = _make_user()
    athlete_id = personal_athlete_id_for_user(user)
    existing = _make_meal_entry(athlete_id=athlete_id, food_name="Arroz", client_ref="ref-1")
    db = FakeDietDb(scalar_result=existing)
    response = Response()

    payload = diet.MealEntryCreateRequest(
        athlete_id=athlete_id,
        meal_slot="almuerzo",
        quantity_g=100.0,
        food_name="Arroz",
        client_ref="ref-1",
    )

    result = diet.create_meal_entry(payload=payload, response=response, user=user, db=db)

    assert result.id == str(existing.id)
    assert [obj for obj in db.added if isinstance(obj, MealEntry)] == []
    assert db.committed is False
    assert response.status_code == 200


def test_create_meal_entry_different_client_refs_create_two_entries() -> None:
    user = _make_user()
    athlete_id = personal_athlete_id_for_user(user)

    db1 = FakeDietDb(scalar_result=None)
    payload1 = diet.MealEntryCreateRequest(
        athlete_id=athlete_id,
        meal_slot="almuerzo",
        quantity_g=100.0,
        food_name="Arroz",
        client_ref="ref-a",
    )
    diet.create_meal_entry(payload=payload1, response=Response(), user=user, db=db1)

    db2 = FakeDietDb(scalar_result=None)
    payload2 = diet.MealEntryCreateRequest(
        athlete_id=athlete_id,
        meal_slot="cena",
        quantity_g=200.0,
        food_name="Pollo",
        client_ref="ref-b",
    )
    diet.create_meal_entry(payload=payload2, response=Response(), user=user, db=db2)

    created1 = [obj for obj in db1.added if isinstance(obj, MealEntry)]
    created2 = [obj for obj in db2.added if isinstance(obj, MealEntry)]
    assert len(created1) == 1 and created1[0].client_ref == "ref-a"
    assert len(created2) == 1 and created2[0].client_ref == "ref-b"


def test_create_meal_entry_same_client_ref_different_athletes_creates_distinct_entries() -> None:
    """Mismo client_ref, dos atletas: cada consulta esta acotada a su propio
    atleta (ver test_find_meal_entry_by_client_ref_filters_by_athlete_and_client_ref
    abajo), asi que ninguna ve la entrada de la otra y ambas se crean."""
    user_a = _make_user()
    user_b = _make_user()
    athlete_a = personal_athlete_id_for_user(user_a)
    athlete_b = personal_athlete_id_for_user(user_b)

    db_a = FakeDietDb(scalar_result=None)
    payload_a = diet.MealEntryCreateRequest(
        athlete_id=athlete_a,
        meal_slot="almuerzo",
        quantity_g=100.0,
        food_name="Arroz",
        client_ref="shared-ref",
    )
    diet.create_meal_entry(payload=payload_a, response=Response(), user=user_a, db=db_a)

    db_b = FakeDietDb(scalar_result=None)
    payload_b = diet.MealEntryCreateRequest(
        athlete_id=athlete_b,
        meal_slot="almuerzo",
        quantity_g=100.0,
        food_name="Arroz",
        client_ref="shared-ref",
    )
    diet.create_meal_entry(payload=payload_b, response=Response(), user=user_b, db=db_b)

    created_a = [obj for obj in db_a.added if isinstance(obj, MealEntry)]
    created_b = [obj for obj in db_b.added if isinstance(obj, MealEntry)]
    assert len(created_a) == 1
    assert len(created_b) == 1
    assert created_a[0].athlete_id != created_b[0].athlete_id
    assert created_a[0].client_ref == created_b[0].client_ref == "shared-ref"


def test_find_meal_entry_by_client_ref_filters_by_athlete_and_client_ref() -> None:
    """La garantia de aislamiento entre atletas vive en este WHERE: sin el
    filtro por athlete_id, un client_ref de otro atleta se confundiria con
    uno propio."""
    db = FakeDietDb(scalar_result=None)

    diet._find_meal_entry_by_client_ref(db, "athlete_a", "ref-1")

    compiled = str(db.last_stmt.compile(compile_kwargs={"literal_binds": True}))
    assert "meal_entries.athlete_id" in compiled
    assert "meal_entries.client_ref" in compiled
    assert "'athlete_a'" in compiled
    assert "'ref-1'" in compiled


def test_create_meal_entry_integrity_error_race_returns_existing_entry() -> None:
    """Dos requests offline con el mismo client_ref llegan casi a la vez: el
    pre-chequeo no ve nada (None), ambas intentan commitear, y el indice
    unico parcial de la BD tumba la segunda con IntegrityError. En vez de un
    500, se recupera devolviendo la entrada que si comiteo."""
    user = _make_user()
    athlete_id = personal_athlete_id_for_user(user)
    winner = _make_meal_entry(athlete_id=athlete_id, food_name="Arroz", client_ref="ref-1")
    db = FakeDietDb(
        scalar_results=[None, winner],
        commit_raises=IntegrityError("INSERT", {}, Exception("duplicate key")),
    )
    response = Response()

    payload = diet.MealEntryCreateRequest(
        athlete_id=athlete_id,
        meal_slot="almuerzo",
        quantity_g=100.0,
        food_name="Arroz",
        client_ref="ref-1",
    )

    result = diet.create_meal_entry(payload=payload, response=response, user=user, db=db)

    assert result.id == str(winner.id)
    assert db.rolled_back is True
    assert response.status_code == 200


def test_create_meal_entry_integrity_error_without_client_ref_propagates() -> None:
    """Sin client_ref no hay forma de saber cual entrada 'gano' la carrera:
    el error se deja propagar como 409 en vez de inventarse una respuesta."""
    user = _make_user()
    athlete_id = personal_athlete_id_for_user(user)
    db = FakeDietDb(commit_raises=IntegrityError("INSERT", {}, Exception("fk violation")))

    payload = diet.MealEntryCreateRequest(
        athlete_id=athlete_id, meal_slot="almuerzo", quantity_g=100.0, food_name="Arroz"
    )

    with pytest.raises(HTTPException) as exc:
        diet.create_meal_entry(payload=payload, response=Response(), user=user, db=db)

    assert exc.value.status_code == 409
    assert db.rolled_back is True


def test_meal_entry_athlete_client_ref_index_is_unique_and_scoped_to_non_null() -> None:
    index = next(
        idx
        for idx in MealEntry.__table__.indexes
        if idx.name == "ix_meal_entries_athlete_client_ref"
    )
    assert index.unique is True
    assert [col.name for col in index.columns] == ["athlete_id", "client_ref"]
    assert "client_ref IS NOT NULL" in str(index.dialect_kwargs["postgresql_where"])


# ---------------------------------------------------------------------------
# Idempotencia offline: from-preset (client_ref de LOTE, un ref por intento)
# ---------------------------------------------------------------------------


def test_create_entries_from_preset_without_client_ref_behaves_as_before() -> None:
    user = _make_user()
    athlete_id = personal_athlete_id_for_user(user)
    preset = _make_preset(owner_user_id=user.id)
    db = FakeDietDb(scalar_results=[preset])

    payload = diet.MealEntryFromPresetRequest(athlete_id=athlete_id, preset_id=str(preset.id))

    result = diet.create_entries_from_preset(payload=payload, response=Response(), user=user, db=db)

    created = [obj for obj in db.added if isinstance(obj, MealEntry)]
    assert len(created) == 2
    assert all(row.client_ref is None for row in created)
    assert len(result) == 2
    assert db.committed is True


def test_create_entries_from_preset_same_client_ref_returns_existing_batch() -> None:
    user = _make_user()
    athlete_id = personal_athlete_id_for_user(user)
    preset = _make_preset(owner_user_id=user.id)
    existing_batch = [
        _make_meal_entry(athlete_id=athlete_id, food_name="Huevos", client_ref="batch-1:0"),
        _make_meal_entry(athlete_id=athlete_id, food_name="Pan", client_ref="batch-1:1"),
    ]
    # scalars_lists: 1a llamada (fetch del preset) ignora la lista, 2a
    # llamada (pre-chequeo del lote) encuentra el lote ya creado.
    db = FakeDietDb(scalar_results=[preset], scalars_lists=[[], existing_batch])
    response = Response()

    payload = diet.MealEntryFromPresetRequest(
        athlete_id=athlete_id, preset_id=str(preset.id), client_ref="batch-1"
    )

    result = diet.create_entries_from_preset(payload=payload, response=response, user=user, db=db)

    assert [obj for obj in db.added if isinstance(obj, MealEntry)] == []
    assert db.committed is False
    assert response.status_code == 200
    assert len(result) == 2


def test_create_entries_from_preset_different_client_ref_creates_new_batch() -> None:
    user = _make_user()
    athlete_id = personal_athlete_id_for_user(user)
    preset = _make_preset(owner_user_id=user.id)

    db1 = FakeDietDb(scalar_results=[preset], scalars_lists=[[], []])
    payload1 = diet.MealEntryFromPresetRequest(
        athlete_id=athlete_id, preset_id=str(preset.id), client_ref="batch-a"
    )
    diet.create_entries_from_preset(payload=payload1, response=Response(), user=user, db=db1)

    db2 = FakeDietDb(scalar_results=[preset], scalars_lists=[[], []])
    payload2 = diet.MealEntryFromPresetRequest(
        athlete_id=athlete_id, preset_id=str(preset.id), client_ref="batch-b"
    )
    diet.create_entries_from_preset(payload=payload2, response=Response(), user=user, db=db2)

    created1 = [obj for obj in db1.added if isinstance(obj, MealEntry)]
    created2 = [obj for obj in db2.added if isinstance(obj, MealEntry)]
    assert len(created1) == 2 and len(created2) == 2
    assert {row.client_ref for row in created1} == {"batch-a:0", "batch-a:1"}
    assert {row.client_ref for row in created2} == {"batch-b:0", "batch-b:1"}


def test_create_entries_from_preset_integrity_error_race_returns_existing_batch() -> None:
    user = _make_user()
    athlete_id = personal_athlete_id_for_user(user)
    preset = _make_preset(owner_user_id=user.id)
    winning_batch = [
        _make_meal_entry(athlete_id=athlete_id, food_name="Huevos", client_ref="batch-1:0"),
        _make_meal_entry(athlete_id=athlete_id, food_name="Pan", client_ref="batch-1:1"),
    ]
    db = FakeDietDb(
        scalar_results=[preset],
        # 1a llamada (fetch del preset) ignora la lista, 2a (pre-chequeo) no
        # encuentra nada todavia, 3a (recuperacion tras IntegrityError) si.
        scalars_lists=[[], [], winning_batch],
        commit_raises=IntegrityError("INSERT", {}, Exception("duplicate key")),
    )
    response = Response()

    payload = diet.MealEntryFromPresetRequest(
        athlete_id=athlete_id, preset_id=str(preset.id), client_ref="batch-1"
    )

    result = diet.create_entries_from_preset(payload=payload, response=response, user=user, db=db)

    assert db.rolled_back is True
    assert response.status_code == 200
    assert len(result) == 2


# ---------------------------------------------------------------------------
# Autorizacion sobre el catalogo de alimentos (personal vs global vs admin)
# ---------------------------------------------------------------------------


def test_authorize_food_write_allows_owner_of_personal_product() -> None:
    owner = _make_user()
    row = _make_food(owner_user_id=owner.id)

    assert diet._authorize_food_write(row, owner) is False


def test_authorize_food_write_blocks_non_owner_on_personal_product() -> None:
    owner = _make_user()
    attacker = _make_user()
    row = _make_food(owner_user_id=owner.id)

    with pytest.raises(HTTPException) as exc:
        diet._authorize_food_write(row, attacker)

    assert exc.value.status_code == 403


def test_authorize_food_write_blocks_non_admin_on_global_product() -> None:
    user = _make_user(role=Role.USER)
    row = _make_food(owner_user_id=None)

    with pytest.raises(HTTPException) as exc:
        diet._authorize_food_write(row, user)

    assert exc.value.status_code == 403


def test_authorize_food_write_allows_admin_on_global_product() -> None:
    admin = _make_user(role=Role.ADMIN)
    row = _make_food(owner_user_id=None)
    token = set_current_view_scopes(ViewScopes(admin=True, coach=False))
    try:
        assert diet._authorize_food_write(row, admin) is True
    finally:
        reset_current_view_scopes(token)


def test_authorize_food_photo_read_open_for_global_product() -> None:
    user = _make_user()
    row = _make_food(owner_user_id=None)

    diet._authorize_food_photo_read(row, user)  # no debe lanzar


def test_authorize_food_photo_read_blocks_non_owner_on_personal_product() -> None:
    owner = _make_user()
    attacker = _make_user()
    row = _make_food(owner_user_id=owner.id)

    with pytest.raises(HTTPException) as exc:
        diet._authorize_food_photo_read(row, attacker)

    assert exc.value.status_code == 403


def test_authorize_food_photo_write_allows_pending_contributor() -> None:
    contributor = _make_user()
    row = _make_food(owner_user_id=None, created_by_user_id=contributor.id, status="pending")

    diet._authorize_food_photo_write(row, contributor)  # no debe lanzar


def test_authorize_food_photo_write_blocks_unrelated_user_on_pending_product() -> None:
    contributor = _make_user()
    stranger = _make_user()
    row = _make_food(owner_user_id=None, created_by_user_id=contributor.id, status="pending")

    with pytest.raises(HTTPException) as exc:
        diet._authorize_food_photo_write(row, stranger)

    assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# Helpers varios
# ---------------------------------------------------------------------------


def test_looks_like_liquid_detects_ml_label() -> None:
    assert diet._looks_like_liquid("500 ml") is True
    assert diet._looks_like_liquid("500 g") is False
    assert diet._looks_like_liquid(None) is False


def test_serialize_food_defaults_missing_micronutrients_to_empty_dict() -> None:
    row = _make_food(micronutrients=None)

    item = diet._serialize_food(row)

    assert item.micronutrients == {}


def test_serialize_entry_defaults_missing_micronutrients_to_empty_dict() -> None:
    entry = _make_meal_entry(athlete_id="athlete_1", micronutrients=None)

    item = diet._serialize_entry(entry)

    assert item.micronutrients == {}
    assert item.food_product_id is None


def test_escape_like_neutraliza_comodines() -> None:
    """`batch_ref` viene del cliente: sin escapar, el patron LIKE es suyo.

    Un `client_ref` de "%" produce el patron "%:%", que matchea TODAS las
    entradas por lote del atleta; en un reintento devolveria las equivocadas en
    vez de crear las pedidas. Y `uid()` del frontend genera refs con "_", que en
    LIKE es comodin de un caracter.
    """
    assert diet._escape_like("%") == r"\%"
    assert diet._escape_like("_") == r"\_"
    assert diet._escape_like("meal_a1b2_c3d4") == r"meal\_a1b2\_c3d4"
    assert diet._escape_like("100%_x") == r"100\%\_x"
    # El propio caracter de escape se escapa primero, si no se romperia el patron.
    assert diet._escape_like("a\\b") == "a\\\\b"
    # Un ref normal no cambia.
    assert diet._escape_like("batch-1") == "batch-1"


def test_find_meal_entries_by_batch_ref_escapa_el_patron() -> None:
    """El SQL generado debe llevar el patron escapado y la clausula ESCAPE."""
    db = FakeDietDb(scalars_lists=[[]])
    diet._find_meal_entries_by_batch_ref(db, "athlete-1", "meal_a1_b2")

    sql = str(db.last_stmt.compile(compile_kwargs={"literal_binds": True}))
    assert r"meal\_a1\_b2:%" in sql
    assert "ESCAPE" in sql.upper()
