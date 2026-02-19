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
  exercises: string[];
  created_at_utc: string;
};

const KEY_EXERCISES_V1 = "coach_ai_exercise_catalog_v1";
const KEY_EXERCISES_V2 = "coach_ai_exercise_catalog_v2";
const KEY_ROUTINES = "coach_ai_routines_v1";

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
  return loadJSON<RoutineTemplate[]>(KEY_ROUTINES, []);
}

export function saveRoutines(items: RoutineTemplate[]): void {
  saveJSON(KEY_ROUTINES, items);
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}
