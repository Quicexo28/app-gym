/**
 * Logica compartida del modulo de dieta entre `Home.tsx` y las pantallas de
 * `/diet`: ambos deben leer del mismo origen de datos (doc `modulo-dieta.md`
 * #6.4 - "Home consume `GET /diet/entries?date=hoy` ... sin ceros
 * hardcodeados").
 *
 * NOTA: este archivo NO es el parser de etiquetas (`labelParser.ts`) ni el
 * registro canonico de micronutrientes (`micronutrients.ts`) — esos ya
 * existen en este directorio y no se tocan aquí.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  deleteDietEntry,
  getDietEntries,
  getDietMicronutrients,
  getDietTargets,
  type DailyTotals,
  type MealEntry,
  type MealEntryCreatePayload,
  type MealSlot,
  type MicronutrientDefinition,
  type NutritionTarget,
  type NutritionTargetPayload,
} from "../../api";
import { dayKey } from "../dates";

// Personalizacion de comidas (doc `modulo-dieta.md`): el atleta elige cuantas
// comidas registra por día (1-8) y como se llama cada una. El id interno
// (`comida_1`..`comida_8`) es estable y nunca se muestra; el nombre visible
// sale de `NutritionTarget.meal_labels`, con default "Comida N" si no lo
// personalizo. Las 4 franjas viejas (desayuno/almuerzo/cena/snack) se siguen
// aceptando para no perder el nombre de entries ya registradas antes de este
// cambio.
export const DEFAULT_MEAL_COUNT = 3;
export const MIN_MEAL_COUNT = 1;
export const MAX_MEAL_COUNT = 8;

const LEGACY_MEAL_SLOT_LABELS: Record<string, string> = {
  desayuno: "Desayuno",
  almuerzo: "Almuerzo",
  cena: "Cena",
  snack: "Snack",
};
export const LEGACY_MEAL_SLOT_ORDER: MealSlot[] = ["desayuno", "almuerzo", "cena", "snack"];

export type MealSlotDef = { key: MealSlot; label: string };

export function mealSlotKey(index: number): MealSlot {
  return `comida_${index + 1}`;
}

export function defaultMealLabel(index: number): string {
  return `Comida ${index + 1}`;
}

/** Slots activos de un atleta: sus `meal_labels` personalizados, o el default de 3 genericas. */
export function mealSlotsFromTargets(targets: NutritionTarget | null): MealSlotDef[] {
  const labels = targets?.meal_labels;
  if (labels && labels.length > 0) {
    return labels.map((label, idx) => ({ key: mealSlotKey(idx), label }));
  }
  return Array.from({ length: DEFAULT_MEAL_COUNT }, (_, idx) => ({
    key: mealSlotKey(idx),
    label: defaultMealLabel(idx),
  }));
}

/** Nombre genérico de un slot sin depender de los targets del atleta (legacy o `comida_N`). */
export function genericMealSlotLabel(slot: MealSlot): string {
  if (LEGACY_MEAL_SLOT_LABELS[slot]) return LEGACY_MEAL_SLOT_LABELS[slot];
  const match = /^comida_(\d+)$/.exec(slot);
  if (match) return `Comida ${match[1]}`;
  return slot;
}

/** Nombre a mostrar para un slot: el personalizado si esta entre los activos, si no un fallback genérico. */
export function resolveMealLabel(slot: MealSlot, slots: MealSlotDef[]): string {
  return slots.find((item) => item.key === slot)?.label ?? genericMealSlotLabel(slot);
}

/**
 * Siguiente `comida_N` libre (no configurada) para agregar una comida extra
 * SOLO ese día, sin tocar `meal_labels` en Objetivos. `null` si ya se usaron
 * las 8 franjas disponibles.
 */
export function nextFreeMealSlot(activeSlots: MealSlotDef[]): MealSlot | null {
  const used = new Set(activeSlots.map((slot) => slot.key));
  for (let idx = 0; idx < MAX_MEAL_COUNT; idx += 1) {
    const key = mealSlotKey(idx);
    if (!used.has(key)) return key;
  }
  return null;
}

/**
 * Payload completo de objetivos a partir de los actuales + los campos que se
 * cambian. `PUT /diet/targets` reemplaza la fila entera: mandar solo el campo
 * editado borraria el resto (kcal, macros, nombres de comidas).
 */
export function targetsToPayload(
  athleteId: string,
  targets: NutritionTarget | null,
  overrides: Partial<NutritionTargetPayload> = {},
): NutritionTargetPayload {
  return {
    athlete_id: athleteId,
    energy_kcal: targets?.energy_kcal ?? null,
    protein_g: targets?.protein_g ?? null,
    carbs_g: targets?.carbs_g ?? null,
    fat_g: targets?.fat_g ?? null,
    fiber_g: targets?.fiber_g ?? null,
    micronutrient_targets: targets?.micronutrient_targets ?? null,
    meal_labels: targets?.meal_labels ?? null,
    ...overrides,
  };
}

/** Nombres de comidas listos para guardar: los configurados, o el default si el atleta nunca los toco. */
export function mealLabelsFromTargets(targets: NutritionTarget | null): string[] {
  return mealSlotsFromTargets(targets).map((slot) => slot.label);
}

export const MACRO_KCAL_PER_G = { protein_g: 4, carbs_g: 4, fat_g: 9 } as const;

export type MacroFieldKey = "energy_kcal" | "protein_g" | "carbs_g" | "fat_g";
export type MacroValues = Record<MacroFieldKey, number | null>;

/** kcal que aportan los tres macros: 4 kcal/g proteína, 4 kcal/g carbos, 9 kcal/g grasa. */
export function energyFromMacros(protein: number, carbs: number, fat: number): number {
  return protein * MACRO_KCAL_PER_G.protein_g + carbs * MACRO_KCAL_PER_G.carbs_g + fat * MACRO_KCAL_PER_G.fat_g;
}

/**
 * Con 3 de los 4 valores (kcal + los tres macros) deduce el que falta,
 * despejando `kcal = 4P + 4C + 9G`. `null` si no falta exactamente uno, si
 * algun dato no es finito, o si el resultado daria negativo (los macros dados
 * ya se pasan de las kcal: ahi no hay nada que repartir).
 */
export function solveMissingMacro(values: MacroValues): { key: MacroFieldKey; value: number } | null {
  const keys: MacroFieldKey[] = ["energy_kcal", "protein_g", "carbs_g", "fat_g"];
  const missing = keys.filter((key) => values[key] === null || !Number.isFinite(values[key] as number));
  if (missing.length !== 1) return null;

  const key = missing[0];
  const energy = values.energy_kcal ?? 0;
  const protein = values.protein_g ?? 0;
  const carbs = values.carbs_g ?? 0;
  const fat = values.fat_g ?? 0;

  const raw =
    key === "energy_kcal"
      ? energyFromMacros(protein, carbs, fat)
      : key === "protein_g"
        ? (energy - carbs * MACRO_KCAL_PER_G.carbs_g - fat * MACRO_KCAL_PER_G.fat_g) / MACRO_KCAL_PER_G.protein_g
        : key === "carbs_g"
          ? (energy - protein * MACRO_KCAL_PER_G.protein_g - fat * MACRO_KCAL_PER_G.fat_g) / MACRO_KCAL_PER_G.carbs_g
          : (energy - protein * MACRO_KCAL_PER_G.protein_g - carbs * MACRO_KCAL_PER_G.carbs_g) /
            MACRO_KCAL_PER_G.fat_g;

  if (!Number.isFinite(raw) || raw < 0) return null;
  return { key, value: key === "energy_kcal" ? Math.round(raw) : Math.round(raw * 10) / 10 };
}

export function todayKey(): string {
  return dayKey(new Date());
}

/**
 * ISO de mediodia UTC para un `dayKey` dado: cae siempre dentro del rango
 * `[dayKey 00:00 UTC, dayKey+1 00:00 UTC)` que usa el backend para bucketear
 * por día (`_day_range_utc` en `diet.py`), sin importar la hora/zona local en
 * que el atleta registra. Usar siempre que se cree una entry para un día
 * elegido en el selector (incluido "hoy"), en vez de dejar que el backend
 * use `datetime.now()`.
 */
export function consumedAtForDay(dayKeyStr: string): string {
  return `${dayKeyStr}T12:00:00.000Z`;
}

/**
 * Reconstruye el payload de creación a partir de una entry ya guardada, para
 * poder recrearla tal cual con "Deshacer" tras borrarla (mismo patron que
 * `Exercises.tsx`/`Routines.tsx`: borrar ya, ofrecer deshacer via
 * `state/undo.tsx`, sin dialogos de confirmacion previos).
 */
export function mealEntryToCreatePayload(entry: MealEntry): MealEntryCreatePayload {
  return {
    athlete_id: entry.athlete_id,
    consumed_at: entry.consumed_at,
    meal_slot: entry.meal_slot,
    food_product_id: entry.food_product_id,
    food_name: entry.food_name,
    // Viajan los tres: el par valor+unidad para que al deshacer la entrada se
    // vuelva a ver como se escribio ("2 porciones", no "90 g"), y `quantity_g`
    // como respaldo para las entradas viejas que no traen unidad. El backend
    // reconvierte a partir del par cuando esta, así que la regla de conversion
    // sigue viviendo en un solo lado.
    quantity_g: entry.quantity_g,
    quantity_value: entry.quantity_value,
    quantity_unit: entry.quantity_unit,
    notes: entry.notes,
    energy_kcal: entry.energy_kcal,
    protein_g: entry.protein_g,
    carbs_g: entry.carbs_g,
    sugars_g: entry.sugars_g,
    fiber_g: entry.fiber_g,
    fat_g: entry.fat_g,
    sat_fat_g: entry.sat_fat_g,
    sodium_mg: entry.sodium_mg,
    micronutrients: entry.micronutrients,
  };
}

/** Escala un valor por-100g a la cantidad consumida. Solo para previsualizar en el cliente. */
export function scalePer100g(valuePer100: number | null | undefined, quantityG: number): number | null {
  if (valuePer100 === null || valuePer100 === undefined || !Number.isFinite(quantityG)) return null;
  return Math.round(((valuePer100 * quantityG) / 100) * 100) / 100;
}

/** Parsea un input numerico opcional (acepta coma decimal, estandar en Colombia). `null` si esta vacio o es inválido. */
export function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export type MicroBarStatus = "veryLow" | "low" | "good" | "over";

/**
 * Estado de color de un `MicroBar` según el % del objetivo alcanzado (doc
 * `modulo-dieta.md` #6.3). `over` solo aplica cuando el micronutriente tiene
 * `upper_limit` definido; sin límite superior, todo lo que pase de 150% se
 * queda en `good`.
 */
export function microBarStatus(pct: number, hasUpperLimit: boolean): MicroBarStatus {
  if (pct < 50) return "veryLow";
  if (pct < 80) return "low";
  if (pct <= 150) return "good";
  return hasUpperLimit ? "over" : "good";
}

// El registro de micronutrientes es dato de referencia estatico: se cachea a
// nivel de modulo para no repetir el fetch en cada pantalla que lo usa.
let registryCache: MicronutrientDefinition[] | null = null;
let registryPromise: Promise<MicronutrientDefinition[]> | null = null;

export function useMicronutrientRegistry(): {
  registry: MicronutrientDefinition[];
  byKey: Map<string, MicronutrientDefinition>;
  loading: boolean;
} {
  const [registry, setRegistry] = useState<MicronutrientDefinition[]>(registryCache || []);
  const [loading, setLoading] = useState(!registryCache);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (registryCache) {
        if (!cancelled) {
          setRegistry(registryCache);
          setLoading(false);
        }
        return;
      }
      if (!registryPromise) {
        registryPromise = getDietMicronutrients();
      }
      if (!cancelled) setLoading(true);
      try {
        const rows = await registryPromise;
        registryCache = rows;
        if (!cancelled) setRegistry(rows);
      } catch {
        registryPromise = null;
        if (!cancelled) setRegistry([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const byKey = useMemo(() => new Map(registry.map((item) => [item.key, item])), [registry]);
  return { registry, byKey, loading };
}

export type DietTodayState = {
  targets: NutritionTarget | null;
  entries: MealEntry[];
  totals: DailyTotals | null;
  loading: boolean;
  error: string;
  refresh: () => void;
  removeEntry: (entryId: string) => Promise<void>;
};

/**
 * Objetivos + registros de un día (default hoy), la fuente única que
 * consumen Home y `/diet`. `dateKey` deja que ambas pantallas se sincronicen
 * con el mismo selector de días (doc `modulo-dieta.md` #6.4).
 */
export function useDietToday(athleteId: string, dateKey: string = todayKey()): DietTodayState {
  const [targets, setTargets] = useState<NutritionTarget | null>(null);
  const [entries, setEntries] = useState<MealEntry[]>([]);
  const [totals, setTotals] = useState<DailyTotals | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [versión, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!athleteId) {
        if (!cancelled) {
          setTargets(null);
          setEntries([]);
          setTotals(null);
        }
        return;
      }

      if (!cancelled) {
        setLoading(true);
        setError("");
      }

      try {
        const [targetsRes, entriesRes] = await Promise.all([
          getDietTargets(athleteId),
          getDietEntries(athleteId, dateKey),
        ]);
        if (cancelled) return;
        setTargets(targetsRes);
        setEntries(entriesRes.items);
        setTotals(entriesRes.totals);
      } catch (cause: unknown) {
        if (cancelled) return;
        setTargets(null);
        setEntries([]);
        setTotals(null);
        setError(String((cause as { message?: string })?.message || cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [athleteId, dateKey, versión]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const removeEntry = useCallback(
    async (entryId: string) => {
      await deleteDietEntry(entryId);
      refresh();
    },
    [refresh],
  );

  return { targets, entries, totals, loading, error, refresh, removeEntry };
}

/** Solo los slots de comida activos de un atleta (sin el resto de `useDietToday`), para pantallas que no necesitan las entries de hoy. */
export function useMealSlots(athleteId: string): { slots: MealSlotDef[]; loading: boolean } {
  const [targets, setTargets] = useState<NutritionTarget | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!athleteId) {
        if (!cancelled) setTargets(null);
        return;
      }
      if (!cancelled) setLoading(true);
      try {
        const res = await getDietTargets(athleteId);
        if (!cancelled) setTargets(res);
      } catch {
        if (!cancelled) setTargets(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  const slots = useMemo(() => mealSlotsFromTargets(targets), [targets]);
  return { slots, loading };
}
