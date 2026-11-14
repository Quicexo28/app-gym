import { http } from "./core";

/** Musculo extra de un ejercicio compuesto: weight 1 = segundo principal, 0.5 = secundario. */
export type ExerciseExtraMuscle = { group: string; weight: number };

export type ExerciseScope = "global" | "custom";

export type ExerciseCatalogApiItem = {
  id: string;
  group: string;
  family: string;
  variation?: string | null;
  subvariation?: string | null;
  aliases: string[];
  extra_muscles?: ExerciseExtraMuscle[];
  scope: ExerciseScope;
  owner_user_id?: string | null;
  created_at_utc: string;
};

export type GlobalExerciseExportPayload = {
  schema: "coach_ai_exercise_catalog_global_v1";
  exported_at_utc: string;
  total: number;
  items: Array<{
    group: string;
    family: string;
    variation?: string | null;
    subvariation?: string | null;
    aliases: string[];
    extra_muscles?: ExerciseExtraMuscle[];
  }>;
};

export type RoutineStorePayload = {
  schema: string;
  scopes: Record<string, unknown[]>;
  updated_at_utc?: string | null;
};

export function getRoutineStore(): Promise<RoutineStorePayload> {
  return http("/api/v1/routines/store");
}

export function putRoutineStore(scopes: Record<string, unknown[]>): Promise<RoutineStorePayload> {
  return http("/api/v1/routines/store", {
    method: "PUT",
    body: JSON.stringify({ schema: "coach_ai_routines_v2", scopes }),
  });
}

export function getExerciseCatalog(): Promise<ExerciseCatalogApiItem[]> {
  return http("/api/v1/exercises/catalog");
}

export function createCustomExercise(payload: {
  group: string;
  family: string;
  variation?: string;
  subvariation?: string;
  aliases?: string[];
  extra_muscles?: ExerciseExtraMuscle[];
}): Promise<ExerciseCatalogApiItem> {
  return http("/api/v1/exercises/custom", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createGlobalExercise(payload: {
  group: string;
  family: string;
  variation?: string;
  subvariation?: string;
  aliases?: string[];
  extra_muscles?: ExerciseExtraMuscle[];
}): Promise<ExerciseCatalogApiItem> {
  return http("/api/v1/exercises/global", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateCustomExercise(
  exerciseId: string,
  payload: {
    group: string;
    family: string;
    variation?: string;
    subvariation?: string;
    aliases?: string[];
    extra_muscles?: ExerciseExtraMuscle[];
  },
): Promise<ExerciseCatalogApiItem> {
  return http(`/api/v1/exercises/custom/${encodeURIComponent(exerciseId)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function updateGlobalExercise(
  exerciseId: string,
  payload: {
    group: string;
    family: string;
    variation?: string;
    subvariation?: string;
    aliases?: string[];
    extra_muscles?: ExerciseExtraMuscle[];
  },
): Promise<ExerciseCatalogApiItem> {
  return http(`/api/v1/exercises/global/${encodeURIComponent(exerciseId)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteCustomExercise(exerciseId: string): Promise<{ ok: boolean; id: string }> {
  return http(`/api/v1/exercises/custom/${encodeURIComponent(exerciseId)}`, {
    method: "DELETE",
  });
}

export function deleteGlobalExercise(exerciseId: string): Promise<{ ok: boolean; id: string }> {
  return http(`/api/v1/exercises/global/${encodeURIComponent(exerciseId)}`, {
    method: "DELETE",
  });
}

export function importGlobalExercises(payload: {
  mode: "merge" | "replace";
  items: Array<{
    group: string;
    family: string;
    variation?: string;
    subvariation?: string;
    aliases?: string[];
  }>;
}): Promise<{ total: number; imported: number; updated: number; skipped: number }> {
  return http("/api/v1/exercises/global/import", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function exportGlobalExercises(): Promise<GlobalExerciseExportPayload> {
  return http("/api/v1/exercises/global/export");
}
