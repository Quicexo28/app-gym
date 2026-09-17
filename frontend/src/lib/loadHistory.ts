import type { SessionExercise, SessionRecord, SessionSet } from "../api";

export type ExerciseLogPoint = {
  date: string;
  sets: SessionSet[];
  volumeKg: number;
  topLoadKg: number;
  totalReps: number;
};

function normalizeLookupText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function summarizeSets(sets: SessionSet[]): { volumeKg: number; topLoadKg: number; totalReps: number } {
  let volumeKg = 0;
  let topLoadKg = 0;
  let totalReps = 0;
  for (const set of sets) {
    const reps = Number(set.reps);
    const load = Number(set.load_kg);
    if (Number.isFinite(reps)) totalReps += reps;
    if (Number.isFinite(load)) topLoadKg = Math.max(topLoadKg, load);
    if (Number.isFinite(reps) && Number.isFinite(load)) volumeKg += reps * load;
  }
  return { volumeKg, topLoadKg, totalReps };
}

/** Histórico cronologico (asc) de un ejercicio puntual, agregando todas las sesiones que lo registraron. */
export function buildExerciseHistory(sessions: SessionRecord[], exerciseName: string): ExerciseLogPoint[] {
  const target = normalizeLookupText(exerciseName);
  if (!target) return [];

  const sorted = [...sessions].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  const points: ExerciseLogPoint[] = [];

  for (const session of sorted) {
    const matches = (session.exercises || []).filter(
      (exercise: SessionExercise) => normalizeLookupText(exercise.name) === target,
    );
    if (matches.length === 0) continue;

    const sets = matches.flatMap((exercise) => exercise.sets || []);
    if (sets.length === 0) continue;

    points.push({ date: session.start_time, sets, ...summarizeSets(sets) });
  }

  return points;
}

/** Nombres de ejercicio (tal como quedaron guardados en sesiones) con al menos un registro. */
export function loggedExerciseNames(sessions: SessionRecord[]): Set<string> {
  const out = new Set<string>();
  for (const session of sessions) {
    for (const exercise of session.exercises || []) {
      const key = normalizeLookupText(exercise.name);
      if (key) out.add(key);
    }
  }
  return out;
}

export function hasLoggedHistory(sessions: SessionRecord[], exerciseName: string): boolean {
  return loggedExerciseNames(sessions).has(normalizeLookupText(exerciseName));
}
