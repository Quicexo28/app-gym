import type { SessionRecord } from "../api";

/** Los 12 grupos del mapa corporal (mismos que MUSCLE_GROUPS del backend, sin tildes y en singular). */
export const BODY_SLUGS = [
  "hombro",
  "bicep",
  "tricep",
  "pecho",
  "espalda",
  "abdomen",
  "gluteo",
  "abductor",
  "aductor",
  "cuadricep",
  "femoral",
  "pantorrilla",
] as const;

export type BodySlug = (typeof BODY_SLUGS)[number];
export type BodyView = "front" | "back";

export const BODY_SLUG_LABELS: Record<BodySlug, string> = {
  hombro: "Hombros",
  bicep: "Bíceps",
  tricep: "Tríceps",
  pecho: "Pecho",
  espalda: "Espalda",
  abdomen: "Abdomen",
  gluteo: "Glúteos",
  abductor: "Abductores",
  aductor: "Aductores",
  cuadricep: "Cuádriceps",
  femoral: "Femorales",
  pantorrilla: "Pantorrillas",
};

// Alias (sin tildes, minusculas) -> slug. Mismos tokens que coach_ai.training_core.muscle_groups.
const ALIASES: Record<string, BodySlug> = {
  hombro: "hombro", hombros: "hombro", deltoide: "hombro", deltoides: "hombro",
  bicep: "bicep", biceps: "bicep",
  tricep: "tricep", triceps: "tricep",
  pecho: "pecho", pectoral: "pecho", pectorales: "pecho",
  espalda: "espalda", dorsal: "espalda", dorsales: "espalda", trapecio: "espalda", trapecios: "espalda",
  abdomen: "abdomen", abdominal: "abdomen", abdominales: "abdomen", core: "abdomen",
  gluteo: "gluteo", gluteos: "gluteo",
  abductor: "abductor", abductores: "abductor",
  aductor: "aductor", aductores: "aductor",
  cuadricep: "cuadricep", cuadriceps: "cuadricep",
  femoral: "femoral", femorales: "femoral", isquiotibial: "femoral", isquiotibiales: "femoral",
  pantorrilla: "pantorrilla", pantorrillas: "pantorrilla", gemelo: "pantorrilla", gemelos: "pantorrilla",
};

/** Opacidad de un grupo sin datos: visible pero tenue. */
export const MIN_OPACITY = 0.12;
/** Opacidad del grupo mas entrenado. */
export const MAX_OPACITY = 0.95;
/** Opacidad del grupo con menos datos (> 0): se separa claramente de "sin entrenar". */
const LOW_OPACITY = 0.3;

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Resuelve un nombre de grupo del catalogo ("Glúteos", "Hombros"...) a uno de los 12 slugs, o null. */
export function toBodySlug(group: string | null | undefined): BodySlug | null {
  if (!group) return null;
  const words = stripAccents(group).split(/[^a-z0-9]+/).filter(Boolean);
  for (const word of words) {
    const slug = ALIASES[word];
    if (slug) return slug;
  }
  return null;
}

export type BodyValues = Record<BodySlug, number>;

export function emptyBodyValues(): BodyValues {
  return Object.fromEntries(BODY_SLUGS.map((slug) => [slug, 0])) as BodyValues;
}

/** Valor / maximo, en [0, 1]. Sin datos (max <= 0) o valor <= 0 devuelve 0. */
export function normalizeBodyValue(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || value <= 0 || max <= 0) return 0;
  return Math.min(1, value / max);
}

/** Opacidad del color de acento: 0 -> MIN_OPACITY; (0, 1] -> LOW_OPACITY..MAX_OPACITY, monotona. */
export function bodyOpacity(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return MIN_OPACITY;
  return LOW_OPACITY + (MAX_OPACITY - LOW_OPACITY) * Math.min(1, ratio);
}

function normalizeName(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export type BodyAggregation = {
  /** Series registradas por grupo en el periodo. */
  sets: BodyValues;
  /** Series cuyo ejercicio no esta en el catalogo o cuyo grupo no mapea a un slug. */
  unclassifiedSets: number;
};

/**
 * Series por grupo muscular desde las sesiones ya cargadas (la misma fuente que las graficas de Cargas).
 * `catalog` mapea nombre de ejercicio -> grupo del catalogo. `sinceDays` null = todo el historico.
 */
export function aggregateSetsByBodyGroup(
  sessions: SessionRecord[],
  catalog: Iterable<{ name: string; group: string }>,
  sinceDays: number | null,
  now: Date = new Date(),
): BodyAggregation {
  const groupByName = new Map<string, string>();
  for (const item of catalog) groupByName.set(normalizeName(item.name), item.group);

  const cutoff = sinceDays == null ? -Infinity : now.getTime() - sinceDays * 86_400_000;
  const sets = emptyBodyValues();
  let unclassifiedSets = 0;

  for (const session of sessions) {
    const t = new Date(session.start_time).getTime();
    if (Number.isFinite(t) && t < cutoff) continue;
    for (const exercise of session.exercises || []) {
      const count = (exercise.sets || []).length;
      if (count === 0) continue;
      const slug = toBodySlug(groupByName.get(normalizeName(exercise.name)));
      if (slug) sets[slug] += count;
      else unclassifiedSets += count;
    }
  }
  return { sets, unclassifiedSets };
}
