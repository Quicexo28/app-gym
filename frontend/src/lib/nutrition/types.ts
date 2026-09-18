/**
 * Tipos compartidos del parser de etiquetas nutricionales.
 *
 * Todo lo de este directorio relacionado con el parser es funcion pura: sin
 * `fetch`, sin React, sin `Date.now()` ni estado global. Ver `labelParser.ts`.
 */

/** Nivel de confianza que el parser asigna a cada valor extraido. */
export type ConfidenceLevel = "high" | "medium" | "low";

/**
 * Base sobre la que vienen los valores leidos de la etiqueta.
 *
 * `per_100g` / `per_100ml` son las dos bases "de primera clase" del modelo de
 * datos (doc `modulo-dieta.md` #2.1, columna `basis`): ya vienen normalizadas
 * a 100 unidades, no requieren ningun calculo. `per_serving` es la lectura
 * cruda de una sola columna «por porción», previa a normalizar.
 *
 * Toda la categoria liquida colombiana (leche, yogur bebible, jugos,
 * gaseosas — Alpina, Colanta, Postobón, Alquería) declara `per_100ml`, nunca
 * `per_100g`. Tratar esas etiquetas como si fueran `per_100g` no falla en
 * tiempo de ejecución: simplemente deja los valores mal etiquetados.
 */
export type NutritionBase = "per_100g" | "per_100ml" | "per_serving";

/** Un valor numerico con su confianza asociada. */
export type ParsedField = {
  value: number;
  confidence: ConfidenceLevel;
};

/** Claves fijas del registro canonico de micronutrientes (ver `micronutrients.ts`). */
export type MicronutrientKey =
  | "vitamin_a_ug"
  | "vitamin_c_mg"
  | "vitamin_d_ug"
  | "vitamin_e_mg"
  | "vitamin_k_ug"
  | "thiamin_mg"
  | "riboflavin_mg"
  | "niacin_mg"
  | "vitamin_b6_mg"
  | "folate_ug"
  | "vitamin_b12_ug"
  | "calcium_mg"
  | "iron_mg"
  | "magnesium_mg"
  | "phosphorus_mg"
  | "potassium_mg"
  | "zinc_mg"
  | "copper_mg"
  | "manganese_mg"
  | "selenium_ug"
  | "iodine_ug";

/** Unidad de un micronutriente, siempre atada a su clave (`_mg` o `_ug`). */
export type MicronutrientUnit = "mg" | "ug";

/** Entrada del registro canonico de micronutrientes. */
export type MicronutrientEntry = {
  key: MicronutrientKey;
  /** Etiqueta en español, lista para mostrar en la UI. */
  label: string;
  unit: MicronutrientUnit;
  /** Referencia diaria para un adulto (RDA/DV). */
  rda: number;
  /** Límite superior tolerable (UL). `null` cuando no hay uno establecido. */
  upperLimit: number | null;
};

/** Los cuatro campos obligatorios que exige la métrica de aceptacion. */
export type RequiredMacroKey = "energyKcal" | "proteinG" | "carbsTotalG" | "fatTotalG";

/** Todos los macronutrientes que el parser reconoce, cada uno opcional. */
export type MacroFields = Partial<Record<MacroKey, ParsedField>>;

export type MacroKey =
  | "energyKcal"
  | "fatTotalG"
  | "fatSaturatedG"
  | "fatTransG"
  | "cholesterolMg"
  | "sodiumMg"
  | "carbsTotalG"
  | "fiberG"
  | "sugarsG"
  | "addedSugarsG"
  | "proteinG";

/** Micronutrientes reconocidos, indexados por clave del registro canonico. */
export type MicronutrientFields = Partial<Record<MicronutrientKey, ParsedField>>;

/** Resultado completo de parsear las líneas de una etiqueta. */
export type ParsedLabel = {
  /** Base detectada para los valores en `macros`/`micronutrients`. `null` si no se pudo determinar. */
  base: NutritionBase | null;
  baseConfidence: ConfidenceLevel;
  /** Tamano de porcion en gramos, si la etiqueta lo declara en gramos. */
  servingSizeG: number | null;
  /** Texto crudo de la línea de tamano de porcion (puede incluir unidades no-gramo, ej. "1 taza (240 ml)"). */
  servingSizeRaw: string | null;
  servingsPerContainer: number | null;
  macros: MacroFields;
  micronutrients: MicronutrientFields;
  /**
   * Los mismos macros normalizados a 100 unidades (100 g o 100 ml, según
   * `base`) cuando el calculo es posible: `base` ya es `per_100g`/`per_100ml`
   * (no hay que calcular nada), o `base` es `per_serving` con
   * `servingSizeG` conocido. Queda vacio cuando no se puede calcular con
   * confianza (ej. porcion declarada en ml sin doble columna: ver
   * `labelParser.ts`).
   */
  normalizedTo100: MacroFields;
  /** Avisos legibles para depuracion/QA. No se muestran al usuario final. */
  warnings: string[];
};
