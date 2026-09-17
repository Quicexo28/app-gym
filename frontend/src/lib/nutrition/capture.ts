/**
 * Logica pura del flujo de captura de alimentos (doc `modulo-dieta.md` #6.5):
 * que hacer con el resultado de un escaneo de código de barras, si un
 * alimento nuevo entra al catálogo compartido o queda personal, y como
 * convertir la salida del parser de etiquetas en un prellenado de
 * formulario. Sin red, sin DOM, sin React: fácil de probar en aislamiento
 * (ver `capture.test.ts`). `barcode.ts`/`ocr.ts`/`photoCapture.ts` cubren la
 * parte con efectos (camara, plugins nativos); este archivo NO.
 */

import type { FoodBasis } from "../../api";
import type { ConfidenceLevel, MacroKey, ParsedField, ParsedLabel } from "./types";

// ---------------------------------------------------------------------------
// Barcode -> busqueda: que hacer con la respuesta de GET /diet/foods/barcode/{barcode}
// ---------------------------------------------------------------------------

export type BarcodeLookupOutcome = { kind: "found" } | { kind: "not-found" } | { kind: "error"; message: string };

/**
 * Traduce el resultado (o rechazo) de `getDietFoodByBarcode` a una decisión
 * de flujo. El backend devuelve 404 solo cuando el producto no existe ni
 * localmente ni en Open Food Facts (ver `get_food_by_barcode`) — ese es el
 * único caso que dispara "Registro por foto" (doc #6.5). Cualquier otro
 * código de error es un fallo real (red, servidor) y hay que mostrarlo, no
 * tratarlo como "no existe".
 */
export function classifyBarcodeLookup(
  outcome: { ok: true } | { ok: false; status: number; message: string },
): BarcodeLookupOutcome {
  if (outcome.ok) return { kind: "found" };
  if (outcome.status === 404) return { kind: "not-found" };
  return { kind: "error", message: outcome.message || "No se pudo buscar el código de barras." };
}

export type CaptureStep = "confirm-quantity" | "photo-capture" | "scan-error";

/** Paso siguiente del flujo de captura (doc #6.5, diagrama "Flujo de captura completo"). */
export function nextCaptureStep(outcome: BarcodeLookupOutcome): CaptureStep {
  if (outcome.kind === "found") return "confirm-quantity";
  if (outcome.kind === "not-found") return "photo-capture";
  return "scan-error";
}

// ---------------------------------------------------------------------------
// Catálogo compartido vs alimento personal
// ---------------------------------------------------------------------------

export type FoodOwnershipDecision = {
  /** Si es `true`, el backend crea el producto con `owner_user_id=null` y `status='pending'` (doc #5). */
  contributesToSharedCatalog: boolean;
  noteEs: string;
};

/**
 * Espeja la regla de negocio del backend (`create_food_product`, doc #5): un
 * producto con barcode se aporta al catálogo compartido (status 'pending',
 * visible para todos); sin barcode queda como alimento personal del usuario.
 * La decisión REAL la toma el backend con la misma regla — esta funcion solo
 * decide que nota mostrar en el formulario antes de guardar.
 */
export function decideFoodOwnership(barcode: string | null | undefined): FoodOwnershipDecision {
  const clean = (barcode ?? "").trim();
  if (clean) {
    return {
      contributesToSharedCatalog: true,
      noteEs: "Se guardara en el catálogo compartido, marcado como «sin verificar» hasta que otro usuario lo confirme.",
    };
  }
  return {
    contributesToSharedCatalog: false,
    noteEs: "Queda como alimento personal. Puedes agregarle un código de barras más adelante.",
  };
}

// ---------------------------------------------------------------------------
// Prellenado del formulario desde el resultado del parser de etiquetas
// ---------------------------------------------------------------------------

/**
 * Claves del formulario de captura por foto — coinciden 1:1 con los campos
 * numericos de `FoodProductCreatePayload` (`../../api`) para poder asignarlas
 * directamente al payload sin traducir nombres.
 */
export type PhotoFormMacroKey =
  | "energy_kcal"
  | "protein_g"
  | "carbs_g"
  | "sugars_g"
  | "fiber_g"
  | "fat_g"
  | "sat_fat_g"
  | "sodium_mg";

export const PHOTO_FORM_MACRO_KEYS: readonly PhotoFormMacroKey[] = [
  "energy_kcal",
  "protein_g",
  "carbs_g",
  "sugars_g",
  "fiber_g",
  "fat_g",
  "sat_fat_g",
  "sodium_mg",
];

export type PhotoFormMacroValues = Partial<Record<PhotoFormMacroKey, ParsedField>>;

export type LabelPrefill = {
  basis: FoodBasis;
  values: PhotoFormMacroValues;
  /**
   * `true` cuando el parser leyo la etiqueta "por porcion" pero no pudo
   * normalizar a 100 unidades (porcion desconocida, declarada en una unidad
   * no-gramo, o base indeterminada). En ese caso NO se inventa la
   * normalizacion (regla de UX del doc #6.5: "preferir el dato ausente al
   * dato inventado") — el formulario debe pedir el tamano de porcion al
   * usuario y los campos de macros quedan vacios en vez de prellenados con un
   * calculo no confiable.
   */
  needsServingSize: boolean;
};

const MACRO_TO_FORM_FIELD: ReadonlyArray<readonly [MacroKey, PhotoFormMacroKey]> = [
  ["energyKcal", "energy_kcal"],
  ["proteinG", "protein_g"],
  ["carbsTotalG", "carbs_g"],
  ["sugarsG", "sugars_g"],
  ["fiberG", "fiber_g"],
  ["fatTotalG", "fat_g"],
  ["fatSaturatedG", "sat_fat_g"],
  ["sodiumMg", "sodium_mg"],
];

/**
 * Convierte `ParsedLabel.normalizedTo100` — la ÚNICA fuente válida de
 * valores "por 100 unidades" que produce el parser — en un prellenado de
 * formulario. Nunca lee `ParsedLabel.macros` directamente: esos valores
 * pueden estar en base "por porcion" sin normalizar, y usarlos tal cual
 * guardaria números incorrectos en el catálogo compartido.
 */
export function buildLabelPrefill(label: ParsedLabel): LabelPrefill {
  const basis: FoodBasis = label.base === "per_100ml" ? "per_100ml" : "per_100g";
  const hasNormalizedValues = Object.keys(label.normalizedTo100).length > 0;
  const needsServingSize = label.base !== "per_100g" && label.base !== "per_100ml" && !hasNormalizedValues;

  const values: PhotoFormMacroValues = {};
  if (!needsServingSize) {
    for (const [macroKey, formKey] of MACRO_TO_FORM_FIELD) {
      const field = label.normalizedTo100[macroKey];
      if (field) values[formKey] = field;
    }
  }

  return { basis, values, needsServingSize };
}

export const CONFIDENCE_LABEL_ES: Record<ConfidenceLevel, string> = {
  high: "alta",
  medium: "media",
  low: "baja",
};
