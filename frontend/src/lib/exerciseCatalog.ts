import type { ExerciseCatalogItem } from "./storage";

export const ALL_EXERCISE_FILTER = "__all__";

export type ExerciseCatalogEntry = {
  id: string;
  name: string;
  path: string[];
  aliases: string[];
  group: string;
  family: string;
  variation: string;
  subvariation: string;
  searchText: string;
};

export type ExerciseFilters = {
  group: string;
  family: string;
  variation: string;
  subvariation: string;
  search: string;
};

export type ExerciseFilterOptions = {
  groupOptions: string[];
  familyOptions: string[];
  variationOptions: string[];
  subvariationOptions: string[];
};

export function cleanExerciseText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSearchValue(value: string): string {
  return cleanExerciseText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function splitNameIntoPath(name: string): string[] {
  if (name.includes(">")) {
    return name
      .split(">")
      .map((value) => cleanExerciseText(value))
      .filter(Boolean);
  }

  return name
    .split(" - ")
    .map((value) => cleanExerciseText(value))
    .filter(Boolean);
}

export function normalizeExercisePath(item: ExerciseCatalogItem, fallbackGroup = "Sin grupo"): string[] {
  const fromPath = (item.path || []).map((value) => cleanExerciseText(value)).filter(Boolean);
  if (fromPath.length >= 2) {
    return fromPath;
  }

  const normalizedGroup = cleanExerciseText(item.group || "") || fallbackGroup;
  if (fromPath.length === 1) {
    return [normalizedGroup, fromPath[0]];
  }

  const name = cleanExerciseText(item.name);
  const nameParts = splitNameIntoPath(name);
  if (nameParts.length === 0) {
    return [normalizedGroup, name || "Sin nombre"];
  }

  if (normalizeSearchValue(nameParts[0]) === normalizeSearchValue(normalizedGroup)) {
    return nameParts;
  }

  return [normalizedGroup, ...nameParts];
}

export function toExerciseCatalogEntries(
  items: ExerciseCatalogItem[],
  fallbackGroup = "Sin grupo",
): ExerciseCatalogEntry[] {
  return items
    .map((item) => {
      const path = normalizeExercisePath(item, fallbackGroup);
      const name = cleanExerciseText(item.name) || "Sin nombre";
      const aliases = (item.aliases || []).map((alias) => cleanExerciseText(alias)).filter(Boolean);
      const group = path[0] || fallbackGroup;
      const family = path[1] || name;
      const variation = path[2] || "";
      const subvariation = path.length > 3 ? path.slice(3).join(" > ") : "";
      const searchableParts = [name, ...path, ...aliases].filter(Boolean);

      return {
        id: item.id,
        name,
        path,
        aliases,
        group,
        family,
        variation,
        subvariation,
        searchText: normalizeSearchValue(searchableParts.join(" ")),
      };
    })
    .sort((a, b) => a.path.join(" > ").localeCompare(b.path.join(" > ")));
}

export function getExerciseFilterOptions(entries: ExerciseCatalogEntry[], filters: ExerciseFilters): ExerciseFilterOptions {
  const groupOptions = uniqueSorted(entries.map((entry) => entry.group));

  const familyOptions = uniqueSorted(
    entries
      .filter((entry) => filters.group === ALL_EXERCISE_FILTER || entry.group === filters.group)
      .map((entry) => entry.family),
  );

  const variationOptions = uniqueSorted(
    entries
      .filter(
        (entry) =>
          (filters.group === ALL_EXERCISE_FILTER || entry.group === filters.group) &&
          (filters.family === ALL_EXERCISE_FILTER || entry.family === filters.family),
      )
      .map((entry) => entry.variation),
  );

  const subvariationOptions = uniqueSorted(
    entries
      .filter(
        (entry) =>
          (filters.group === ALL_EXERCISE_FILTER || entry.group === filters.group) &&
          (filters.family === ALL_EXERCISE_FILTER || entry.family === filters.family) &&
          (filters.variation === ALL_EXERCISE_FILTER || entry.variation === filters.variation),
      )
      .map((entry) => entry.subvariation),
  );

  return { groupOptions, familyOptions, variationOptions, subvariationOptions };
}

export function filterExerciseEntries(entries: ExerciseCatalogEntry[], filters: ExerciseFilters): ExerciseCatalogEntry[] {
  const query = normalizeSearchValue(filters.search);

  return entries.filter((entry) => {
    if (filters.group !== ALL_EXERCISE_FILTER && entry.group !== filters.group) return false;
    if (filters.family !== ALL_EXERCISE_FILTER && entry.family !== filters.family) return false;
    if (filters.variation !== ALL_EXERCISE_FILTER && entry.variation !== filters.variation) return false;
    if (filters.subvariation !== ALL_EXERCISE_FILTER && entry.subvariation !== filters.subvariation) return false;

    if (!query) return true;
    return entry.searchText.includes(query);
  });
}
