/**
 * Unidades de cantidad al registrar una comida.
 *
 * ESPEJO EXACTO de `src/app/nutrition/units.py`. El backend es el que convierte
 * de verdad (es el único que conoce el `serving_size_g` del catálogo); esta
 * copia existe para dos cosas que tienen que funcionar sin red: poblar el
 * selector de unidades y previsualizar los macros mientras se escribe. Si alla
 * cambia un factor, aquí también.
 *
 * Funcion pura, como el resto de este directorio: sin `fetch`, sin React.
 *
 * Las unidades de volumen sobre un alimento solido asumen densidad 1
 * (1 ml -> 1 g). Es una estimacion deliberada: quien elige "taza" no esta
 * pesando; quien necesita exactitud usa gramos.
 */

import type { FoodBasis } from "../../api";

export type QuantityUnitKey =
  | "g"
  | "kg"
  | "oz"
  | "lb"
  | "ml"
  | "l"
  | "fl_oz"
  | "taza"
  | "cucharada"
  | "cucharadita"
  | "porcion";

export type QuantityUnitKind = "mass" | "volume" | "serving";

export type QuantityUnitDef = {
  key: QuantityUnitKey;
  /** Etiqueta corta para el selector. */
  label: string;
  kind: QuantityUnitKind;
  /** Cuantas unidades base (g/ml) es una. `null` = sale del `serving_size_g` del alimento. */
  grams: number | null;
};

/** Tope duro de la cantidad ya convertida, igual al del backend. */
export const MAX_QUANTITY_G = 5000;

export const QUANTITY_UNITS: QuantityUnitDef[] = [
  { key: "g", label: "g", kind: "mass", grams: 1 },
  { key: "kg", label: "kg", kind: "mass", grams: 1000 },
  { key: "oz", label: "oz", kind: "mass", grams: 28.349523125 },
  { key: "lb", label: "lb", kind: "mass", grams: 453.59237 },
  { key: "ml", label: "ml", kind: "volume", grams: 1 },
  { key: "l", label: "L", kind: "volume", grams: 1000 },
  { key: "fl_oz", label: "oz liq", kind: "volume", grams: 29.5735295625 },
  { key: "taza", label: "taza", kind: "volume", grams: 240 },
  { key: "cucharada", label: "cda", kind: "volume", grams: 15 },
  { key: "cucharadita", label: "cdta", kind: "volume", grams: 5 },
  { key: "porcion", label: "porcion", kind: "serving", grams: null },
];

const UNITS_BY_KEY = new Map<string, QuantityUnitDef>(QUANTITY_UNITS.map((unit) => [unit.key, unit]));

export function quantityUnitDef(key: string | null | undefined): QuantityUnitDef | null {
  return (key && UNITS_BY_KEY.get(key)) || null;
}

/** Unidad base implicita de un alimento: ml si es liquido, g si no. */
export function defaultUnitForBasis(basis: FoodBasis | null | undefined): QuantityUnitKey {
  return basis === "per_100ml" ? "ml" : "g";
}

const PURE_VOLUME_KEYS = new Set<QuantityUnitKey>(["ml", "l", "fl_oz"]);

/**
 * Unidades que tiene sentido ofrecer para un alimento.
 *
 * Con `basis` conocido se muestra su propia familia (masa para solidos,
 * volumen para liquidos) más las de cocina, que aplican a las dos. Sin `basis`
 * -- un alimento manual, o una entrada ya registrada de la que solo se conoce
 * la unidad -- se ofrecen todas: no hay dato para descartar ninguna, y esconder
 * "ml" a quien esta anotando un jugo casero es peor que ofrecer de más.
 *
 * `porcion` solo aparece si se sabe cuanto pesa una: sin ese dato la
 * conversion no existe y el backend la rechazaria.
 */
export function unitsForFood(options: {
  basis?: FoodBasis | null;
  servingSizeG?: number | null;
}): QuantityUnitDef[] {
  const hasServing = Boolean(options.servingSizeG && options.servingSizeG > 0);
  return QUANTITY_UNITS.filter((unit) => {
    if (unit.kind === "serving") return hasServing;
    if (!options.basis) return true;
    if (unit.kind === "mass") return options.basis !== "per_100ml";
    if (PURE_VOLUME_KEYS.has(unit.key)) return options.basis === "per_100ml";
    return true; // taza / cda / cdta: sirven para ambos
  });
}

/**
 * Base probable de un alimento deducida de la unidad en que se registro.
 *
 * Solo para entradas ya guardadas, que no traen el `basis` del catálogo.
 * `null` cuando la unidad no distingue (cocina o porcion).
 */
export function basisFromUnit(unit: string | null | undefined): FoodBasis | null {
  const definition = quantityUnitDef(unit);
  if (!definition) return null;
  if (definition.kind === "mass") return "per_100g";
  if (PURE_VOLUME_KEYS.has(definition.key)) return "per_100ml";
  return null;
}

/** Etiqueta de la unidad base en la que quedan guardados los macros: "g" o "ml". */
export function baseUnitLabel(basis: FoodBasis | null | undefined, unit?: string | null): string {
  if (basis) return basis === "per_100ml" ? "ml" : "g";
  return quantityUnitDef(unit)?.kind === "volume" ? "ml" : "g";
}

/**
 * Convierte a la unidad base del alimento (g/ml). `null` si no se puede: unidad
 * desconocida, valor no positivo, `porcion` sin tamano de porcion, o resultado
 * por encima del tope. Misma regla que `resolve_quantity_grams` del backend.
 */
export function toBaseQuantity(
  value: number,
  unit: string,
  servingSizeG?: number | null,
): number | null {
  const definition = quantityUnitDef(unit);
  if (!definition || !Number.isFinite(value)) return null;

  let factor = definition.grams;
  if (factor === null) {
    if (!servingSizeG || servingSizeG <= 0) return null;
    factor = servingSizeG;
  }

  const grams = value * factor;
  if (grams <= 0 || grams > MAX_QUANTITY_G) return null;
  return Math.round(grams * 10000) / 10000;
}

/** Número sin ceros de relleno: `1.5` -> "1.5", `2.0` -> "2". */
function formatAmount(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * Texto de la cantidad de una entrada ya registrada, en la unidad en que se
 * escribio. Las entradas anteriores a las unidades no la traen: ahi se cae a
 * `quantity_g` en gramos, que es como se venia mostrando.
 */
export function formatQuantity(entry: {
  quantity_g: number;
  quantity_value?: number | null;
  quantity_unit?: string | null;
}): string {
  const definition = quantityUnitDef(entry.quantity_unit);
  if (definition && entry.quantity_value != null) {
    const amount = formatAmount(entry.quantity_value);
    if (definition.kind === "serving") {
      return `${amount} ${entry.quantity_value === 1 ? "porcion" : "porciones"}`;
    }
    return `${amount} ${definition.label}`;
  }
  return `${formatAmount(entry.quantity_g)} g`;
}
