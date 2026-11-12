from __future__ import annotations

import pytest
from diet_support import (
    FakeDietDb,
    _make_food,
    _make_meal_entry,
    _make_user,
)
from fastapi import HTTPException

from app.api.v1.endpoints import diet
from app.auth.types import Role
from app.auth.view_scopes import ViewScopes, reset_current_view_scopes, set_current_view_scopes

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
