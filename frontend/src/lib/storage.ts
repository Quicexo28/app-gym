import { getRoutineStore, putRoutineStore } from "../api";

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    // QuotaExceededError u otro fallo de persistencia: no tumbar la app.
    console.error(`No se pudo guardar "${key}" en localStorage`, err);
    return false;
  }
}

export type ExerciseCatalogItem = {
  id: string;
  group: string;
  family: string;
  variation?: string;
  subvariation?: string;
  aliases?: string[];
  scope?: "global" | "custom";
  owner_user_id?: string | null;
  created_at_utc: string;
};

type LegacyExerciseCatalogItem = {
  id: string;
  group?: string;
  family?: string;
  variation?: string;
  subvariation?: string;
  name?: string;
  aliases?: string[];
  path?: string[];
  scope?: "global" | "custom";
  owner_user_id?: string | null;
  created_at_utc?: string;
};

export type RoutineTemplate = {
  id: string;
  name: string;
  exercises: RoutineExerciseTemplate[];
  created_at_utc: string;
  shared_routine_id?: string;
  updated_at_utc?: string;
};

export type RoutineExerciseTemplate = {
  name: string;
  group?: string;
  target_sets: number;
  target_reps_min: number;
  target_reps_max: number;
  rest_seconds: number;
};

const KEY_EXERCISES_V1 = "coach_ai_exercise_catalog_v1";
const KEY_EXERCISES_V2 = "coach_ai_exercise_catalog_v2";
const KEY_ROUTINES = "coach_ai_routines_v1";
const ROUTINES_SCHEMA = "coach_ai_routines_v2";
const DEFAULT_ROUTINES_SCOPE = "__global__";
const DEFAULT_TARGET_SETS = 3;
const DEFAULT_TARGET_REPS_MIN = 8;
const DEFAULT_TARGET_REPS_MAX = 12;
const DEFAULT_REST_SECONDS = 90;

type RoutinesStoreV2 = {
  schema: typeof ROUTINES_SCHEMA;
  scopes: Record<string, RoutineTemplate[]>;
};

export type RoutinePropagationTarget = {
  athlete_id: string;
  routine_id: string;
  routine_name: string;
};

export type RoutinePropagationResult = {
  updated_count: number;
  athlete_ids: string[];
};

function clean(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function splitName(name: string): string[] {
  if (name.includes(">")) {
    return name
      .split(">")
      .map((part) => clean(part))
      .filter(Boolean);
  }

  return name
    .split(" - ")
    .map((part) => clean(part))
    .filter(Boolean);
}

function buildPathKey(group: string, family: string, variation: string, subvariation: string): string {
  return [group, family, variation, subvariation].map((value) => normalizeKey(value)).join("|");
}

function parseBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function parseOptionalBoundedInt(value: unknown, min: number, max: number): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function parseLegacyRepsRange(value: unknown): { min: number; max: number } | null {
  const text = clean(value);
  if (!text) return null;
  const matches = text.match(/\d+/g);
  if (!matches || matches.length === 0) return null;

  const values = matches
    .map((token) => Number(token))
    .filter((numeric) => Number.isFinite(numeric))
    .map((numeric) => Math.max(1, Math.min(100, Math.round(numeric))));

  if (values.length === 0) return null;
  if (values.length === 1) {
    return { min: values[0], max: values[0] };
  }

  const first = values[0];
  const second = values[1];
  return {
    min: Math.min(first, second),
    max: Math.max(first, second),
  };
}

function inferGroupFromRoutineExerciseName(name: string): string | null {
  if (!name.includes(">")) return null;
  const parts = name
    .split(">")
    .map((part) => clean(part))
    .filter(Boolean);
  if (parts.length < 2) return null;
  return clean(parts[0]) || null;
}

function normalizeRoutineExercise(raw: unknown): RoutineExerciseTemplate | null {
  if (typeof raw === "string") {
    const name = clean(raw);
    if (!name) return null;
    const inferredGroup = inferGroupFromRoutineExerciseName(name);
    return {
      name,
      group: inferredGroup || undefined,
      target_sets: DEFAULT_TARGET_SETS,
      target_reps_min: DEFAULT_TARGET_REPS_MIN,
      target_reps_max: DEFAULT_TARGET_REPS_MAX,
      rest_seconds: DEFAULT_REST_SECONDS,
    };
  }

  if (!raw || typeof raw !== "object") return null;
  const source = raw as {
    name?: unknown;
    target_sets?: unknown;
    sets?: unknown;
    target_reps_min?: unknown;
    reps_min?: unknown;
    target_reps_max?: unknown;
    reps_max?: unknown;
    target_reps?: unknown;
    reps?: unknown;
    rest_seconds?: unknown;
    rest_sec?: unknown;
    group?: unknown;
  };

  const name = clean(source.name);
  if (!name) return null;

  const targetSets = parseBoundedInt(source.target_sets ?? source.sets, DEFAULT_TARGET_SETS, 1, 30);
  const directRepsMin = parseOptionalBoundedInt(source.target_reps_min ?? source.reps_min, 1, 100);
  const directRepsMax = parseOptionalBoundedInt(source.target_reps_max ?? source.reps_max, 1, 100);
  const legacyRepsRange = parseLegacyRepsRange(source.target_reps ?? source.reps);
  const repsMin = directRepsMin ?? directRepsMax ?? legacyRepsRange?.min ?? DEFAULT_TARGET_REPS_MIN;
  const repsMax = directRepsMax ?? directRepsMin ?? legacyRepsRange?.max ?? DEFAULT_TARGET_REPS_MAX;
  const restSeconds = parseBoundedInt(source.rest_seconds ?? source.rest_sec, DEFAULT_REST_SECONDS, 0, 900);
  const normalizedRepsMin = Math.min(repsMin, repsMax);
  const normalizedRepsMax = Math.max(repsMin, repsMax);
  const explicitGroup = clean(source.group);
  const inferredGroup = inferGroupFromRoutineExerciseName(name);
  const normalizedGroup = explicitGroup || inferredGroup;

  return {
    name,
    group: normalizedGroup || undefined,
    target_sets: targetSets,
    target_reps_min: normalizedRepsMin,
    target_reps_max: normalizedRepsMax,
    rest_seconds: restSeconds,
  };
}

function normalizeRoutineExerciseList(raw: unknown): RoutineExerciseTemplate[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: RoutineExerciseTemplate[] = [];
  for (const entry of raw) {
    const next = normalizeRoutineExercise(entry);
    if (!next) continue;
    const key = `${normalizeKey(next.group || "")}|${normalizeKey(next.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }
  return out;
}

function normalizeRoutineTemplate(raw: unknown): RoutineTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as {
    id?: unknown;
    name?: unknown;
    exercises?: unknown;
    created_at_utc?: unknown;
    shared_routine_id?: unknown;
    updated_at_utc?: unknown;
  };
  const name = clean(source.name);
  if (!name) return null;
  const created = clean(source.created_at_utc) || new Date().toISOString();
  const sharedRoutineId = clean(source.shared_routine_id) || uid("srt");
  const updatedAt = clean(source.updated_at_utc);
  return {
    id: clean(source.id) || uid("rt"),
    name,
    exercises: normalizeRoutineExerciseList(source.exercises),
    created_at_utc: created,
    shared_routine_id: sharedRoutineId,
    updated_at_utc: updatedAt || undefined,
  };
}

function toCanonicalItem(source: LegacyExerciseCatalogItem): ExerciseCatalogItem | null {
  const path = (source.path || []).map((part) => clean(part)).filter(Boolean);
  const groupFromField = clean(source.group);
  const familyFromField = clean(source.family);
  const variationFromField = clean(source.variation);
  const subvariationFromField = clean(source.subvariation);
  const name = clean(source.name);
  const nameParts = splitName(name);

  let group = groupFromField;
  let family = "";
  let variation = "";
  let subvariation = "";

  if (familyFromField) {
    group = groupFromField || "General";
    family = familyFromField;
    variation = variationFromField;
    subvariation = subvariationFromField;
  } else if (path.length >= 2) {
    group = group || path[0];
    family = path[1];
    if (path.length >= 3) variation = path[2];
    if (path.length >= 4) subvariation = path.slice(3).join(" > ");

    if (path.length === 2 && nameParts.length > 1) {
      const pathFamily = normalizeKey(family);
      const nameFamily = normalizeKey(nameParts[0] || "");
      const nameComposed = normalizeKey(nameParts.join(" - "));
      const rawName = normalizeKey(name);

      if (pathFamily === nameFamily || pathFamily === nameComposed || pathFamily === rawName) {
        family = nameParts[0] || family;
        variation = nameParts[1] || variation;
        subvariation = nameParts.slice(2).join(" > ") || subvariation;
      }
    }
  } else if (path.length === 1) {
    group = group || "General";
    if (nameParts.length > 1) {
      family = nameParts[0] || path[0];
      variation = nameParts[1] || "";
      subvariation = nameParts.slice(2).join(" > ");
    } else {
      family = path[0];
    }
  } else if (nameParts.length > 0) {
    group = group || "General";
    family = nameParts[0] || "";
    variation = nameParts[1] || "";
    subvariation = nameParts.slice(2).join(" > ");
  }

  group = clean(group) || "General";
  family = clean(family);
  variation = clean(variation);
  subvariation = clean(subvariation);

  if (!family) return null;

  const aliases = (source.aliases || []).map((alias) => clean(alias)).filter(Boolean);
  const dedupAliases = Array.from(new Set(aliases));

  return {
    id: clean(source.id) || uid("ex"),
    group,
    family,
    variation: variation || undefined,
    subvariation: subvariation || undefined,
    aliases: dedupAliases.length > 0 ? dedupAliases : undefined,
    scope: source.scope === "global" ? "global" : "custom",
    owner_user_id: source.owner_user_id || null,
    created_at_utc: source.created_at_utc || new Date().toISOString(),
  };
}

function migrateCatalog(items: LegacyExerciseCatalogItem[]): ExerciseCatalogItem[] {
  const map = new Map<string, ExerciseCatalogItem>();

  for (const raw of items) {
    const next = toCanonicalItem(raw);
    if (!next) continue;

    const key = `${next.scope || "custom"}|${next.owner_user_id || ""}|${buildPathKey(next.group, next.family, next.variation || "", next.subvariation || "")}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, next);
      continue;
    }

    const aliases = Array.from(
      new Set([...(existing.aliases || []), ...(next.aliases || [])].map((alias) => clean(alias)).filter(Boolean)),
    );

    map.set(key, {
      ...existing,
      aliases: aliases.length > 0 ? aliases.sort((a, b) => a.localeCompare(b)) : undefined,
    });
  }

  return Array.from(map.values()).sort((a, b) => {
    const ak = [a.scope || "custom", a.group, a.family, a.variation || "", a.subvariation || ""].join(" > ");
    const bk = [b.scope || "custom", b.group, b.family, b.variation || "", b.subvariation || ""].join(" > ");
    return ak.localeCompare(bk);
  });
}

export function loadExerciseCatalog(): ExerciseCatalogItem[] {
  const v2 = loadJSON<ExerciseCatalogItem[]>(KEY_EXERCISES_V2, []);
  if (v2.length > 0) {
    return migrateCatalog(v2 as LegacyExerciseCatalogItem[]);
  }

  const legacy = loadJSON<LegacyExerciseCatalogItem[]>(KEY_EXERCISES_V1, []);
  if (legacy.length === 0) return [];

  const migrated = migrateCatalog(legacy);
  if (migrated.length > 0) {
    saveJSON(KEY_EXERCISES_V2, migrated);
  }
  return migrated;
}

export function saveExerciseCatalog(items: ExerciseCatalogItem[]): void {
  const normalized = migrateCatalog(items as LegacyExerciseCatalogItem[]);
  saveJSON(KEY_EXERCISES_V2, normalized);
}

function normalizeRoutineScopeKey(athleteId?: string | null): string {
  const normalized = clean(athleteId);
  return normalized || DEFAULT_ROUTINES_SCOPE;
}

function normalizeRoutineList(raw: unknown): RoutineTemplate[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: RoutineTemplate[] = [];
  for (const entry of raw) {
    const next = normalizeRoutineTemplate(entry);
    if (!next) continue;
    if (seen.has(next.id)) continue;
    seen.add(next.id);
    out.push(next);
  }
  return out;
}

function normalizeRoutinesStore(rawValue: unknown): RoutinesStoreV2 {
  const scopes: Record<string, RoutineTemplate[]> = {};

  const assignScope = (scopeRaw: string, itemsRaw: unknown) => {
    const scope = normalizeRoutineScopeKey(scopeRaw);
    scopes[scope] = normalizeRoutineList(itemsRaw);
  };

  if (Array.isArray(rawValue)) {
    assignScope(DEFAULT_ROUTINES_SCOPE, rawValue);
    return { schema: ROUTINES_SCHEMA, scopes };
  }

  if (rawValue && typeof rawValue === "object") {
    const source = rawValue as { schema?: unknown; scopes?: unknown };
    const sourceScopes =
      source.schema === ROUTINES_SCHEMA && source.scopes && typeof source.scopes === "object" && !Array.isArray(source.scopes)
        ? source.scopes
        : rawValue;

    if (sourceScopes && typeof sourceScopes === "object" && !Array.isArray(sourceScopes)) {
      for (const [scope, maybeList] of Object.entries(sourceScopes as Record<string, unknown>)) {
        if (scope === "schema") continue;
        if (scope === "scopes" && maybeList && typeof maybeList === "object" && !Array.isArray(maybeList)) {
          for (const [innerScope, innerList] of Object.entries(maybeList as Record<string, unknown>)) {
            assignScope(innerScope, innerList);
          }
          continue;
        }
        assignScope(scope, maybeList);
      }
    }
  }

  return { schema: ROUTINES_SCHEMA, scopes };
}

function cloneRoutineList(items: RoutineTemplate[]): RoutineTemplate[] {
  return items.map((entry) => ({
    ...entry,
    exercises: entry.exercises.map((exercise) => ({ ...exercise })),
  }));
}

function cloneRoutineForScope(template: RoutineTemplate): RoutineTemplate {
  return {
    ...template,
    id: uid("rt"),
    created_at_utc: new Date().toISOString(),
    updated_at_utc: undefined,
    exercises: template.exercises.map((exercise) => ({ ...exercise })),
  };
}

function readRoutinesStore(): RoutinesStoreV2 {
  const rawValue = loadJSON<unknown>(KEY_ROUTINES, []);
  const normalized = normalizeRoutinesStore(rawValue);

  try {
    if (JSON.stringify(rawValue) !== JSON.stringify(normalized)) {
      saveJSON(KEY_ROUTINES, normalized);
    }
  } catch {
    saveJSON(KEY_ROUTINES, normalized);
  }

  return normalized;
}

function writeRoutinesStore(store: RoutinesStoreV2): void {
  saveJSON(KEY_ROUTINES, normalizeRoutinesStore(store));
  scheduleRoutinesPush();
}

// --- Sync de rutinas con backend (write-through, last-write-wins) ---

export const ROUTINES_HYDRATED_EVENT = "coach-ai:routines-hydrated";

let routineSyncEnabled = false;
let routinePushTimer: ReturnType<typeof setTimeout> | null = null;

function currentScopesForBackend(): Record<string, unknown[]> {
  const raw = loadJSON<unknown>(KEY_ROUTINES, []);
  const normalized = normalizeRoutinesStore(raw);
  return normalized.scopes as unknown as Record<string, unknown[]>;
}

function scheduleRoutinesPush(): void {
  if (!routineSyncEnabled) return;
  if (routinePushTimer !== null) clearTimeout(routinePushTimer);
  routinePushTimer = setTimeout(() => {
    routinePushTimer = null;
    putRoutineStore(currentScopesForBackend()).catch((err) => {
      console.warn("No se pudo sincronizar rutinas con el backend", err);
    });
  }, 1200);
}

function storeHasRoutines(scopes: Record<string, unknown>): boolean {
  return Object.values(scopes).some((list) => Array.isArray(list) && list.length > 0);
}

/**
 * Trae el store remoto y reconcilia con localStorage.
 * Remoto no vacío gana (última escritura); si solo hay datos locales, se suben.
 * El push write-through queda habilitado solo tras hidratar con éxito, para no
 * pisar datos remotos nuevos con una copia local vieja tras un fallo de red.
 */
export async function hydrateRoutinesFromBackend(): Promise<void> {
  try {
    const remote = await getRoutineStore();
    const remoteScopes =
      remote && typeof remote.scopes === "object" && remote.scopes !== null ? remote.scopes : {};
    const localScopes = currentScopesForBackend();

    if (storeHasRoutines(remoteScopes)) {
      const normalized = normalizeRoutinesStore({ schema: ROUTINES_SCHEMA, scopes: remoteScopes });
      saveJSON(KEY_ROUTINES, normalized);
      window.dispatchEvent(new CustomEvent(ROUTINES_HYDRATED_EVENT));
    } else if (storeHasRoutines(localScopes)) {
      await putRoutineStore(localScopes);
    }
    routineSyncEnabled = true;
  } catch (err) {
    console.warn("No se pudo hidratar rutinas desde el backend; modo local", err);
  }
}

function routineMatchesByIdentity(source: RoutineTemplate, candidate: RoutineTemplate): boolean {
  if (source.shared_routine_id && candidate.shared_routine_id && source.shared_routine_id === candidate.shared_routine_id) {
    return true;
  }
  return normalizeKey(source.name) === normalizeKey(candidate.name);
}

function resolveCandidateScopes(store: RoutinesStoreV2, athleteIds?: string[]): string[] {
  if (Array.isArray(athleteIds) && athleteIds.length > 0) {
    return Array.from(new Set(athleteIds.map((value) => normalizeRoutineScopeKey(value)))).filter(Boolean);
  }
  return Object.keys(store.scopes).filter((scope) => scope !== DEFAULT_ROUTINES_SCOPE);
}

export function loadRoutines(athleteId?: string | null): RoutineTemplate[] {
  const store = readRoutinesStore();
  const scope = normalizeRoutineScopeKey(athleteId);
  const hasScope = Object.prototype.hasOwnProperty.call(store.scopes, scope);

  if (!hasScope && scope !== DEFAULT_ROUTINES_SCOPE) {
    const defaults = store.scopes[DEFAULT_ROUTINES_SCOPE] || [];
    if (defaults.length > 0) {
      store.scopes[scope] = defaults.map((entry) => cloneRoutineForScope(entry));
      writeRoutinesStore(store);
    }
  }

  return cloneRoutineList(store.scopes[scope] || []);
}

export function saveRoutines(items: RoutineTemplate[], athleteId?: string | null): void {
  const scope = normalizeRoutineScopeKey(athleteId);
  const store = readRoutinesStore();
  store.scopes[scope] = normalizeRoutineList(items);
  writeRoutinesStore(store);
}

export function listRoutinePropagationTargets(params: {
  source_athlete_id?: string | null;
  source_routine_id: string;
  athlete_ids?: string[];
}): RoutinePropagationTarget[] {
  const store = readRoutinesStore();
  const sourceScope = normalizeRoutineScopeKey(params.source_athlete_id);
  const sourceList = store.scopes[sourceScope] || [];
  const sourceRoutine = sourceList.find((entry) => entry.id === params.source_routine_id);
  if (!sourceRoutine) return [];

  const targets: RoutinePropagationTarget[] = [];
  const candidateScopes = resolveCandidateScopes(store, params.athlete_ids);

  for (const scope of candidateScopes) {
    if (scope === sourceScope) continue;
    const routines = store.scopes[scope] || [];
    for (const routine of routines) {
      if (!routineMatchesByIdentity(sourceRoutine, routine)) continue;
      targets.push({
        athlete_id: scope,
        routine_id: routine.id,
        routine_name: routine.name,
      });
      break;
    }
  }

  return targets.sort((a, b) => a.athlete_id.localeCompare(b.athlete_id));
}

export function propagateRoutineUpdate(params: {
  source_athlete_id?: string | null;
  source_routine_id: string;
  next_name: string;
  next_exercises: RoutineExerciseTemplate[];
  athlete_ids?: string[];
}): RoutinePropagationResult {
  const store = readRoutinesStore();
  const sourceScope = normalizeRoutineScopeKey(params.source_athlete_id);
  const sourceList = store.scopes[sourceScope] || [];
  const sourceRoutine = sourceList.find((entry) => entry.id === params.source_routine_id);
  if (!sourceRoutine) return { updated_count: 0, athlete_ids: [] };

  const normalizedExercises = normalizeRoutineExerciseList(params.next_exercises);
  const nextName = clean(params.next_name) || sourceRoutine.name;
  const updatedAt = new Date().toISOString();
  const candidateScopes = resolveCandidateScopes(store, params.athlete_ids);
  const touchedAthletes = new Set<string>();
  let updatedCount = 0;

  for (const scope of candidateScopes) {
    if (scope === sourceScope) continue;
    const routines = store.scopes[scope] || [];
    let scopeChanged = false;
    store.scopes[scope] = routines.map((routine) => {
      if (!routineMatchesByIdentity(sourceRoutine, routine)) return routine;
      scopeChanged = true;
      updatedCount += 1;
      return {
        ...routine,
        name: nextName,
        exercises: normalizedExercises.map((exercise) => ({ ...exercise })),
        shared_routine_id: sourceRoutine.shared_routine_id || routine.shared_routine_id || uid("srt"),
        updated_at_utc: updatedAt,
      };
    });

    if (scopeChanged) {
      touchedAthletes.add(scope);
    }
  }

  if (updatedCount > 0) {
    writeRoutinesStore(store);
  }

  return {
    updated_count: updatedCount,
    athlete_ids: Array.from(touchedAthletes).sort((a, b) => a.localeCompare(b)),
  };
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}
