import type { SessionRecord } from "../api";

/**
 * Los 15 grupos del mapa corporal: los mismos que MUSCLE_GROUPS del backend, en el mismo orden, sin tildes y en singular.
 * "espalda" es el grupo "Espalda Alta" del backend (romboides y espalda media).
 */
export const BODY_SLUGS = [
  "hombro",
  "bicep",
  "tricep",
  "pecho",
  "dorsal",
  "espalda",
  "trapecio",
  "lumbar",
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
  dorsal: "Dorsales",
  espalda: "Espalda alta",
  trapecio: "Trapecio",
  lumbar: "Lumbares",
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
  dorsal: "dorsal", dorsales: "dorsal",
  espalda: "espalda", romboide: "espalda", romboides: "espalda",
  trapecio: "trapecio", trapecios: "trapecio",
  lumbar: "lumbar", lumbares: "lumbar",
  abdomen: "abdomen", abdominal: "abdomen", abdominales: "abdomen", core: "abdomen",
  gluteo: "gluteo", gluteos: "gluteo",
  abductor: "abductor", abductores: "abductor",
  aductor: "aductor", aductores: "aductor",
  cuadricep: "cuadricep", cuadriceps: "cuadricep",
  femoral: "femoral", femorales: "femoral", isquiotibial: "femoral", isquiotibiales: "femoral",
  pantorrilla: "pantorrilla", pantorrillas: "pantorrilla", gemelo: "pantorrilla", gemelos: "pantorrilla",
};

/** Opacidad de un grupo sin series: 0, el cuerpo queda gris. */
export const MIN_OPACITY = 0;
/** Opacidad del grupo mas entrenado. */
export const MAX_OPACITY = 0.95;
/** Opacidad del grupo con menos datos (> 0): se separa claramente de "sin entrenar". */
const LOW_OPACITY = 0.3;

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Frases de varias palabras: se miran antes que las palabras sueltas (igual que _PHRASES del backend).
const PHRASES: Record<string, BodySlug> = {
  "espalda alta": "espalda",
  "espalda baja": "lumbar",
};

/** Resuelve un nombre de grupo del catalogo ("Glúteos", "Hombros"...) a uno de los 15 slugs, o null. */
export function toBodySlug(group: string | null | undefined): BodySlug | null {
  if (!group) return null;
  const words = stripAccents(group).split(/[^a-z0-9]+/).filter(Boolean);
  const text = words.join(" ");
  for (const [phrase, slug] of Object.entries(PHRASES)) if (text.includes(phrase)) return slug;
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

type MuscleItem = { group: string; extra_muscles?: Array<{ group: string; weight: number }> };

/**
 * Peso de cada grupo en un ejercicio: el principal pesa 1, los extra su `weight` (maximo 1).
 * Dos grupos del catalogo pueden caer en el mismo slug (p.ej. Pecho y Pectorales): gana el mayor peso.
 */
export function muscleWeights(item: MuscleItem | undefined): Map<BodySlug, number> {
  const weights = new Map<BodySlug, number>();
  const main = toBodySlug(item?.group);
  if (main) weights.set(main, 1);
  for (const extra of item?.extra_muscles || []) {
    const extraSlug = toBodySlug(extra.group);
    if (!extraSlug || !(extra.weight > 0)) continue;
    weights.set(extraSlug, Math.max(weights.get(extraSlug) ?? 0, Math.min(extra.weight, 1)));
  }
  return weights;
}

/** Valores 0..1 por grupo para marcar en el cuerpo los musculos que trabaja un ejercicio. */
export function exerciseBodyValues(item: MuscleItem | undefined): BodyValues {
  const values = emptyBodyValues();
  for (const [slug, weight] of muscleWeights(item)) values[slug] = weight;
  return values;
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
 * Un ejercicio compuesto suma ademas a sus musculos extra: peso 1 = segundo principal, 0.5 = secundario.
 */
export function aggregateSetsByBodyGroup(
  sessions: SessionRecord[],
  catalog: Iterable<{ name: string; group: string; extra_muscles?: Array<{ group: string; weight: number }> }>,
  sinceDays: number | null,
  now: Date = new Date(),
): BodyAggregation {
  const itemByName = new Map<string, { group: string; extra_muscles?: Array<{ group: string; weight: number }> }>();
  for (const item of catalog) itemByName.set(normalizeName(item.name), item);

  const cutoff = sinceDays == null ? -Infinity : now.getTime() - sinceDays * 86_400_000;
  const sets = emptyBodyValues();
  let unclassifiedSets = 0;

  for (const session of sessions) {
    const t = new Date(session.start_time).getTime();
    if (Number.isFinite(t) && t < cutoff) continue;
    for (const exercise of session.exercises || []) {
      const count = (exercise.sets || []).length;
      if (count === 0) continue;
      const item = itemByName.get(normalizeName(exercise.name));
      const slug = toBodySlug(item?.group);
      if (!slug) unclassifiedSets += count;
      const weights = muscleWeights(item);
      for (const [target, weight] of weights) sets[target] += count * weight;
    }
  }
  return { sets, unclassifiedSets };
}
