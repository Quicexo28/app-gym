"""Fabricas y base falsa compartidas por los tests de dieta (sin base de datos)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from app.auth.types import Plan, Role
from app.db.models import FoodProduct, MealEntry, MealPreset
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
