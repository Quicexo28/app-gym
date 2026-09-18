"""Unidades de cantidad para los registros de comida.

La base de datos guarda SIEMPRE la cantidad normalizada a la unidad base del
alimento (`meal_entries.quantity_g`: gramos si el `basis` es `per_100g`,
mililitros si es `per_100ml`), porque los macros del catalogo vienen
normalizados a 100 de esa misma unidad (ver `mapping.scale_per_100g`). Lo que
el usuario escribio se guarda aparte (`quantity_value` + `quantity_unit`) solo
para poder mostrarlo y volver a editarlo en la unidad en que lo penso, sin
tocar la aritmetica nutricional.

Este modulo es el UNICO lugar donde vive la tabla de conversion del backend.
Tiene un espejo exacto en `frontend/src/lib/nutrition/units.ts` (que solo la
usa para previsualizar); si aqui cambia un factor, alla tambien.

Las unidades de volumen aplicadas a un alimento solido asumen densidad 1
(1 ml -> 1 g). Es la aproximacion estandar de las apps de nutricion: una taza
de arroz no pesa 240 g, pero el usuario que elige "taza" esta dando una
estimacion, no una medida de bascula. Quien necesite exactitud usa gramos.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, get_args

UnitKind = Literal["mass", "volume", "serving"]

#: Claves validas, en un `Literal` para que Pydantic rechace lo demas con 422.
#: Debe coincidir con `QUANTITY_UNITS` (lo garantiza el assert de abajo).
QuantityUnitKey = Literal[
    "g",
    "kg",
    "oz",
    "lb",
    "ml",
    "l",
    "fl_oz",
    "taza",
    "cucharada",
    "cucharadita",
    "porcion",
]

# Tope duro de la cantidad ya convertida. Coincide con el `le=5000` que las
# columnas en gramos vienen validando desde el inicio del modulo.
MAX_QUANTITY_G = 5000.0


@dataclass(frozen=True)
class QuantityUnit:
    """Una unidad seleccionable al registrar cuanto se comio."""

    key: str
    #: Etiqueta corta en espanol, lista para la UI.
    label: str
    kind: UnitKind
    #: Cuantas unidades base (g/ml) es una. `None` = depende del alimento.
    grams: float | None


QUANTITY_UNITS: tuple[QuantityUnit, ...] = (
    QuantityUnit("g", "g", "mass", 1.0),
    QuantityUnit("kg", "kg", "mass", 1000.0),
    QuantityUnit("oz", "oz", "mass", 28.349523125),
    QuantityUnit("lb", "lb", "mass", 453.59237),
    QuantityUnit("ml", "ml", "volume", 1.0),
    QuantityUnit("l", "L", "volume", 1000.0),
    QuantityUnit("fl_oz", "oz liq", "volume", 29.5735295625),
    QuantityUnit("taza", "taza", "volume", 240.0),
    QuantityUnit("cucharada", "cda", "volume", 15.0),
    QuantityUnit("cucharadita", "cdta", "volume", 5.0),
    # El factor sale de `food_products.serving_size_g`, no de una constante.
    QuantityUnit("porcion", "porcion", "serving", None),
)

QUANTITY_UNITS_BY_KEY: dict[str, QuantityUnit] = {unit.key: unit for unit in QUANTITY_UNITS}

assert set(get_args(QuantityUnitKey)) == set(QUANTITY_UNITS_BY_KEY), (
    "QuantityUnitKey y QUANTITY_UNITS quedaron desfasados."
)

#: Unidad por defecto cuando el cliente manda `quantity_g` a secas (clientes
#: viejos y el outbox offline encolado antes de este cambio).
DEFAULT_MASS_UNIT = "g"
DEFAULT_VOLUME_UNIT = "ml"


class QuantityUnitError(ValueError):
    """La cantidad no se puede convertir a la unidad base del alimento."""


def default_unit_for_basis(basis: str | None) -> str:
    """Unidad implicita de un `quantity_g` sin unidad: ml para liquidos, g para el resto."""
    return DEFAULT_VOLUME_UNIT if basis == "per_100ml" else DEFAULT_MASS_UNIT


def resolve_quantity_grams(
    value: float,
    unit: str,
    serving_size_g: float | None = None,
) -> float:
    """Convierte `value` en `unit` a la unidad base del alimento (g/ml).

    `serving_size_g` solo se usa para `porcion` y es obligatorio ahi: sin
    tamano de porcion en el catalogo, "2 porciones" no significa nada
    convertible y es mejor rechazarlo que inventar un numero.
    """
    definition = QUANTITY_UNITS_BY_KEY.get(unit)
    if definition is None:
        raise QuantityUnitError(f"Unknown quantity unit: {unit!r}.")

    factor = definition.grams
    if factor is None:
        if not serving_size_g or serving_size_g <= 0:
            raise QuantityUnitError(
                "This food has no serving size, so quantities in servings are not available."
            )
        factor = serving_size_g

    grams = value * factor
    if grams <= 0:
        raise QuantityUnitError("Quantity must be greater than zero.")
    if grams > MAX_QUANTITY_G:
        raise QuantityUnitError(f"Quantity is too large (max {MAX_QUANTITY_G:g} g/ml).")
    # 4 decimales: suficiente para que 1 cucharadita no pierda precision y no
    # tanto como para arrastrar ruido de coma flotante al snapshot de macros.
    return round(grams, 4)
