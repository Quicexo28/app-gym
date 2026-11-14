import type { SessionRecord } from "../api";
import { muscleWeights, type BodySlug } from "./bodyMap";

type CatalogItem = { name: string; group: string; extra_muscles?: Array<{ group: string; weight: number }> };

/** Un ejercicio cuenta para un grupo si lo trabaja como principal (1) o secundario (>= 0.5). */
const MIN_WEIGHT = 0.5;
/** Mas repeticiones que esto hacen poco fiable la estimacion de 1RM. */
const MAX_REPS_FOR_ESTIMATE = 12;
const RECENT_LIMIT = 5;
const RANK_LIMIT = 5;

export type MuscleRecentSession = {
  start_time: string;
  routineName: string | null;
  sets: number;
  exercises: string[];
};

export type MuscleRankEntry = {
  exercise: string;
  /** Valor del ranking: kg, kg de volumen en una serie, o % de mejora. */
  value: number;
  /** Detalle corto: "5 x 80 kg", "desde 90 kg" ... */
  detail: string;
};

export type MuscleStats = {
  slug: BodySlug;
  totalSets: number;
  recent: MuscleRecentSession[];
  /** 1RM real: la serie de 1 repeticion mas pesada. No es una estimacion. */
  oneRmReal: MuscleRankEntry[];
  /** 1RM calculado (Epley) con series de 2 a 12 repeticiones. Es una estimacion. */
  oneRmEstimated: MuscleRankEntry[];
  /** Mayor volumen (reps x kg) en una sola serie. */
  bestSetVolume: MuscleRankEntry[];
  /** Mayor mejora del 1RM calculado entre la primera y la mejor sesion. */
  bestImprovement: MuscleRankEntry[];
};

export function estimateOneRm(reps: number, loadKg: number): number {
  return reps <= 1 ? loadKg : loadKg * (1 + reps / 30);
}

function norm(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

function routineNameOf(session: SessionRecord): string | null {
  const name = session.meta?.routine_name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

function top(entries: MuscleRankEntry[]): MuscleRankEntry[] {
  return entries.sort((a, b) => b.value - a.value || a.exercise.localeCompare(b.exercise)).slice(0, RANK_LIMIT);
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Resumen de un grupo muscular desde las sesiones ya cargadas. Funcion pura. */
export function buildMuscleStats(sessions: SessionRecord[], catalog: Iterable<CatalogItem>, slug: BodySlug): MuscleStats {
  const items = new Map<string, CatalogItem>();
  for (const item of catalog) items.set(norm(item.name), item);

  const relevant = (exerciseName: string): boolean => {
    const item = items.get(norm(exerciseName));
    return item ? (muscleWeights(item).get(slug) ?? 0) >= MIN_WEIGHT : false;
  };

  const ordered = [...sessions].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  const recent: MuscleRecentSession[] = [];
  let totalSets = 0;
  const realBest = new Map<string, { load: number; name: string }>();
  const estBest = new Map<string, { value: number; reps: number; load: number; name: string }>();
  const volBest = new Map<string, { value: number; reps: number; load: number; name: string }>();
  // mejor 1RM calculado por sesion, en orden cronologico
  const perSession = new Map<string, { name: string; values: number[] }>();

  for (const session of ordered) {
    let sets = 0;
    const names: string[] = [];
    for (const exercise of session.exercises || []) {
      if (!relevant(exercise.name)) continue;
      const key = norm(exercise.name);
      const valid = (exercise.sets || []).filter((s) => s.reps > 0 && s.load_kg > 0);
      sets += (exercise.sets || []).length;
      if ((exercise.sets || []).length > 0) names.push(exercise.name);
      let sessionBest = 0;
      for (const set of valid) {
        if (set.reps === 1) {
          const prev = realBest.get(key);
          if (!prev || set.load_kg > prev.load) realBest.set(key, { load: set.load_kg, name: exercise.name });
        }
        if (set.reps <= MAX_REPS_FOR_ESTIMATE) {
          const value = estimateOneRm(set.reps, set.load_kg);
          sessionBest = Math.max(sessionBest, value);
          const prev = estBest.get(key);
          if (!prev || value > prev.value) estBest.set(key, { value, reps: set.reps, load: set.load_kg, name: exercise.name });
        }
        const volume = set.reps * set.load_kg;
        const prevVol = volBest.get(key);
        if (!prevVol || volume > prevVol.value) volBest.set(key, { value: volume, reps: set.reps, load: set.load_kg, name: exercise.name });
      }
      if (sessionBest > 0) {
        const entry = perSession.get(key) ?? { name: exercise.name, values: [] };
        entry.values.push(sessionBest);
        perSession.set(key, entry);
      }
    }
    if (sets > 0) {
      totalSets += sets;
      recent.push({ start_time: session.start_time, routineName: routineNameOf(session), sets, exercises: names });
    }
  }

  const bestImprovement: MuscleRankEntry[] = [];
  for (const { name, values } of perSession.values()) {
    if (values.length < 2) continue;
    const first = values[0];
    const best = Math.max(...values);
    if (best <= first) continue;
    bestImprovement.push({
      exercise: name,
      value: round1(((best - first) / first) * 100),
      detail: `${round1(first)} → ${round1(best)} kg (1RM calculado)`,
    });
  }

  return {
    slug,
    totalSets,
    recent: recent.reverse().slice(0, RECENT_LIMIT),
    oneRmReal: top([...realBest.values()].map((v) => ({ exercise: v.name, value: v.load, detail: "1 repetición" }))),
    oneRmEstimated: top(
      [...estBest.values()].map((v) => ({ exercise: v.name, value: round1(v.value), detail: `desde ${v.reps} × ${v.load} kg` })),
    ),
    bestSetVolume: top(
      [...volBest.values()].map((v) => ({ exercise: v.name, value: round1(v.value), detail: `${v.reps} × ${v.load} kg` })),
    ),
    bestImprovement: top(bestImprovement),
  };
}
