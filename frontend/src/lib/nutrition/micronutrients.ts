/**
 * Registro canonico de micronutrientes — espejo en TS del futuro
 * `src/app/nutrition/micronutrients.py` (backend, doc `modulo-dieta.md` #3).
 *
 * Mientras el backend expone `GET /diet/micronutrients`, este archivo es la
 * única fuente de verdad en el frontend para que el parser de etiquetas y la
 * UI (barras `MicroBar`, formulario de captura) no inventen cada uno su
 * propia lista. Cuando el endpoint exista, este archivo se puede reemplazar
 * por datos traidos del servidor sin cambiar el tipo `MicronutrientEntry`.
 *
 * Los valores de `rda` (referencia diaria) y `upperLimit` (límite superior
 * tolerable) siguen la tabla de "Daily Values" de FDA/NIH-ODS para adultos,
 * que es la base que también usan las resoluciones colombianas de rotulado
 * (810 de 2021) para calcular %VD. El documento de especificacion no fija
 * números exactos, así que estos son ajustables sin romper el contrato del
 * tipo si el backend define otros.
 *
 * IMPORTANTE — esto NO es lo mismo que la "trampa" del cliente de Open Food
 * Facts (doc #3 y #4): esa conversion (x1000 / x1 000 000) aplica a los
 * valores que devuelve la API de OFF, que vienen en gramos. Las etiquetas
 * impresas que procesa `labelParser.ts` ya declaran mg/µg directamente, así
 * que aquí no hace falta ninguna conversion de unidades.
 */

import type { MicronutrientEntry, MicronutrientKey } from "./types";

export const MICRONUTRIENTS: readonly MicronutrientEntry[] = [
  { key: "vitamin_a_ug", label: "Vitamina A", unit: "ug", rda: 900, upperLimit: 3000 },
  { key: "vitamin_c_mg", label: "Vitamina C", unit: "mg", rda: 90, upperLimit: 2000 },
  { key: "vitamin_d_ug", label: "Vitamina D", unit: "ug", rda: 20, upperLimit: 100 },
  { key: "vitamin_e_mg", label: "Vitamina E", unit: "mg", rda: 15, upperLimit: 1000 },
  { key: "vitamin_k_ug", label: "Vitamina K", unit: "ug", rda: 120, upperLimit: null },
  { key: "thiamin_mg", label: "Tiamina (B1)", unit: "mg", rda: 1.2, upperLimit: null },
  { key: "riboflavin_mg", label: "Riboflavina (B2)", unit: "mg", rda: 1.3, upperLimit: null },
  { key: "niacin_mg", label: "Niacina (B3)", unit: "mg", rda: 16, upperLimit: 35 },
  { key: "vitamin_b6_mg", label: "Vitamina B6", unit: "mg", rda: 1.7, upperLimit: 100 },
  { key: "folate_ug", label: "Folato", unit: "ug", rda: 400, upperLimit: 1000 },
  { key: "vitamin_b12_ug", label: "Vitamina B12", unit: "ug", rda: 2.4, upperLimit: null },
  { key: "calcium_mg", label: "Calcio", unit: "mg", rda: 1300, upperLimit: 2500 },
  { key: "iron_mg", label: "Hierro", unit: "mg", rda: 18, upperLimit: 45 },
  // El UL de 350 mg del magnesio aplica SOLO al magnesio suplementario, no al
  // dietario (NIH ODS). Dejarlo aquí marcaria como "excedido" a cualquiera que
  // cumpla su RDA de 420 mg comiendo normal: falsa alarma diaria para todos.
  { key: "magnesium_mg", label: "Magnesio", unit: "mg", rda: 420, upperLimit: null },
  { key: "phosphorus_mg", label: "Fosforo", unit: "mg", rda: 1250, upperLimit: 4000 },
  { key: "potassium_mg", label: "Potasio", unit: "mg", rda: 4700, upperLimit: null },
  { key: "zinc_mg", label: "Zinc", unit: "mg", rda: 11, upperLimit: 40 },
  { key: "copper_mg", label: "Cobre", unit: "mg", rda: 0.9, upperLimit: 10 },
  { key: "manganese_mg", label: "Manganeso", unit: "mg", rda: 2.3, upperLimit: 11 },
  { key: "selenium_ug", label: "Selenio", unit: "ug", rda: 55, upperLimit: 400 },
  { key: "iodine_ug", label: "Yodo", unit: "ug", rda: 150, upperLimit: 1100 },
] as const;

export const MICRONUTRIENT_BY_KEY: ReadonlyMap<MicronutrientKey, MicronutrientEntry> = new Map(
  MICRONUTRIENTS.map((entry) => [entry.key, entry]),
);

/**
 * Alias en español (normalizados: minusculas, sin tildes) que el parser de
 * etiquetas reconoce para cada micronutriente. Incluye variantes comunes de
 * OCR y nombres alternos usados en etiquetas colombianas reales.
 * `normalizeForMatch` en `labelParser.ts` produce el mismo formato de texto,
 * así que las claves de este mapa deben quedar ya sin tildes.
 */
export const MICRONUTRIENT_ALIASES: ReadonlyMap<string, MicronutrientKey> = new Map([
  ["vitamina a", "vitamin_a_ug"],
  ["vitamina c", "vitamin_c_mg"],
  ["acido ascorbico", "vitamin_c_mg"],
  ["vitamina d", "vitamin_d_ug"],
  ["vitamina e", "vitamin_e_mg"],
  ["vitamina k", "vitamin_k_ug"],
  ["vitamina b1", "thiamin_mg"],
  ["tiamina", "thiamin_mg"],
  ["vitamina b2", "riboflavin_mg"],
  ["riboflavina", "riboflavin_mg"],
  ["vitamina b3", "niacin_mg"],
  ["niacina", "niacin_mg"],
  ["vitamina b6", "vitamin_b6_mg"],
  ["piridoxina", "vitamin_b6_mg"],
  ["folato", "folate_ug"],
  ["acido folico", "folate_ug"],
  ["vitamina b9", "folate_ug"],
  ["vitamina b12", "vitamin_b12_ug"],
  ["cobalamina", "vitamin_b12_ug"],
  ["calcio", "calcium_mg"],
  ["hierro", "iron_mg"],
  ["magnesio", "magnesium_mg"],
  ["fosforo", "phosphorus_mg"],
  ["potasio", "potassium_mg"],
  ["zinc", "zinc_mg"],
  ["cinc", "zinc_mg"],
  ["cobre", "copper_mg"],
  ["manganeso", "manganese_mg"],
  ["selenio", "selenium_ug"],
  ["yodo", "iodine_ug"],
]);
