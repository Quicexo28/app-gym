from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from datetime import date as date_cls
from typing import Annotated, Any

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Response,
    status,
)
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.v1.endpoints.diet.common import (
    _ENTRY_TOTAL_KEYS,
    _MAX_SUMMARY_DAYS,
    DbSession,
    MealSlot,
    _day_range_utc,
    _ensure_athlete_row,
    _to_utc,
)
from app.auth.athlete_access import require_athlete_access
from app.auth.deps import get_current_user
from app.db.engine import get_db
from app.db.models import FoodProduct, MealEntry, MealPreset
from app.db.models_auth import User
from app.nutrition.mapping import (
    scale_micronutrients_per_100g,
    scale_per_100g,
)
from app.nutrition.units import (
    QuantityUnitError,
    QuantityUnitKey,
    default_unit_for_basis,
    resolve_quantity_grams,
)

router = APIRouter()


# Registros de comida (entries)
# --------------------------------------------------------------------------


def _validate_quantity_pair(value: float | None, unit: str | None) -> None:
    """`quantity_value` y `quantity_unit` viajan juntos o no viajan.

    Uno solo de los dos siempre es un error del cliente: un valor sin unidad no
    se puede convertir, y una unidad sin valor no dice cuanto se comio.
    """
    if (value is None) != (unit is None):
        raise ValueError("quantity_value and quantity_unit must be sent together.")


class MealEntryCreateRequest(BaseModel):
    athlete_id: str = Field(min_length=1, max_length=255)
    consumed_at: datetime | None = None
    meal_slot: MealSlot
    food_product_id: str | None = None
    food_name: str | None = Field(default=None, max_length=300)
    # Cantidad: o normalizada (`quantity_g`, clientes viejos y el outbox
    # encolado antes de las unidades) o tal como la escribio el usuario
    # (`quantity_value` + `quantity_unit`, que el servidor convierte). Ver
    # `_resolve_entry_quantity`.
    quantity_g: float | None = Field(default=None, gt=0, le=5000)
    quantity_value: float | None = Field(default=None, gt=0, le=100000)
    quantity_unit: QuantityUnitKey | None = None
    notes: str | None = Field(default=None, max_length=1000)
    energy_kcal: float | None = Field(default=None, ge=0, le=20000)
    protein_g: float | None = Field(default=None, ge=0, le=2000)
    carbs_g: float | None = Field(default=None, ge=0, le=2000)
    sugars_g: float | None = Field(default=None, ge=0, le=2000)
    fiber_g: float | None = Field(default=None, ge=0, le=500)
    fat_g: float | None = Field(default=None, ge=0, le=2000)
    sat_fat_g: float | None = Field(default=None, ge=0, le=2000)
    sodium_mg: float | None = Field(default=None, ge=0, le=100000)
    micronutrients: dict[str, float] | None = None
    client_ref: str | None = Field(default=None, max_length=64)

    @model_validator(mode="after")
    def _validate_source(self) -> MealEntryCreateRequest:
        if not self.food_product_id and not (self.food_name and self.food_name.strip()):
            raise ValueError("food_product_id or food_name is required.")
        _validate_quantity_pair(self.quantity_value, self.quantity_unit)
        if self.quantity_g is None and self.quantity_value is None:
            raise ValueError("quantity_g or quantity_value + quantity_unit is required.")
        return self


class MealEntryUpdateRequest(BaseModel):
    consumed_at: datetime | None = None
    meal_slot: MealSlot | None = None
    quantity_g: float | None = Field(default=None, gt=0, le=5000)
    quantity_value: float | None = Field(default=None, gt=0, le=100000)
    quantity_unit: QuantityUnitKey | None = None
    food_name: str | None = Field(default=None, max_length=300)
    notes: str | None = Field(default=None, max_length=1000)
    energy_kcal: float | None = Field(default=None, ge=0, le=20000)
    protein_g: float | None = Field(default=None, ge=0, le=2000)
    carbs_g: float | None = Field(default=None, ge=0, le=2000)
    sugars_g: float | None = Field(default=None, ge=0, le=2000)
    fiber_g: float | None = Field(default=None, ge=0, le=500)
    fat_g: float | None = Field(default=None, ge=0, le=2000)
    sat_fat_g: float | None = Field(default=None, ge=0, le=2000)
    sodium_mg: float | None = Field(default=None, ge=0, le=100000)
    micronutrients: dict[str, float] | None = None

    @model_validator(mode="after")
    def _validate_quantity(self) -> MealEntryUpdateRequest:
        _validate_quantity_pair(self.quantity_value, self.quantity_unit)
        return self


class MealEntryFromPresetRequest(BaseModel):
    athlete_id: str = Field(min_length=1, max_length=255)
    preset_id: str
    consumed_at: datetime | None = None
    meal_slot: MealSlot | None = None
    # Ref de LOTE (uno por intento de guardado), no uno por item del preset;
    # ver docstring de `create_entries_from_preset`.
    client_ref: str | None = Field(default=None, max_length=48)


class MealEntryItem(BaseModel):
    id: str
    athlete_id: str
    logged_by_user_id: str
    consumed_at: str
    meal_slot: str
    food_product_id: str | None
    food_name: str
    quantity_g: float
    #: Lo que escribio el usuario. `None` en entradas anteriores a las unidades.
    quantity_value: float | None
    quantity_unit: str | None
    energy_kcal: float | None
    protein_g: float | None
    carbs_g: float | None
    sugars_g: float | None
    fiber_g: float | None
    fat_g: float | None
    sat_fat_g: float | None
    sodium_mg: float | None
    micronutrients: dict[str, float]
    notes: str | None
    created_at_utc: str


class DailyTotalsResponse(BaseModel):
    energy_kcal: float
    protein_g: float
    carbs_g: float
    sugars_g: float
    fiber_g: float
    fat_g: float
    sat_fat_g: float
    sodium_mg: float
    micronutrients: dict[str, float]


class MealEntriesResponse(BaseModel):
    athlete_id: str
    date: str
    items: list[MealEntryItem]
    totals: DailyTotalsResponse


class DietSummaryDayItem(BaseModel):
    date: str
    totals: DailyTotalsResponse


class DietSummaryResponse(BaseModel):
    athlete_id: str
    from_date: str
    to_date: str
    days: list[DietSummaryDayItem]


@dataclass(slots=True)
class DailyTotals:
    energy_kcal: float
    protein_g: float
    carbs_g: float
    sugars_g: float
    fiber_g: float
    fat_g: float
    sat_fat_g: float
    sodium_mg: float
    micronutrients: dict[str, float]


def _aggregate_daily_totals(entries: Iterable[MealEntry]) -> DailyTotals:
    """Suma los macros y micronutrientes de un conjunto de registros de comida.

    Los valores None de cada registro se tratan como cero (no se descarta el
    registro completo por faltarle un campo).
    """
    totals = dict.fromkeys(_ENTRY_TOTAL_KEYS, 0.0)
    micro_totals: dict[str, float] = {}

    for entry in entries:
        for key in _ENTRY_TOTAL_KEYS:
            value = getattr(entry, key)
            if value is not None:
                totals[key] += value
        for micro_key, micro_value in (entry.micronutrients or {}).items():
            if micro_value is None:
                continue
            micro_totals[micro_key] = micro_totals.get(micro_key, 0.0) + micro_value

    rounded_totals = {key: round(value, 2) for key, value in totals.items()}
    rounded_micro = {key: round(value, 4) for key, value in micro_totals.items()}
    return DailyTotals(micronutrients=rounded_micro, **rounded_totals)


def _totals_to_response(totals: DailyTotals) -> DailyTotalsResponse:
    return DailyTotalsResponse(
        energy_kcal=totals.energy_kcal,
        protein_g=totals.protein_g,
        carbs_g=totals.carbs_g,
        sugars_g=totals.sugars_g,
        fiber_g=totals.fiber_g,
        fat_g=totals.fat_g,
        sat_fat_g=totals.sat_fat_g,
        sodium_mg=totals.sodium_mg,
        micronutrients=totals.micronutrients,
    )


def _serialize_entry(row: MealEntry) -> MealEntryItem:
    return MealEntryItem(
        id=str(row.id),
        athlete_id=row.athlete_id,
        logged_by_user_id=str(row.logged_by_user_id),
        consumed_at=row.consumed_at.isoformat(),
        meal_slot=row.meal_slot,
        food_product_id=str(row.food_product_id) if row.food_product_id else None,
        food_name=row.food_name,
        quantity_g=row.quantity_g,
        quantity_value=row.quantity_value,
        quantity_unit=row.quantity_unit,
        energy_kcal=row.energy_kcal,
        protein_g=row.protein_g,
        carbs_g=row.carbs_g,
        sugars_g=row.sugars_g,
        fiber_g=row.fiber_g,
        fat_g=row.fat_g,
        sat_fat_g=row.sat_fat_g,
        sodium_mg=row.sodium_mg,
        micronutrients=row.micronutrients or {},
        notes=row.notes,
        created_at_utc=row.created_at_utc.isoformat(),
    )


def _snapshot_from_food_product(product: FoodProduct, quantity_g: float) -> dict[str, Any]:
    """Escala los macros/micros per-100g del catalogo a la cantidad consumida."""
    return {
        "food_name": product.name,
        "energy_kcal": scale_per_100g(product.energy_kcal, quantity_g),
        "protein_g": scale_per_100g(product.protein_g, quantity_g),
        "carbs_g": scale_per_100g(product.carbs_g, quantity_g),
        "sugars_g": scale_per_100g(product.sugars_g, quantity_g),
        "fiber_g": scale_per_100g(product.fiber_g, quantity_g),
        "fat_g": scale_per_100g(product.fat_g, quantity_g),
        "sat_fat_g": scale_per_100g(product.sat_fat_g, quantity_g),
        "sodium_mg": scale_per_100g(product.sodium_mg, quantity_g),
        "micronutrients": scale_micronutrients_per_100g(product.micronutrients, quantity_g),
    }


def _resolve_entry_quantity(
    *,
    quantity_g: float | None,
    quantity_value: float | None,
    quantity_unit: str | None,
    product: FoodProduct | None,
) -> tuple[float, float, str]:
    """Devuelve `(quantity_g normalizada, quantity_value, quantity_unit)` a guardar.

    La conversion la hace SIEMPRE el servidor: es el unico que conoce el
    `serving_size_g` del catalogo (necesario para `porcion`) y asi un cliente
    desactualizado no puede escribir un `quantity_g` que no cuadre con la
    unidad. Sin unidad se asume la base del alimento (g, o ml si es liquido),
    que es lo que venian mandando los clientes previos a este cambio.
    """
    if quantity_value is not None and quantity_unit is not None:
        try:
            grams = resolve_quantity_grams(
                quantity_value, quantity_unit, product.serving_size_g if product else None
            )
        except QuantityUnitError as err:
            raise HTTPException(status_code=422, detail=str(err)) from err
        return grams, quantity_value, quantity_unit

    if quantity_g is None:
        raise HTTPException(
            status_code=422, detail="quantity_g or quantity_value + quantity_unit is required."
        )
    return quantity_g, quantity_g, default_unit_for_basis(product.basis if product else None)


def _get_entry_or_404(db: DbSession, entry_id: uuid.UUID) -> MealEntry:
    row = db.get(MealEntry, entry_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Meal entry not found.")
    return row


def _find_meal_entry_by_client_ref(
    db: DbSession, athlete_id: str, client_ref: str
) -> MealEntry | None:
    return db.execute(
        select(MealEntry).where(
            MealEntry.athlete_id == athlete_id, MealEntry.client_ref == client_ref
        )
    ).scalar_one_or_none()


def _escape_like(value: str) -> str:
    """Neutraliza los comodines de LIKE (`%`, `_`) y el propio escape.

    `batch_ref` llega del cliente, asi que sin escapar el patron es suyo, no
    nuestro: un `client_ref` de "%" produce "%:%" y matchea TODAS las entradas
    por lote del atleta, con lo que un reintento devolveria las equivocadas en
    vez de crear las pedidas. Ademas `uid()` del frontend genera refs con "_",
    que en LIKE es comodin de un caracter.
    """
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _find_meal_entries_by_batch_ref(
    db: DbSession, athlete_id: str, batch_ref: str
) -> list[MealEntry]:
    return (
        db.execute(
            select(MealEntry)
            .where(
                MealEntry.athlete_id == athlete_id,
                MealEntry.client_ref.like(f"{_escape_like(batch_ref)}:%", escape="\\"),
            )
            .order_by(MealEntry.created_at_utc.asc())
        )
        .scalars()
        .all()
    )


@router.get("/entries", response_model=MealEntriesResponse)
def list_meal_entries(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
    date: Annotated[date_cls, Query()],
    athlete_id: str = Query(min_length=1, max_length=255),
) -> MealEntriesResponse:
    normalized = athlete_id.strip()
    require_athlete_access(db, user, normalized)

    start_utc, end_utc = _day_range_utc(date)
    rows = (
        db.execute(
            select(MealEntry)
            .where(
                MealEntry.athlete_id == normalized,
                MealEntry.consumed_at >= start_utc,
                MealEntry.consumed_at < end_utc,
            )
            .order_by(MealEntry.consumed_at.asc())
        )
        .scalars()
        .all()
    )
    totals = _aggregate_daily_totals(rows)
    return MealEntriesResponse(
        athlete_id=normalized,
        date=date.isoformat(),
        items=[_serialize_entry(row) for row in rows],
        totals=_totals_to_response(totals),
    )


@router.post("/entries", response_model=MealEntryItem, status_code=status.HTTP_201_CREATED)
def create_meal_entry(
    payload: MealEntryCreateRequest,
    response: Response,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> MealEntryItem:
    """Crea un registro de comida.

    Idempotencia (doc `modulo-dieta.md` #7 criterio 6): si `payload.client_ref`
    viene informado y ya existe una entrada de este atleta con ese ref, se
    devuelve esa entrada tal cual con 200 en vez de crear un duplicado. El
    outbox offline del frontend genera el `client_ref` al encolar (no al
    reintentar), asi que un timeout que ocurrio despues del commit del
    servidor no duplica la comida al reintentar. Sin `client_ref` el
    comportamiento es el de siempre: cada POST crea una entrada nueva.
    """
    athlete_id = payload.athlete_id.strip()
    require_athlete_access(db, user, athlete_id)
    _ensure_athlete_row(db, athlete_id)

    client_ref = (payload.client_ref or "").strip() or None
    if client_ref:
        existing = _find_meal_entry_by_client_ref(db, athlete_id, client_ref)
        if existing is not None:
            response.status_code = status.HTTP_200_OK
            return _serialize_entry(existing)

    consumed_at = _to_utc(payload.consumed_at or datetime.now(UTC))

    food_product_id: uuid.UUID | None = None
    product: FoodProduct | None = None
    snapshot: dict[str, Any]

    if payload.food_product_id:
        try:
            food_product_id = uuid.UUID(payload.food_product_id)
        except ValueError as err:
            raise HTTPException(status_code=400, detail="Invalid food_product_id.") from err
        product = db.get(FoodProduct, food_product_id)
        if product is None:
            raise HTTPException(status_code=404, detail="Food product not found.")

    quantity_g, quantity_value, quantity_unit = _resolve_entry_quantity(
        quantity_g=payload.quantity_g,
        quantity_value=payload.quantity_value,
        quantity_unit=payload.quantity_unit,
        product=product,
    )

    if product is not None:
        snapshot = _snapshot_from_food_product(product, quantity_g)
        if payload.food_name and payload.food_name.strip():
            snapshot["food_name"] = payload.food_name.strip()
    else:
        snapshot = {
            "food_name": (payload.food_name or "").strip(),
            "energy_kcal": payload.energy_kcal,
            "protein_g": payload.protein_g,
            "carbs_g": payload.carbs_g,
            "sugars_g": payload.sugars_g,
            "fiber_g": payload.fiber_g,
            "fat_g": payload.fat_g,
            "sat_fat_g": payload.sat_fat_g,
            "sodium_mg": payload.sodium_mg,
            "micronutrients": payload.micronutrients or {},
        }

    # Cualquier valor explicito del payload gana sobre lo calculado del catalogo:
    # el OCR/catalogo propone, el usuario siempre puede corregir.
    for key in _ENTRY_TOTAL_KEYS:
        override = getattr(payload, key)
        if override is not None:
            snapshot[key] = override
    if payload.micronutrients:
        snapshot["micronutrients"] = payload.micronutrients

    row = MealEntry(
        athlete_id=athlete_id,
        logged_by_user_id=user.id,
        consumed_at=consumed_at,
        meal_slot=payload.meal_slot,
        food_product_id=food_product_id,
        food_name=snapshot["food_name"],
        quantity_g=quantity_g,
        quantity_value=quantity_value,
        quantity_unit=quantity_unit,
        energy_kcal=snapshot["energy_kcal"],
        protein_g=snapshot["protein_g"],
        carbs_g=snapshot["carbs_g"],
        sugars_g=snapshot["sugars_g"],
        fiber_g=snapshot["fiber_g"],
        fat_g=snapshot["fat_g"],
        sat_fat_g=snapshot["sat_fat_g"],
        sodium_mg=snapshot["sodium_mg"],
        micronutrients=snapshot["micronutrients"] or None,
        notes=payload.notes,
        client_ref=client_ref,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError as err:
        db.rollback()
        # Carrera: otro request con el mismo client_ref ya comiteo entre el
        # chequeo de arriba y este commit. El indice unico parcial es la
        # garantia real; esto solo evita que la carrera se vea como error 500.
        if client_ref:
            existing = _find_meal_entry_by_client_ref(db, athlete_id, client_ref)
            if existing is not None:
                response.status_code = status.HTTP_200_OK
                return _serialize_entry(existing)
        raise HTTPException(status_code=409, detail="Duplicate meal entry.") from err
    db.refresh(row)
    return _serialize_entry(row)


@router.patch("/entries/{entry_id}", response_model=MealEntryItem)
def update_meal_entry(
    entry_id: uuid.UUID,
    payload: MealEntryUpdateRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> MealEntryItem:
    row = _get_entry_or_404(db, entry_id)
    require_athlete_access(db, user, row.athlete_id)

    sent = payload.model_fields_set

    quantity_sent = {"quantity_g", "quantity_value", "quantity_unit"} & sent
    if quantity_sent and (payload.quantity_g is not None or payload.quantity_value is not None):
        product = (
            db.get(FoodProduct, row.food_product_id) if row.food_product_id is not None else None
        )
        row.quantity_g, row.quantity_value, row.quantity_unit = _resolve_entry_quantity(
            quantity_g=payload.quantity_g,
            quantity_value=payload.quantity_value,
            quantity_unit=payload.quantity_unit,
            product=product,
        )
        if product is not None:
            snapshot = _snapshot_from_food_product(product, row.quantity_g)
            for key in _ENTRY_TOTAL_KEYS:
                setattr(row, key, snapshot[key])
            row.micronutrients = snapshot["micronutrients"] or None

    if "consumed_at" in sent and payload.consumed_at is not None:
        row.consumed_at = _to_utc(payload.consumed_at)
    if "meal_slot" in sent and payload.meal_slot is not None:
        row.meal_slot = payload.meal_slot
    if "food_name" in sent and payload.food_name is not None:
        cleaned = payload.food_name.strip()
        if cleaned:
            row.food_name = cleaned
    if "notes" in sent:
        row.notes = payload.notes

    for key in _ENTRY_TOTAL_KEYS:
        if key in sent:
            override = getattr(payload, key)
            if override is not None:
                setattr(row, key, override)
    if "micronutrients" in sent and payload.micronutrients is not None:
        row.micronutrients = payload.micronutrients or None

    db.commit()
    db.refresh(row)
    return _serialize_entry(row)


@router.delete("/entries/{entry_id}")
def delete_meal_entry(
    entry_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> dict:
    row = _get_entry_or_404(db, entry_id)
    require_athlete_access(db, user, row.athlete_id)
    db.delete(row)
    db.commit()
    return {"ok": True, "id": str(entry_id)}


@router.post(
    "/entries/from-preset", response_model=list[MealEntryItem], status_code=status.HTTP_201_CREATED
)
def create_entries_from_preset(
    payload: MealEntryFromPresetRequest,
    response: Response,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
) -> list[MealEntryItem]:
    """Crea N registros de comida a partir de un preset (uno por item).

    Idempotencia: a diferencia de `create_meal_entry`, aqui `client_ref` es
    un ref de LOTE (uno por intento de guardado del outbox), no uno por item.
    Se eligio asi porque un preset tiene un numero variable de items y el
    cliente offline solo conoce un client_ref por envio -- pedirle N refs
    (uno por item) complicaria el outbox sin necesidad. Cada entrada creada
    guarda un client_ref derivado `f"{batch_ref}:{indice_del_item}"`, unico
    por atleta gracias al mismo indice parcial de `meal_entries` que usa el
    endpoint singular. Un reintento con el mismo `client_ref` de lote busca
    las entradas ya creadas con ese prefijo y las devuelve tal cual con 200,
    sin duplicar -- siempre que el preset no haya cambiado de items entre el
    intento original y el reintento (asuncion razonable para un reintento
    offline en la misma sesion). Sin `client_ref` el comportamiento es el de
    siempre.
    """
    athlete_id = payload.athlete_id.strip()
    require_athlete_access(db, user, athlete_id)
    _ensure_athlete_row(db, athlete_id)

    try:
        preset_id = uuid.UUID(payload.preset_id)
    except ValueError as err:
        raise HTTPException(status_code=400, detail="Invalid preset_id.") from err

    preset = db.execute(
        select(MealPreset).where(MealPreset.id == preset_id, MealPreset.owner_user_id == user.id)
    ).scalar_one_or_none()
    if preset is None:
        raise HTTPException(status_code=404, detail="Preset not found.")

    items = preset.items or []
    if not items:
        raise HTTPException(status_code=400, detail="Preset has no items.")

    batch_ref = (payload.client_ref or "").strip() or None
    if batch_ref:
        existing = _find_meal_entries_by_batch_ref(db, athlete_id, batch_ref)
        if existing:
            response.status_code = status.HTTP_200_OK
            return [_serialize_entry(row) for row in existing]

    consumed_at = _to_utc(payload.consumed_at or datetime.now(UTC))
    meal_slot = payload.meal_slot or preset.meal_slot or "snack"

    created: list[MealEntry] = []
    for index, item in enumerate(items):
        quantity_g = float(item.get("quantity_g") or 0)
        if quantity_g <= 0:
            continue

        food_product_id: uuid.UUID | None = None
        raw_food_product_id = item.get("food_product_id")
        if raw_food_product_id:
            try:
                food_product_id = uuid.UUID(str(raw_food_product_id))
            except ValueError:
                food_product_id = None

        row = MealEntry(
            athlete_id=athlete_id,
            logged_by_user_id=user.id,
            consumed_at=consumed_at,
            meal_slot=meal_slot,
            food_product_id=food_product_id,
            food_name=str(item.get("food_name") or "Alimento"),
            quantity_g=quantity_g,
            quantity_value=item.get("quantity_value"),
            quantity_unit=item.get("quantity_unit"),
            energy_kcal=item.get("energy_kcal"),
            protein_g=item.get("protein_g"),
            carbs_g=item.get("carbs_g"),
            sugars_g=item.get("sugars_g"),
            fiber_g=item.get("fiber_g"),
            fat_g=item.get("fat_g"),
            sat_fat_g=item.get("sat_fat_g"),
            sodium_mg=item.get("sodium_mg"),
            micronutrients=item.get("micronutrients") or None,
            client_ref=f"{batch_ref}:{index}" if batch_ref else None,
        )
        db.add(row)
        created.append(row)

    if not created:
        raise HTTPException(status_code=400, detail="Preset has no valid items.")

    try:
        db.commit()
    except IntegrityError as err:
        db.rollback()
        # Carrera equivalente a la de create_meal_entry, a nivel de lote.
        if batch_ref:
            existing = _find_meal_entries_by_batch_ref(db, athlete_id, batch_ref)
            if existing:
                response.status_code = status.HTTP_200_OK
                return [_serialize_entry(row) for row in existing]
        raise HTTPException(status_code=409, detail="Duplicate preset submission.") from err
    for row in created:
        db.refresh(row)
    return [_serialize_entry(row) for row in created]


@router.get("/summary", response_model=DietSummaryResponse)
def get_diet_summary(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DbSession, Depends(get_db)],
    from_: Annotated[date_cls, Query(alias="from")],
    to: Annotated[date_cls, Query(alias="to")],
    athlete_id: str = Query(min_length=1, max_length=255),
) -> DietSummaryResponse:
    normalized = athlete_id.strip()
    require_athlete_access(db, user, normalized)

    if to < from_:
        raise HTTPException(status_code=400, detail="'to' must not be before 'from'.")
    span_days = (to - from_).days + 1
    if span_days > _MAX_SUMMARY_DAYS:
        raise HTTPException(
            status_code=400, detail=f"Range too large (max {_MAX_SUMMARY_DAYS} days)."
        )

    start_utc, _unused_end = _day_range_utc(from_)
    _unused_start, end_utc = _day_range_utc(to)

    rows = (
        db.execute(
            select(MealEntry)
            .where(
                MealEntry.athlete_id == normalized,
                MealEntry.consumed_at >= start_utc,
                MealEntry.consumed_at < end_utc,
            )
            .order_by(MealEntry.consumed_at.asc())
        )
        .scalars()
        .all()
    )

    by_day: dict[date_cls, list[MealEntry]] = {}
    for row in rows:
        day = row.consumed_at.astimezone(UTC).date()
        by_day.setdefault(day, []).append(row)

    days: list[DietSummaryDayItem] = []
    cursor = from_
    while cursor <= to:
        entries = by_day.get(cursor, [])
        days.append(
            DietSummaryDayItem(
                date=cursor.isoformat(),
                totals=_totals_to_response(_aggregate_daily_totals(entries)),
            )
        )
        cursor += timedelta(days=1)

    return DietSummaryResponse(
        athlete_id=normalized,
        from_date=from_.isoformat(),
        to_date=to.isoformat(),
        days=days,
    )


# --------------------------------------------------------------------------
