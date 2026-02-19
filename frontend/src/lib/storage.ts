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
};

export type RoutineExerciseTemplate = {
  name: string;
  target_sets: number;
  target_reps_min: number;
  target_reps_max: number;
  rest_seconds: number;
};

const KEY_EXERCISES_V1 = "coach_ai_exercise_catalog_v1";
const KEY_EXERCISES_V2 = "coach_ai_exercise_catalog_v2";
const KEY_ROUTINES = "coach_ai_routines_v1";
const DEFAULT_TARGET_SETS = 3;
const DEFAULT_TARGET_REPS_MIN = 8;
const DEFAULT_TARGET_REPS_MAX = 12;
const DEFAULT_REST_SECONDS = 90;

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

function normalizeRoutineExercise(raw: unknown): RoutineExerciseTemplate | null {
  if (typeof raw === "string") {
    const name = clean(raw);
    if (!name) return null;
    return {
      name,
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

  return {
    name,
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
    const key = normalizeKey(next.name);
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
  };
  const name = clean(source.name);
  if (!name) return null;
  const created = clean(source.created_at_utc) || new Date().toISOString();
  return {
    id: clean(source.id) || uid("rt"),
    name,
    exercises: normalizeRoutineExerciseList(source.exercises),
    created_at_utc: created,
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

export function loadRoutines(): RoutineTemplate[] {
  const rawValue = loadJSON<unknown>(KEY_ROUTINES, []);
  const raw = Array.isArray(rawValue) ? rawValue : [];
  const normalized = raw
    .map((entry) => normalizeRoutineTemplate(entry))
    .filter((entry): entry is RoutineTemplate => Boolean(entry));

  try {
    if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
      saveJSON(KEY_ROUTINES, normalized);
    }
  } catch {
    saveJSON(KEY_ROUTINES, normalized);
  }

  return normalized;
}

export function saveRoutines(items: RoutineTemplate[]): void {
  const normalized = items
    .map((entry) => normalizeRoutineTemplate(entry))
    .filter((entry): entry is RoutineTemplate => Boolean(entry));
  saveJSON(KEY_ROUTINES, normalized);
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}
