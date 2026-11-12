import { formatSetsRange } from "../storage";
import type { RoutineExerciseTemplate, RoutineTemplate } from "../storage";

export const DEFAULT_TARGET_SETS = 3;
export const SERIES_SUGGESTIONS = ["1", "1-2", "2", "2-3", "3", "3-4", "4"];
export const DEFAULT_TARGET_REPS_MIN = 8;
export const DEFAULT_TARGET_REPS_MAX = 12;
export const DEFAULT_REST_SECONDS = 90;
export const MAX_REST_SECONDS = 900;
export const MAX_REST_MINUTES = Math.floor(MAX_REST_SECONDS / 60);

export type DraftRoutineExercise = Omit<
  RoutineExerciseTemplate,
  "target_sets_min" | "target_sets_max" | "target_reps_min" | "target_reps_max" | "rest_seconds"
> & {
  target_sets: string;
  target_reps_min: string;
  target_reps_max: string;
  rest_minutes: string;
  rest_seconds: string;
};

export type DraftExercisePatch = Partial<
  Pick<DraftRoutineExercise, "target_sets" | "target_reps_min" | "target_reps_max" | "rest_minutes" | "rest_seconds">
>;

export function normalizeLookupText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function normalizeGroupLabel(value: string | undefined): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

export function parseBoundedInt(value: string, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

export function parseOptionalBoundedInt(value: string, min: number, max: number): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

export function clampRestSeconds(value: number): number {
  return Math.max(0, Math.min(MAX_REST_SECONDS, Math.round(value)));
}

export function routineExerciseIdentity(exercise: Pick<RoutineExerciseTemplate, "name" | "group">): string {
  return `${normalizeLookupText(exercise.group || "")}|${normalizeLookupText(exercise.name)}`;
}

export function inferLegacyExerciseGroup(name: string): string | null {
  if (!name.includes(">")) return null;
  const parts = name
    .split(">")
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  return parts[0] || null;
}

export function splitRestSeconds(totalSeconds: number): { rest_minutes: string; rest_seconds: string } {
  const safe = clampRestSeconds(totalSeconds);
  return {
    rest_minutes: String(Math.floor(safe / 60)),
    rest_seconds: String(safe % 60),
  };
}

export function normalizeDraftRestSeconds(exercise: DraftRoutineExercise): number {
  const parsedMinutes = parseOptionalBoundedInt(exercise.rest_minutes, 0, MAX_REST_MINUTES);
  const parsedSeconds = parseOptionalBoundedInt(exercise.rest_seconds, 0, 60);

  if (parsedMinutes === null && parsedSeconds === null) return 0;
  return clampRestSeconds((parsedMinutes ?? 0) * 60 + (parsedSeconds ?? 0));
}

export function toDraftExercise(exercise: RoutineExerciseTemplate): DraftRoutineExercise {
  return {
    name: exercise.name,
    group: exercise.group,
    target_sets: formatSetsRange(exercise.target_sets_min, exercise.target_sets_max),
    target_reps_min: String(exercise.target_reps_min),
    target_reps_max: String(exercise.target_reps_max),
    ...splitRestSeconds(exercise.rest_seconds),
  };
}

export function cloneRoutine(source: RoutineTemplate): RoutineTemplate {
  return {
    ...source,
    exercises: source.exercises.map((exercise) => ({ ...exercise })),
  };
}

/** Parche al editar Reps min / Reps max: mantiene min <= max. */
export function repsFieldPatch(
  field: "target_reps_min" | "target_reps_max",
  exercise: DraftRoutineExercise,
  rawValue: string,
): DraftExercisePatch {
  if (rawValue === "") return { [field]: "" };

  if (field === "target_reps_min") {
    const fallbackMin = parseBoundedInt(exercise.target_reps_min, DEFAULT_TARGET_REPS_MIN, 1, 100);
    const nextMin = parseBoundedInt(rawValue, fallbackMin, 1, 100);
    const patch: DraftExercisePatch = { target_reps_min: String(nextMin) };

    if (exercise.target_reps_max.trim() !== "") {
      const currentMax = parseBoundedInt(exercise.target_reps_max, DEFAULT_TARGET_REPS_MAX, 1, 100);
      patch.target_reps_max = String(Math.max(nextMin, currentMax));
    }
    return patch;
  }

  const fallbackMax = parseBoundedInt(exercise.target_reps_max, DEFAULT_TARGET_REPS_MAX, 1, 100);
  const nextMax = parseBoundedInt(rawValue, fallbackMax, 1, 100);
  const patch: DraftExercisePatch = { target_reps_max: String(nextMax) };

  if (exercise.target_reps_min.trim() !== "") {
    const currentMin = parseBoundedInt(exercise.target_reps_min, DEFAULT_TARGET_REPS_MIN, 1, 100);
    patch.target_reps_min = String(Math.min(currentMin, nextMax));
  }
  return patch;
}

/** Parche al editar descanso (minutos 0..MAX_REST_MINUTES, segundos 0..60). */
export function restFieldPatch(
  field: "rest_minutes" | "rest_seconds",
  exercise: DraftRoutineExercise,
  rawValue: string,
): DraftExercisePatch {
  if (rawValue === "") return { [field]: "" };

  const max = field === "rest_minutes" ? MAX_REST_MINUTES : 60;
  const fallback = parseOptionalBoundedInt(exercise[field], 0, max) ?? 0;
  const next = parseBoundedInt(rawValue, fallback, 0, max);
  return { [field]: String(next) };
}
