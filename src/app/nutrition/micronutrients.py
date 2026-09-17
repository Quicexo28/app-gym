"""Registro canonico de micronutrientes.

Unica fuente de verdad para claves, unidades, RDA (adulto de referencia) y
limite superior seguro (upper_limit). Se expone via
`GET /diet/micronutrients` para que el frontend no duplique la tabla, y lo
usa `app.nutrition.mapping` para saber en que unidad debe quedar cada valor
convertido desde Open Food Facts.

Valores de referencia tomados de las Dietary Reference Intakes (NIH/EFSA)
para un adulto promedio; son un default razonable, no una recomendacion
clinica personalizada. `upper_limit` queda en None cuando no hay un limite
superior tolerable establecido.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class MicronutrientDefinition:
    key: str
    label: str
    unit: str
    rda: float
    upper_limit: float | None


MICRONUTRIENTS: tuple[MicronutrientDefinition, ...] = (
    MicronutrientDefinition("vitamin_a_ug", "Vitamina A", "ug", 900.0, 3000.0),
    MicronutrientDefinition("vitamin_c_mg", "Vitamina C", "mg", 90.0, 2000.0),
    MicronutrientDefinition("vitamin_d_ug", "Vitamina D", "ug", 20.0, 100.0),
    MicronutrientDefinition("vitamin_e_mg", "Vitamina E", "mg", 15.0, 1000.0),
    MicronutrientDefinition("vitamin_k_ug", "Vitamina K", "ug", 120.0, None),
    MicronutrientDefinition("thiamin_mg", "Tiamina (B1)", "mg", 1.2, None),
    MicronutrientDefinition("riboflavin_mg", "Riboflavina (B2)", "mg", 1.3, None),
    MicronutrientDefinition("niacin_mg", "Niacina (B3)", "mg", 16.0, 35.0),
    MicronutrientDefinition("vitamin_b6_mg", "Vitamina B6", "mg", 1.7, 100.0),
    MicronutrientDefinition("folate_ug", "Folato", "ug", 400.0, 1000.0),
    MicronutrientDefinition("vitamin_b12_ug", "Vitamina B12", "ug", 2.4, None),
    MicronutrientDefinition("calcium_mg", "Calcio", "mg", 1300.0, 2500.0),
    MicronutrientDefinition("iron_mg", "Hierro", "mg", 18.0, 45.0),
    # El UL de 350 mg del magnesio aplica SOLO al magnesio suplementario, no al
    # dietario (NIH ODS). Dejarlo aqui marcaria como "excedido" a cualquiera que
    # cumpla su RDA de 420 mg comiendo normal: falsa alarma diaria para todos.
    MicronutrientDefinition("magnesium_mg", "Magnesio", "mg", 420.0, None),
    MicronutrientDefinition("phosphorus_mg", "Fosforo", "mg", 1250.0, 4000.0),
    MicronutrientDefinition("potassium_mg", "Potasio", "mg", 4700.0, None),
    MicronutrientDefinition("zinc_mg", "Zinc", "mg", 11.0, 40.0),
    MicronutrientDefinition("copper_mg", "Cobre", "mg", 0.9, 10.0),
    MicronutrientDefinition("manganese_mg", "Manganeso", "mg", 2.3, 11.0),
    MicronutrientDefinition("selenium_ug", "Selenio", "ug", 55.0, 400.0),
    MicronutrientDefinition("iodine_ug", "Yodo", "ug", 150.0, 1100.0),
)

MICRONUTRIENTS_BY_KEY: dict[str, MicronutrientDefinition] = {
    item.key: item for item in MICRONUTRIENTS
}

MICRONUTRIENT_KEYS: frozenset[str] = frozenset(MICRONUTRIENTS_BY_KEY)


def get_micronutrient(key: str) -> MicronutrientDefinition | None:
    return MICRONUTRIENTS_BY_KEY.get(key)
