import { useEffect, useState } from "react";

import {
  getBodyMeasurementsHistory,
  getBodyMetricDefinitions,
  type BodyMeasurementItem,
  type BodyMetricDefinition,
  type BodyMetricKey,
} from "../api";
import type { WeightUnit } from "../state/preferences";
import { fromKg, formatWeight } from "./units";

export const FIELD_GROUPS: Array<{
  title: string;
  keys: BodyMetricKey[];
}> = [
  {
    title: "Base de composición",
    keys: ["weight_kg", "height_cm", "waist_cm", "hip_cm", "body_fat_pct"],
  },
  {
    title: "Tren superior",
    keys: ["neck_cm", "shoulders_cm", "chest_cm", "arm_relaxed_cm", "arm_flexed_cm", "forearm_cm"],
  },
  {
    title: "Tren inferior",
    keys: ["thigh_cm", "calf_cm"],
  },
];

export const FALLBACK_DEFINITIONS: BodyMetricDefinition[] = [
  { key: "weight_kg", label: "Peso corporal", unit: "kg", description: "Indicador base de tendencia global." },
  {
    key: "height_cm",
    label: "Estatura",
    unit: "cm",
    description: "Necesaria para calculos como IMC y ratio cintura/estatura.",
  },
  {
    key: "waist_cm",
    label: "Perímetro cintura",
    unit: "cm",
    description: "Medida prioritaria para composición corporal y riesgo cardiometabolico.",
  },
  {
    key: "hip_cm",
    label: "Perímetro cadera",
    unit: "cm",
    description: "Útil para ratio cintura/cadera y cambios de composición.",
  },
  {
    key: "chest_cm",
    label: "Perímetro torax",
    unit: "cm",
    description: "Seguimiento de tren superior en fases de hipertrofia/definicion.",
  },
  {
    key: "shoulders_cm",
    label: "Perímetro hombros",
    unit: "cm",
    description: "Control de desarrollo del hombro y proporcion corporal.",
  },
  {
    key: "neck_cm",
    label: "Perímetro cuello",
    unit: "cm",
    description: "Apoya calculos de composición con metodos antropometricos.",
  },
  {
    key: "arm_relaxed_cm",
    label: "Perímetro brazo relajado",
    unit: "cm",
    description: "Seguimiento estable del brazo sin sesgo por bombeo.",
  },
  {
    key: "arm_flexed_cm",
    label: "Perímetro brazo flexionado",
    unit: "cm",
    description: "Permite evaluar desarrollo muscular del brazo.",
  },
  {
    key: "forearm_cm",
    label: "Perímetro antebrazo",
    unit: "cm",
    description: "Detalle de progreso en tren superior distal.",
  },
  {
    key: "thigh_cm",
    label: "Perímetro muslo",
    unit: "cm",
    description: "Control de masa muscular del tren inferior.",
  },
  {
    key: "calf_cm",
    label: "Perímetro pantorrilla",
    unit: "cm",
    description: "Detalle de progreso del tren inferior distal.",
  },
  {
    key: "body_fat_pct",
    label: "% grasa corporal",
    unit: "%",
    description: "Estimacion opcional de composición corporal.",
  },
];

export const EMPTY_VALUES: Record<BodyMetricKey, string> = {
  weight_kg: "",
  height_cm: "",
  neck_cm: "",
  shoulders_cm: "",
  chest_cm: "",
  waist_cm: "",
  hip_cm: "",
  arm_relaxed_cm: "",
  arm_flexed_cm: "",
  forearm_cm: "",
  thigh_cm: "",
  calf_cm: "",
  body_fat_pct: "",
};

export function buildDefinitionByKey(definitions: BodyMetricDefinition[]): Map<BodyMetricKey, BodyMetricDefinition> {
  const map = new Map<BodyMetricKey, BodyMetricDefinition>();
  for (const item of definitions) {
    map.set(item.key, item);
  }
  for (const fallback of FALLBACK_DEFINITIONS) {
    if (!map.has(fallback.key)) map.set(fallback.key, fallback);
  }
  return map;
}

export function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseOptionalNumber(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

/** Valor crudo (sin convertir unidad) de una medida puntual, o null si no fue registrada. */
export function rawMetricValue(item: BodyMeasurementItem, key: BodyMetricKey): number | null {
  const raw = item[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/** Valor en el sistema de preferencia del usuario: solo el peso se convierte, el resto queda en su unidad fija. */
export function displayMetricValue(item: BodyMeasurementItem, key: BodyMetricKey, weightUnit: WeightUnit): number | null {
  const raw = rawMetricValue(item, key);
  if (raw === null) return null;
  return key === "weight_kg" ? fromKg(raw, weightUnit) : raw;
}

export function metricUnitLabel(key: BodyMetricKey, definition: BodyMetricDefinition | undefined, weightUnit: WeightUnit): string {
  if (key === "weight_kg") return weightUnit;
  return definition?.unit || "";
}

export function formatMetricValue(item: BodyMeasurementItem, key: BodyMetricKey, weightUnit: WeightUnit): string | null {
  const raw = rawMetricValue(item, key);
  if (raw === null) return null;
  if (key === "weight_kg") return formatWeight(raw, weightUnit);
  if (key === "body_fat_pct") return `${raw.toFixed(1)} %`;
  return `${raw.toFixed(1)} cm`;
}

export function formatDelta(current: number | null, previous: number | null, unit: string, decimals = 1): string | null {
  if (current === null || previous === null) return null;
  const delta = current - previous;
  if (Math.abs(delta) < 1e-9) return "Sin cambio";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(decimals)} ${unit}`;
}

/** % de cambio de `previous` a `current`; null si falta un dato o el punto de partida es 0. */
export function percentDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function formatPercentDelta(current: number | null, previous: number | null, decimals = 1): string | null {
  const pct = percentDelta(current, previous);
  if (pct === null) return null;
  if (Math.abs(pct) < 0.05) return "Sin cambio";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(decimals)}%`;
}

export type BodyMeasurementsState = {
  definitions: BodyMetricDefinition[];
  history: BodyMeasurementItem[];
  loading: boolean;
  error: string;
  reload: () => void;
};

/** Carga compartida de definiciones + histórico de medidas para un atleta; usada por las 3 pantallas de Medidas. */
export function useBodyMeasurements(athleteId: string | null, limit = 120): BodyMeasurementsState {
  const [definitions, setDefinitions] = useState<BodyMetricDefinition[]>(FALLBACK_DEFINITIONS);
  const [history, setHistory] = useState<BodyMeasurementItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getBodyMetricDefinitions()
      .then((items) => {
        if (cancelled || items.length === 0) return;
        setDefinitions(items);
      })
      .catch(() => {
        if (!cancelled) setDefinitions(FALLBACK_DEFINITIONS);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!athleteId) {
        setHistory([]);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const response = await getBodyMeasurementsHistory(athleteId, limit);
        if (cancelled) return;
        setHistory(response.items || []);
      } catch (cause: unknown) {
        if (cancelled) return;
        setHistory([]);
        setError(String((cause as { message?: string })?.message || cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [athleteId, limit, reloadTick]);

  return { definitions, history, loading, error, reload: () => setReloadTick((tick) => tick + 1) };
}
