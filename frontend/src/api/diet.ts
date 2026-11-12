import { ApiError, applyAuthHeaders, http, notifyUnauthorized, toApiUrl } from "./core";

// --------------------------------------------------------------------------
// Dieta (`src/app/api/v1/endpoints/diet/`)
// --------------------------------------------------------------------------

// Franjas legacy (fijas) + genericas personalizables `comida_1`..`comida_8`
// (ver `MealSlot` en `src/app/api/v1/endpoints/diet/common.py`). El nombre visible de
// las genericas sale de `NutritionTarget.meal_labels`, no de este id.
export type MealSlot = string;

export type FoodScope = "all" | "mine" | "global";

export type FoodBasis = "per_100g" | "per_100ml";

export type FoodStatus = "active" | "pending" | "rejected";

export type NutritionTarget = {
  athlete_id: string;
  energy_kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  micronutrient_targets: Record<string, number>;
  meal_labels: string[] | null;
  updated_at_utc: string | null;
};

export type NutritionTargetPayload = {
  athlete_id: string;
  energy_kcal?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  fiber_g?: number | null;
  micronutrient_targets?: Record<string, number> | null;
  meal_labels?: string[] | null;
};

export function getDietTargets(athleteId: string): Promise<NutritionTarget> {
  const qs = new URLSearchParams({ athlete_id: athleteId });
  return http(`/api/v1/diet/targets?${qs.toString()}`);
}

export function putDietTargets(payload: NutritionTargetPayload): Promise<NutritionTarget> {
  return http("/api/v1/diet/targets", { method: "PUT", body: JSON.stringify(payload) });
}

export type DailyTotals = {
  energy_kcal: number;
  protein_g: number;
  carbs_g: number;
  sugars_g: number;
  fiber_g: number;
  fat_g: number;
  sat_fat_g: number;
  sodium_mg: number;
  micronutrients: Record<string, number>;
};

export type MealEntry = {
  id: string;
  athlete_id: string;
  logged_by_user_id: string;
  consumed_at: string;
  meal_slot: MealSlot;
  food_product_id: string | null;
  food_name: string;
  // `quantity_g` es la cantidad normalizada a la unidad base del alimento (g, o
  // ml si su basis es per_100ml): es la que entra en los macros.
  // `quantity_value`/`quantity_unit` guardan lo que escribio el usuario
  // ("2 porciones"); son null en entradas anteriores a las unidades.
  quantity_g: number;
  quantity_value: number | null;
  quantity_unit: string | null;
  energy_kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  sugars_g: number | null;
  fiber_g: number | null;
  fat_g: number | null;
  sat_fat_g: number | null;
  sodium_mg: number | null;
  micronutrients: Record<string, number>;
  notes: string | null;
  created_at_utc: string;
};

export type MealEntryCreatePayload = {
  athlete_id: string;
  consumed_at?: string | null;
  meal_slot: MealSlot;
  food_product_id?: string | null;
  food_name?: string | null;
  // Se manda la cantidad en la unidad que eligio el usuario y el backend
  // convierte (es el único que conoce el `serving_size_g` del catálogo).
  // `quantity_g` solo para entradas ya normalizadas (reencolar, deshacer).
  quantity_g?: number;
  quantity_value?: number | null;
  quantity_unit?: string | null;
  notes?: string | null;
  energy_kcal?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  sugars_g?: number | null;
  fiber_g?: number | null;
  fat_g?: number | null;
  sat_fat_g?: number | null;
  sodium_mg?: number | null;
  micronutrients?: Record<string, number> | null;
  // Idempotencia del outbox offline (`lib/nutrition/mealOutbox.ts`): mismo
  // client_ref -> el backend devuelve la entrada ya creada en vez de duplicarla.
  client_ref?: string | null;
};

export type MealEntryUpdatePayload = {
  consumed_at?: string | null;
  meal_slot?: MealSlot;
  quantity_g?: number;
  quantity_value?: number | null;
  quantity_unit?: string | null;
  food_name?: string;
  notes?: string | null;
  energy_kcal?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  sugars_g?: number | null;
  fiber_g?: number | null;
  fat_g?: number | null;
  sat_fat_g?: number | null;
  sodium_mg?: number | null;
  micronutrients?: Record<string, number> | null;
};

export type MealEntryFromPresetPayload = {
  athlete_id: string;
  preset_id: string;
  consumed_at?: string | null;
  meal_slot?: MealSlot | null;
  // Ref de LOTE (uno por intento de guardado), no uno por item del preset.
  client_ref?: string | null;
};

export type MealEntriesResponse = {
  athlete_id: string;
  date: string;
  items: MealEntry[];
  totals: DailyTotals;
};

export type DietSummaryDayItem = {
  date: string;
  totals: DailyTotals;
};

export type DietSummaryResponse = {
  athlete_id: string;
  from_date: string;
  to_date: string;
  days: DietSummaryDayItem[];
};

export function getDietEntries(athleteId: string, date: string): Promise<MealEntriesResponse> {
  const qs = new URLSearchParams({ athlete_id: athleteId, date });
  return http(`/api/v1/diet/entries?${qs.toString()}`);
}

export function createDietEntry(payload: MealEntryCreatePayload): Promise<MealEntry> {
  return http("/api/v1/diet/entries", { method: "POST", body: JSON.stringify(payload) });
}

export function updateDietEntry(entryId: string, payload: MealEntryUpdatePayload): Promise<MealEntry> {
  return http(`/api/v1/diet/entries/${encodeURIComponent(entryId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteDietEntry(entryId: string): Promise<{ ok: boolean; id: string }> {
  return http(`/api/v1/diet/entries/${encodeURIComponent(entryId)}`, { method: "DELETE" });
}

export function createDietEntriesFromPreset(payload: MealEntryFromPresetPayload): Promise<MealEntry[]> {
  return http("/api/v1/diet/entries/from-preset", { method: "POST", body: JSON.stringify(payload) });
}

export function getDietSummary(athleteId: string, from: string, to: string): Promise<DietSummaryResponse> {
  const qs = new URLSearchParams({ athlete_id: athleteId, from, to });
  return http(`/api/v1/diet/summary?${qs.toString()}`);
}

export type FoodProduct = {
  id: string;
  owner_user_id: string | null;
  barcode: string | null;
  source: string;
  source_ref: string | null;
  name: string;
  brand: string | null;
  country_code: string | null;
  category: string | null;
  serving_size_g: number | null;
  serving_label: string | null;
  package_qty_g: number | null;
  basis: FoodBasis;
  energy_kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  sugars_g: number | null;
  fiber_g: number | null;
  fat_g: number | null;
  sat_fat_g: number | null;
  trans_fat_g: number | null;
  sodium_mg: number | null;
  cholesterol_mg: number | null;
  micronutrients: Record<string, number>;
  image_front_path: string | null;
  image_nutrition_path: string | null;
  verified_count: number;
  status: FoodStatus;
  created_at_utc: string;
};

export type FoodProductCreatePayload = {
  barcode?: string | null;
  name: string;
  brand?: string | null;
  country_code?: string | null;
  serving_size_g?: number | null;
  serving_label?: string | null;
  package_qty_g?: number | null;
  basis?: FoodBasis;
  energy_kcal?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  sugars_g?: number | null;
  fiber_g?: number | null;
  fat_g?: number | null;
  sat_fat_g?: number | null;
  trans_fat_g?: number | null;
  sodium_mg?: number | null;
  cholesterol_mg?: number | null;
  micronutrients?: Record<string, number> | null;
};

export type FoodProductUpdatePayload = Partial<FoodProductCreatePayload> & { status?: FoodStatus };

export type FoodSearchFilters = {
  q: string;
  scope?: FoodScope;
  /** Una o varias categorias del catálogo; se envian como `?category=` repetido. */
  category?: string | string[];
  min_kcal?: number;
  max_kcal?: number;
  min_protein?: number;
  max_protein?: number;
  min_carbs?: number;
  max_carbs?: number;
  min_fat?: number;
  max_fat?: number;
  limit?: number;
};

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).filter((item) => item.trim() !== "");
}

export function searchDietFoods(params: FoodSearchFilters): Promise<FoodProduct[]> {
  const qs = new URLSearchParams({ q: params.q });
  if (params.scope) qs.set("scope", params.scope);
  for (const category of toArray(params.category)) qs.append("category", category);
  if (params.min_kcal !== undefined) qs.set("min_kcal", String(params.min_kcal));
  if (params.max_kcal !== undefined) qs.set("max_kcal", String(params.max_kcal));
  if (params.min_protein !== undefined) qs.set("min_protein", String(params.min_protein));
  if (params.max_protein !== undefined) qs.set("max_protein", String(params.max_protein));
  if (params.min_carbs !== undefined) qs.set("min_carbs", String(params.min_carbs));
  if (params.max_carbs !== undefined) qs.set("max_carbs", String(params.max_carbs));
  if (params.min_fat !== undefined) qs.set("min_fat", String(params.min_fat));
  if (params.max_fat !== undefined) qs.set("max_fat", String(params.max_fat));
  if (params.limit) qs.set("limit", String(params.limit));
  return http(`/api/v1/diet/foods/search?${qs.toString()}`);
}

export function getRecentDietFoods(athleteId: string, limit?: number): Promise<FoodProduct[]> {
  const qs = new URLSearchParams({ athlete_id: athleteId });
  if (limit) qs.set("limit", String(limit));
  return http(`/api/v1/diet/foods/recent?${qs.toString()}`);
}

export function getDietFoodCategories(scope?: FoodScope): Promise<string[]> {
  const qs = new URLSearchParams();
  if (scope) qs.set("scope", scope);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return http(`/api/v1/diet/foods/categories${suffix}`);
}

export function getDietFoodByBarcode(barcode: string): Promise<FoodProduct> {
  return http(`/api/v1/diet/foods/barcode/${encodeURIComponent(barcode)}`);
}

export function createDietFood(payload: FoodProductCreatePayload): Promise<FoodProduct> {
  return http("/api/v1/diet/foods", { method: "POST", body: JSON.stringify(payload) });
}

export function updateDietFood(foodId: string, payload: FoodProductUpdatePayload): Promise<FoodProduct> {
  return http(`/api/v1/diet/foods/${encodeURIComponent(foodId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteDietFood(foodId: string): Promise<{ ok: boolean; id: string }> {
  return http(`/api/v1/diet/foods/${encodeURIComponent(foodId)}`, { method: "DELETE" });
}

export type FoodPhotoKind = "front" | "nutrition";

export type FoodPhotoUploadResponse = {
  ok: boolean;
  kind: FoodPhotoKind;
  path: string;
};

/** Sube la foto de un producto (multipart: `kind` + `file`). Ver `upload_food_photo` en el backend. */
export function uploadDietFoodPhoto(
  foodId: string,
  kind: FoodPhotoKind,
  file: Blob,
  filename?: string,
): Promise<FoodPhotoUploadResponse> {
  const form = new FormData();
  form.append("kind", kind);
  form.append("file", file, filename || `${kind}.jpg`);
  return http(`/api/v1/diet/foods/${encodeURIComponent(foodId)}/photos`, { method: "POST", body: form });
}

/** La respuesta es la imagen binaria (JPEG), no JSON: `http()` no aplica aquí. */
export async function getDietFoodPhoto(foodId: string, kind: FoodPhotoKind): Promise<Blob> {
  const headers = new Headers();
  applyAuthHeaders(headers);

  const path = `/api/v1/diet/foods/${encodeURIComponent(foodId)}/photos/${kind}`;
  const res = await fetch(toApiUrl(path), { headers });
  if (!res.ok) {
    notifyUnauthorized(res.status, path);
    throw new ApiError(res.status, res.statusText || "No se pudo obtener la foto.");
  }
  return res.blob();
}

export type MicronutrientDefinition = {
  key: string;
  label: string;
  unit: string;
  rda: number;
  upper_limit: number | null;
};

export function getDietMicronutrients(): Promise<MicronutrientDefinition[]> {
  return http("/api/v1/diet/micronutrients");
}

export type MealPresetItem = {
  food_product_id?: string | null;
  food_name: string;
  quantity_g: number;
  // Solo presentacion: `quantity_g` sigue mandando al crear las entradas.
  quantity_value?: number | null;
  quantity_unit?: string | null;
  energy_kcal?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  sugars_g?: number | null;
  fiber_g?: number | null;
  fat_g?: number | null;
  sat_fat_g?: number | null;
  sodium_mg?: number | null;
  micronutrients?: Record<string, number> | null;
};

export type MealPreset = {
  id: string;
  owner_user_id: string;
  name: string;
  meal_slot: MealSlot | null;
  items: MealPresetItem[];
  created_at_utc: string;
  updated_at_utc: string;
};

export type MealPresetCreatePayload = {
  name: string;
  meal_slot?: MealSlot | null;
  items: MealPresetItem[];
};

export function getDietPresets(): Promise<MealPreset[]> {
  return http("/api/v1/diet/presets");
}

export function createDietPreset(payload: MealPresetCreatePayload): Promise<MealPreset> {
  return http("/api/v1/diet/presets", { method: "POST", body: JSON.stringify(payload) });
}

export function deleteDietPreset(presetId: string): Promise<{ ok: boolean; id: string }> {
  return http(`/api/v1/diet/presets/${encodeURIComponent(presetId)}`, { method: "DELETE" });
}
