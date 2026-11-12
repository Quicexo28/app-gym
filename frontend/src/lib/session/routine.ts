import type { RoutineExerciseTemplate, RoutineTemplate } from "../storage";
import type { RoutineExerciseDraft, SetRow } from "./types";

export const EMPTY_SET: SetRow = { reps: "", load: "", completed: false, effort: "" };

export function defaultSetForExercise(): SetRow {
  return {
    reps: "",
    load: "",
    completed: false,
    effort: "",
  };
}

export function normalizeRoutineExercises(source: RoutineExerciseTemplate[]): RoutineExerciseTemplate[] {
  const seen = new Set<string>();
  const out: RoutineExerciseTemplate[] = [];
  for (const raw of source) {
    const name = raw.name.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      group: raw.group,
      target_sets_min: Math.max(1, Math.min(30, Math.round(raw.target_sets_min || 1))),
      target_sets_max: Math.max(1, Math.min(30, Math.round(raw.target_sets_max || 1))),
      target_reps_min: Math.max(1, Math.min(100, Math.round(raw.target_reps_min || 1))),
      target_reps_max: Math.max(1, Math.min(100, Math.round(raw.target_reps_max || 1))),
      rest_seconds: Math.max(0, Math.min(900, Math.round(raw.rest_seconds || 0))),
    });
  }
  return out.map((exercise) => ({
    ...exercise,
    target_sets_min: Math.min(exercise.target_sets_min, exercise.target_sets_max),
    target_sets_max: Math.max(exercise.target_sets_min, exercise.target_sets_max),
    target_reps_min: Math.min(exercise.target_reps_min, exercise.target_reps_max),
    target_reps_max: Math.max(exercise.target_reps_min, exercise.target_reps_max),
  }));
}

export function routineToDraft(routine: RoutineTemplate): RoutineExerciseDraft[] {
  return normalizeRoutineExercises(routine.exercises).map((exercise) => ({
    name: exercise.name,
    group: exercise.group,
    athleteNote: "",
    target_reps_min: exercise.target_reps_min,
    target_reps_max: exercise.target_reps_max,
    rest_seconds: exercise.rest_seconds,
    sets: Array.from({ length: exercise.target_sets_min }, () => defaultSetForExercise()),
  }));
}

export function parseSetEffortValue(
  value: string,
  scale: "rpe" | "rir",
): {
  valid: boolean;
  hasValue: boolean;
  raw: number | null;
  rpe: number | null;
  rir: number | null;
} {
  const trimmed = value.trim();
  if (!trimmed) {
    return { valid: true, hasValue: false, raw: null, rpe: null, rir: null };
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { valid: false, hasValue: true, raw: null, rpe: null, rir: null };
  }

  if (scale === "rpe") {
    if (parsed < 0 || parsed > 10) {
      return { valid: false, hasValue: true, raw: parsed, rpe: null, rir: null };
    }
    const rounded = Number(parsed.toFixed(2));
    return { valid: true, hasValue: true, raw: rounded, rpe: rounded, rir: null };
  }

  if (parsed < 0 || parsed > 6) {
    return { valid: false, hasValue: true, raw: parsed, rpe: null, rir: null };
  }
  const roundedRir = Number(parsed.toFixed(2));
  const convertedRpe = Number(Math.max(0, Math.min(10, 10 - roundedRir)).toFixed(2));
  return { valid: true, hasValue: true, raw: roundedRir, rpe: convertedRpe, rir: roundedRir };
}
