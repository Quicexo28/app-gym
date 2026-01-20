export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export type ExerciseCatalogItem = {
  id: string;
  name: string;
  group?: string;
  aliases?: string[];
  created_at_utc: string;
};

export type RoutineTemplate = {
  id: string;
  name: string;
  exercises: string[];
  created_at_utc: string;
};

const KEY_EXERCISES = "coach_ai_exercise_catalog_v1";
const KEY_ROUTINES = "coach_ai_routines_v1";

export function loadExerciseCatalog(): ExerciseCatalogItem[] {
  return loadJSON<ExerciseCatalogItem[]>(KEY_EXERCISES, []);
}

export function saveExerciseCatalog(items: ExerciseCatalogItem[]): void {
  saveJSON(KEY_EXERCISES, items);
}

export function loadRoutines(): RoutineTemplate[] {
  return loadJSON<RoutineTemplate[]>(KEY_ROUTINES, []);
}

export function saveRoutines(items: RoutineTemplate[]): void {
  saveJSON(KEY_ROUTINES, items);
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}
