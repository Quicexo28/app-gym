import type { FoodProduct } from "../../api";
import { PHOTO_FORM_MACRO_KEYS, type PhotoFormMacroKey } from "./capture";
import { defaultUnitForBasis, type QuantityUnitKey } from "./units";
import type { ConfidenceLevel } from "./types";

export type CaptureMode = "search" | "scan" | "photo";
export type ScanStatus = "idle" | "scanning" | "looking-up" | "error";

export const PHOTO_MACRO_LABELS: Record<PhotoFormMacroKey, string> = {
  energy_kcal: "Energía (kcal)",
  protein_g: "Proteína (g)",
  carbs_g: "Carbohidratos (g)",
  sugars_g: "Azucares (g)",
  fiber_g: "Fibra (g)",
  fat_g: "Grasas (g)",
  sat_fat_g: "Grasa saturada (g)",
  sodium_mg: "Sodio (mg)",
};

export type PhotoMacroFieldState = { text: string; suggested: boolean; confidence?: ConfidenceLevel };
export type PhotoMacroForm = Record<PhotoFormMacroKey, PhotoMacroFieldState>;

export function emptyPhotoMacroForm(): PhotoMacroForm {
  const form = {} as PhotoMacroForm;
  for (const key of PHOTO_FORM_MACRO_KEYS) {
    form[key] = { text: "", suggested: false };
  }
  return form;
}

export type CapturedPhotoState = { blob: Blob; previewUrl: string; ocrPath: string | null };

export function errorMessage(cause: unknown): string {
  return String((cause as { message?: string })?.message || cause);
}

/**
 * Cantidad con la que arranca el formulario para un alimento.
 *
 * Con tamano de porcion conocido, "1 porcion" es la respuesta correcta casi
 * siempre y ahorra que el usuario traduzca a gramos. Sin el, 100 de la unidad
 * base es el default de toda la vida (los macros del catálogo vienen por 100).
 */
export function defaultQuantityFor(food: FoodProduct | null): { value: string; unit: QuantityUnitKey } {
  if (food?.serving_size_g && food.serving_size_g > 0) {
    return { value: "1", unit: "porcion" };
  }
  return { value: "100", unit: defaultUnitForBasis(food?.basis) };
}
