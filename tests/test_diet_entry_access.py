from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

import pytest
from diet_support import (
    FakeDietDb,
    _make_meal_entry,
    _make_preset,
    _make_user,
)
from fastapi import HTTPException, Response
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from app.api.v1.endpoints import diet
from app.auth.athlete_access import personal_athlete_id_for_user, require_athlete_access
from app.db.models import MealEntry, NutritionTarget

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
