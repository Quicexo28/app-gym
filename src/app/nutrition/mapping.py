"""Mapeo de nutrientes Open Food Facts -> columnas/claves canonicas propias.

**Punto mas delicado del backend de dieta.** OFF entrega macros en gramos
(coinciden con nuestras columnas `*_g`), pero entrega sodio, colesterol y
TODOS los micronutrientes en gramos tambien, mientras nosotros los
almacenamos en mg o ug. Un factor equivocado produce valores 1000x errados
que no se notan en la UI hasta que alguien hace un calculo serio.

Los factores de conversion viven en un UNICO dict (`UNIT_CONVERSION_FACTORS`)
para que un bug de unidades sea imposible de introducir por accidente en un
solo campo sin romper todos los demas que comparten esa clase de conversion.
Cubierto por tests exhaustivos en `tests/test_diet_mapping.py`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

# Unica fuente de verdad para los factores de conversion de unidad. OFF
# entrega gramos; nosotros guardamos miligramos o microgramos.
UNIT_CONVERSION_FACTORS: dict[str, float] = {
    "direct": 1.0,  # ya viene en la unidad correcta (g o kcal)
    "g_to_mg": 1_000.0,  # gramos -> miligramos
    "g_to_ug": 1_000_000.0,  # gramos -> microgramos
}

KJ_TO_KCAL_DIVISOR = 4.184


@dataclass(frozen=True, slots=True)
class OffFieldMapping:
    """Regla de mapeo de un campo `nutriments` de OFF a nuestra clave canonica."""

    target: str  # nombre de columna de food_products o clave de micronutrients
    conversion: str  # clave en UNIT_CONVERSION_FACTORS


# Macros: columnas explicitas de food_products, todas per-100g/ml.
MACRO_FIELD_MAP: dict[str, OffFieldMapping] = {
    "energy-kcal_100g": OffFieldMapping("energy_kcal", "direct"),
    "proteins_100g": OffFieldMapping("protein_g", "direct"),
    "carbohydrates_100g": OffFieldMapping("carbs_g", "direct"),
    "sugars_100g": OffFieldMapping("sugars_g", "direct"),
    "fiber_100g": OffFieldMapping("fiber_g", "direct"),
    "fat_100g": OffFieldMapping("fat_g", "direct"),
    "saturated-fat_100g": OffFieldMapping("sat_fat_g", "direct"),
    "trans-fat_100g": OffFieldMapping("trans_fat_g", "direct"),
    "sodium_100g": OffFieldMapping("sodium_mg", "g_to_mg"),
    "cholesterol_100g": OffFieldMapping("cholesterol_mg", "g_to_mg"),
}

# Micronutrientes: claves del registro canonico (app.nutrition.micronutrients),
# guardadas en el JSON `micronutrients`. Todas llegan de OFF en gramos.
MICRO_FIELD_MAP: dict[str, OffFieldMapping] = {
    "vitamin-a_100g": OffFieldMapping("vitamin_a_ug", "g_to_ug"),
    "vitamin-c_100g": OffFieldMapping("vitamin_c_mg", "g_to_mg"),
    "vitamin-d_100g": OffFieldMapping("vitamin_d_ug", "g_to_ug"),
    "vitamin-e_100g": OffFieldMapping("vitamin_e_mg", "g_to_mg"),
    "vitamin-k_100g": OffFieldMapping("vitamin_k_ug", "g_to_ug"),
    "vitamin-b1_100g": OffFieldMapping("thiamin_mg", "g_to_mg"),
    "vitamin-b2_100g": OffFieldMapping("riboflavin_mg", "g_to_mg"),
    "vitamin-pp_100g": OffFieldMapping("niacin_mg", "g_to_mg"),  # OFF llama "pp" a la niacina (B3)
    "vitamin-b6_100g": OffFieldMapping("vitamin_b6_mg", "g_to_mg"),
    "folate_100g": OffFieldMapping("folate_ug", "g_to_ug"),
    "vitamin-b12_100g": OffFieldMapping("vitamin_b12_ug", "g_to_ug"),
    "calcium_100g": OffFieldMapping("calcium_mg", "g_to_mg"),
    "iron_100g": OffFieldMapping("iron_mg", "g_to_mg"),
    "magnesium_100g": OffFieldMapping("magnesium_mg", "g_to_mg"),
    "phosphorus_100g": OffFieldMapping("phosphorus_mg", "g_to_mg"),
    "potassium_100g": OffFieldMapping("potassium_mg", "g_to_mg"),
    "zinc_100g": OffFieldMapping("zinc_mg", "g_to_mg"),
    "copper_100g": OffFieldMapping("copper_mg", "g_to_mg"),
    "manganese_100g": OffFieldMapping("manganese_mg", "g_to_mg"),
    "selenium_100g": OffFieldMapping("selenium_ug", "g_to_ug"),
    "iodine_100g": OffFieldMapping("iodine_ug", "g_to_ug"),
}

MACRO_TARGET_KEYS: tuple[str, ...] = tuple(mapping.target for mapping in MACRO_FIELD_MAP.values())


def _to_float(raw: Any) -> float | None:
    """Convierte un valor crudo de OFF (str/int/float/None) a float, o None si no aplica."""
    if raw is None or isinstance(raw, bool):
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def map_off_nutriments_to_canonical(
    nutriments: dict[str, Any] | None,
) -> tuple[dict[str, float | None], dict[str, float]]:
    """Traduce `nutriments` (OFF, per-100g/ml, siempre en gramos) a:

    - un dict de columnas de macros (`energy_kcal`, `protein_g`, ... con las
      conversiones de sodio/colesterol ya aplicadas), con None para lo que
      falte en el origen;
    - un dict de micronutrientes canonicos ya convertidos a mg/ug.

    Si falta `energy-kcal_100g` pero existe `energy-kj_100g`, calcula
    kcal = kJ / 4.184.
    """
    source = nutriments or {}

    macros: dict[str, float | None] = dict.fromkeys(MACRO_TARGET_KEYS)
    for off_key, field in MACRO_FIELD_MAP.items():
        value = _to_float(source.get(off_key))
        if value is None:
            continue
        macros[field.target] = value * UNIT_CONVERSION_FACTORS[field.conversion]

    if macros.get("energy_kcal") is None:
        kj = _to_float(source.get("energy-kj_100g"))
        if kj is not None:
            macros["energy_kcal"] = kj / KJ_TO_KCAL_DIVISOR

    micronutrients: dict[str, float] = {}
    for off_key, field in MICRO_FIELD_MAP.items():
        value = _to_float(source.get(off_key))
        if value is None:
            continue
        micronutrients[field.target] = value * UNIT_CONVERSION_FACTORS[field.conversion]

    return macros, micronutrients


def scale_per_100g(value: float | None, quantity_g: float) -> float | None:
    """Escala un valor normalizado a 100 g/ml a la cantidad realmente consumida."""
    if value is None:
        return None
    return value * (quantity_g / 100.0)


def scale_micronutrients_per_100g(
    values: dict[str, float] | None, quantity_g: float
) -> dict[str, float]:
    """Version en lote de `scale_per_100g` para el dict de micronutrientes."""
    if not values:
        return {}
    factor = quantity_g / 100.0
    return {key: value * factor for key, value in values.items()}
