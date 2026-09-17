/**
 * El motor de prediccion devuelve claves tecnicas en ingles
 * (`volume_load_kg`, `proximity_to_failure: further_from_failure`, ...).
 * Eso es util en el backend, pero en pantalla el atleta leia jerga de
 * desarrollador. Aqui vive la traduccion; lo que no este mapeado se muestra
 * en un formato legible en vez de la clave cruda.
 */

const METRIC_LABELS: Record<string, string> = {
  volume_load_kg: "Carga total (kg)",
  tonnage_kg: "Tonelaje (kg)",
  e1rm_kg: "1RM estimado (kg)",
  sets_count: "Series",
  reps_count: "Repeticiones",
};

const LATENT_LABELS: Record<string, string> = {
  fatigue: "Fatiga",
  readiness: "Disposición",
  plateau: "Estancamiento",
};

const SCENARIO_LABELS: Record<string, string> = {
  recovery: "Recuperación",
  maintenance: "Mantenimiento",
  variation: "Variación",
  overload: "Sobrecarga",
  deload: "Descarga",
};

const LEVER_LABELS: Record<string, string> = {
  volume: "Volumen",
  intensity: "Intensidad",
  proximity_to_failure: "Cercanía al fallo",
  variation: "Variación",
  consistency: "Consistencia",
  rep_range: "Rango de repeticiones",
  exercise_selection: "Selección de ejercicios",
  frequency: "Frecuencia",
  rest: "Descanso",
};

const LEVER_VALUE_LABELS: Record<string, string> = {
  up: "subir",
  down: "bajar",
  neutral: "mantener",
  down_or_neutral: "bajar o mantener",
  up_or_neutral: "subir o mantener",
  neutral_or_slight_up: "mantener o subir un poco",
  neutral_or_slight_down: "mantener o bajar un poco",
  further_from_failure: "dejar más reps en reserva",
  closer_to_failure: "acercarse al fallo",
  low: "baja",
  medium: "media",
  high: "alta",
  medium_or_high: "media o alta",
  low_or_medium: "baja o media",
  change: "cambiar",
  keep: "mantener",
  change_within_goal: "cambiar sin salirse del objetivo",
};

/** "further_from_failure" -> "Further from failure" (ultimo recurso legible). */
function humanize(raw: string): string {
  const text = raw.replace(/_/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : raw;
}

export function metricLabel(key: string): string {
  return METRIC_LABELS[key] || humanize(key);
}

export function latentLabel(key: string): string {
  return LATENT_LABELS[key] || humanize(key);
}

export function scenarioLabel(key: string): string {
  return SCENARIO_LABELS[key] || humanize(key);
}

export function leverLabel(key: string): string {
  return LEVER_LABELS[key] || humanize(key);
}

export function leverValueLabel(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "number") return Number.isFinite(value) ? String(Number(value.toFixed(3))) : "-";
  if (typeof value === "string") return LEVER_VALUE_LABELS[value] || humanize(value).toLowerCase();
  return JSON.stringify(value);
}
