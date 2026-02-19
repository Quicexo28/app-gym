import type { ExerciseCatalogItem } from "./storage";

export const ALL_EXERCISE_FILTER = "__all__";

export type ExerciseFilters = {
  group: string;
  family: string;
  variation: string;
  subvariation: string;
  search: string;
};

export type ExerciseCatalogEntry = {
  id: string;
  name: string;
  group: string;
  family: string;
  variation: string;
  subvariation: string;
  aliases: string[];
  scope: "global" | "custom";
  owner_user_id: string | null;
  path: string[];
  depth: 2 | 3 | 4;
  searchText: string;
  created_at_utc: string;
};

export type ExerciseCatalogBrowser = {
  groupOptions: string[];
  familyOptions: string[];
  variationOptions: string[];
  subvariationOptions: string[];
  filteredEntries: ExerciseCatalogEntry[];
  visibleEntries: ExerciseCatalogEntry[];
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

function includesByKey(selected: string, value: string): boolean {
  if (selected === ALL_EXERCISE_FILTER) return true;
  return normalizeSearchValue(selected) === normalizeSearchValue(value);
}

export function catalogPathFromParts(group: string, family: string, variation = "", subvariation = ""): string[] {
  const path = [cleanExerciseText(group), cleanExerciseText(family)];
  const variationClean = cleanExerciseText(variation);
  const subvariationClean = cleanExerciseText(subvariation);

  if (variationClean) path.push(variationClean);
  if (subvariationClean) path.push(subvariationClean);
  return path.filter(Boolean);
}

export function catalogPathKeyFromParts(group: string, family: string, variation = "", subvariation = ""): string {
  return [group, family, variation, subvariation]
    .map((value) => normalizeSearchValue(value))
    .join("|");
}

export function formatCatalogName(family: string, variation = "", subvariation = ""): string {
  return [family, variation, subvariation]
    .map((part) => cleanExerciseText(part))
    .filter(Boolean)
    .join(" - ");
}

export function toExerciseCatalogEntries(items: ExerciseCatalogItem[]): ExerciseCatalogEntry[] {
  return items
    .map((item) => {
      const group = cleanExerciseText(item.group || "") || "General";
      const family = cleanExerciseText(item.family || "");
      if (!family) return null;

      const variation = cleanExerciseText(item.variation || "");
      const subvariation = cleanExerciseText(item.subvariation || "");
      const aliases = (item.aliases || []).map((alias) => cleanExerciseText(alias)).filter(Boolean);
      const path = catalogPathFromParts(group, family, variation, subvariation);
      const name = formatCatalogName(family, variation, subvariation) || family;
      const searchable = [name, ...path, ...aliases].filter(Boolean).join(" ");
      const depth = path.length <= 2 ? 2 : path.length === 3 ? 3 : 4;

      return {
        id: item.id,
        name,
        group,
        family,
        variation,
        subvariation,
        aliases,
        scope: item.scope === "global" ? "global" : "custom",
        owner_user_id: item.owner_user_id || null,
        path,
        depth,
        searchText: normalizeSearchValue(searchable),
        created_at_utc: item.created_at_utc,
      } satisfies ExerciseCatalogEntry;
    })
    .filter((entry): entry is ExerciseCatalogEntry => Boolean(entry))
    .sort((a, b) => a.path.join(" > ").localeCompare(b.path.join(" > ")));
}

function getFilteredForOptions(entries: ExerciseCatalogEntry[], filters: ExerciseFilters): ExerciseCatalogEntry[] {
  const search = normalizeSearchValue(filters.search);

  return entries.filter((entry) => {
    if (filters.group !== ALL_EXERCISE_FILTER && !includesByKey(filters.group, entry.group)) return false;
    if (search && !entry.searchText.includes(search)) return false;
    return true;
  });
}

export function getExerciseFilterOptions(
  entries: ExerciseCatalogEntry[],
  filters: ExerciseFilters,
): Pick<ExerciseCatalogBrowser, "groupOptions" | "familyOptions" | "variationOptions" | "subvariationOptions"> {
  const byGroupSearch = getFilteredForOptions(entries, filters);

  const groupOptions = uniqueSorted(byGroupSearch.map((entry) => entry.group));

  const familyOptions = uniqueSorted(
    byGroupSearch
      .filter((entry) => filters.group === ALL_EXERCISE_FILTER || includesByKey(filters.group, entry.group))
      .map((entry) => entry.family),
  );

  const variationOptions = uniqueSorted(
    byGroupSearch
      .filter(
        (entry) =>
          (filters.group === ALL_EXERCISE_FILTER || includesByKey(filters.group, entry.group)) &&
          (filters.family === ALL_EXERCISE_FILTER || includesByKey(filters.family, entry.family)),
      )
      .map((entry) => entry.variation)
      .filter(Boolean),
  );

  const subvariationOptions = uniqueSorted(
    byGroupSearch
      .filter(
        (entry) =>
          (filters.group === ALL_EXERCISE_FILTER || includesByKey(filters.group, entry.group)) &&
          (filters.family === ALL_EXERCISE_FILTER || includesByKey(filters.family, entry.family)) &&
          (filters.variation === ALL_EXERCISE_FILTER || includesByKey(filters.variation, entry.variation)),
      )
      .map((entry) => entry.subvariation)
      .filter(Boolean),
  );

  return { groupOptions, familyOptions, variationOptions, subvariationOptions };
}

export function filterExerciseEntries(entries: ExerciseCatalogEntry[], filters: ExerciseFilters): ExerciseCatalogEntry[] {
  const search = normalizeSearchValue(filters.search);

  return entries.filter((entry) => {
    if (filters.group !== ALL_EXERCISE_FILTER && !includesByKey(filters.group, entry.group)) return false;
    if (filters.family !== ALL_EXERCISE_FILTER && !includesByKey(filters.family, entry.family)) return false;
    if (filters.variation !== ALL_EXERCISE_FILTER && !includesByKey(filters.variation, entry.variation)) return false;
    if (filters.subvariation !== ALL_EXERCISE_FILTER && !includesByKey(filters.subvariation, entry.subvariation)) return false;
    if (search && !entry.searchText.includes(search)) return false;
    return true;
  });
}

export function getVisibleExerciseEntries(
  entries: ExerciseCatalogEntry[],
  filters: ExerciseFilters,
): ExerciseCatalogEntry[] {
  const filtered = filterExerciseEntries(entries, filters);

  return filtered.filter((entry) => {
    if (filters.family === ALL_EXERCISE_FILTER) return entry.depth === 2;
    if (filters.variation === ALL_EXERCISE_FILTER) return entry.depth <= 3;
    if (filters.subvariation === ALL_EXERCISE_FILTER) return entry.depth <= 4;
    return true;
  });
}

export function buildExerciseCatalogBrowser(
  entries: ExerciseCatalogEntry[],
  filters: ExerciseFilters,
): ExerciseCatalogBrowser {
  const options = getExerciseFilterOptions(entries, filters);
  const filteredEntries = filterExerciseEntries(entries, filters);
  const visibleEntries = getVisibleExerciseEntries(entries, filters);
  return { ...options, filteredEntries, visibleEntries };
}
