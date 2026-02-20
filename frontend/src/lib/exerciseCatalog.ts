import type { ExerciseCatalogItem } from "./storage";

export const ALL_EXERCISE_FILTER = "__all__";
export const EXERCISE_ZONE_UPPER = "upper";
export const EXERCISE_ZONE_LOWER = "lower";
export const ALL_EXERCISE_ZONE_FILTER = "__all_zone__";

export type ExerciseBodyZone = typeof EXERCISE_ZONE_UPPER | typeof EXERCISE_ZONE_LOWER;
export type ExerciseBodyZoneFilter = ExerciseBodyZone | typeof ALL_EXERCISE_ZONE_FILTER;

const LOWER_BODY_GROUP_TOKENS = new Set([
  "gluteo",
  "gluteos",
  "cuadriceps",
  "cuadricep",
  "femoral",
  "femorales",
  "pantorrilla",
  "pantorrillas",
  "abductor",
  "abductores",
  "aductor",
  "aductores",
]);

export type ExerciseFilters = {
  group: string;
  zone: ExerciseBodyZoneFilter;
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

type SearchAggressiveness = "strict" | "normal";

export function tokenizeExerciseSearch(value: string): string[] {
  const normalized = normalizeSearchValue(value);
  if (!normalized) return [];
  return normalized.split(" ").map((token) => token.trim()).filter(Boolean);
}

function tokenizeNormalizedWords(value: string): string[] {
  return value.split(/[^a-z0-9]+/).filter(Boolean);
}

function scoreTokenAgainstWord(token: string, word: string, aggressiveness: SearchAggressiveness): number {
  if (!token || !word) return 0;
  if (token === word) return 160;

  if (aggressiveness === "strict") {
    // Modo estricto (grupos): solo prefijo/exacto, pero sin umbral minimo.
    if (word.startsWith(token)) {
      const extraChars = Math.max(0, word.length - token.length);
      return Math.max(120, 170 - extraChars * 8);
    }
    if (token.length >= 2 && token.startsWith(word) && word.length >= 3) return 80;
    return 0;
  }

  if (word.startsWith(token)) {
    const extraChars = Math.max(0, word.length - token.length);
    return Math.max(110, 160 - extraChars * 6);
  }

  // Comportamiento tipo navegador: para 1 caracter solo prefijo;
  // para >=2 habilitamos contains.
  if (token.length >= 2 && word.includes(token)) return 95;
  if (token.length >= 3 && token.startsWith(word) && word.length >= 3) return 70;
  if (token.length >= 3 && token.includes(word) && word.length >= 3) return 55;
  return 0;
}

function scoreTokenAgainstTextWords(words: string[], token: string, aggressiveness: SearchAggressiveness): number {
  return words.reduce((best, word) => Math.max(best, scoreTokenAgainstWord(token, word, aggressiveness)), 0);
}

function computeSearchScore(
  searchText: string,
  searchTokens: string[],
  mode: "all_tokens" | "any_token",
  aggressiveness: SearchAggressiveness,
): number {
  if (searchTokens.length === 0) return 0;

  const normalizedText = normalizeSearchValue(searchText);
  const words = tokenizeNormalizedWords(normalizedText);
  if (words.length === 0) return 0;

  let score = 0;
  let matchedCount = 0;

  for (const token of searchTokens) {
    const tokenScore = scoreTokenAgainstTextWords(words, token, aggressiveness);
    if (tokenScore > 0) {
      score += tokenScore;
      matchedCount += 1;
      continue;
    }

    if (mode === "all_tokens") return 0;
  }

  if (matchedCount === 0) return 0;
  if (matchedCount > 1 && normalizedText.includes(searchTokens.join(" "))) {
    score += 40;
  }

  return score;
}

export function computeExerciseSearchScore(
  searchText: string,
  searchTokens: string[],
  aggressiveness: SearchAggressiveness = "normal",
): number {
  return computeSearchScore(searchText, searchTokens, "all_tokens", aggressiveness);
}

export function computeExerciseSearchPartialScore(
  searchText: string,
  searchTokens: string[],
  aggressiveness: SearchAggressiveness = "normal",
): number {
  return computeSearchScore(searchText, searchTokens, "any_token", aggressiveness);
}

function buildEntryBranchSearchText(entry: ExerciseCatalogEntry): string {
  return [entry.name, entry.family, entry.variation, entry.subvariation, ...entry.aliases].filter(Boolean).join(" ");
}

export function computeExerciseGroupPartialScore(group: string, searchTokens: string[]): number {
  return computeExerciseSearchPartialScore(group, searchTokens, "strict");
}

export function computeExerciseBranchPartialScore(text: string, searchTokens: string[]): number {
  return computeExerciseSearchPartialScore(text, searchTokens, "normal");
}

export function computeExerciseEntrySearchScore(entry: ExerciseCatalogEntry, searchTokens: string[]): number {
  if (searchTokens.length === 0) return 0;

  const branchSearch = buildEntryBranchSearchText(entry);
  const aliasesSearch = entry.aliases.join(" ");
  const normalizedPathSearch = normalizeSearchValue(entry.path.join(" "));
  const normalizedEntryName = normalizeSearchValue(entry.name);

  const SEGMENT_WEIGHT_GROUP = 1;
  const SEGMENT_WEIGHT_FAMILY = 2;
  const SEGMENT_WEIGHT_VARIATION = 3;
  const SEGMENT_WEIGHT_SUBVARIATION = 4;
  const SEGMENT_WEIGHT_NAME = 5;
  const SEGMENT_WEIGHT_ALIAS = 5;

  let score = 0;

  for (const token of searchTokens) {
    const groupScore = computeExerciseGroupPartialScore(entry.group, [token]) * SEGMENT_WEIGHT_GROUP;
    const familyScore = computeExerciseBranchPartialScore(entry.family, [token]) * SEGMENT_WEIGHT_FAMILY;
    const variationScore = computeExerciseBranchPartialScore(entry.variation, [token]) * SEGMENT_WEIGHT_VARIATION;
    const subvariationScore = computeExerciseBranchPartialScore(entry.subvariation, [token]) * SEGMENT_WEIGHT_SUBVARIATION;
    const nameScore = computeExerciseBranchPartialScore(entry.name, [token]) * SEGMENT_WEIGHT_NAME;
    const aliasScore = computeExerciseBranchPartialScore(aliasesSearch, [token]) * SEGMENT_WEIGHT_ALIAS;

    const tokenScore = Math.max(
      groupScore,
      familyScore,
      variationScore,
      subvariationScore,
      nameScore,
      aliasScore,
    );
    if (tokenScore <= 0) return 0;
    score += tokenScore;
  }

  if (searchTokens.length > 1) {
    const fullSearchText = normalizeSearchValue(`${entry.group} ${branchSearch} ${aliasesSearch}`);
    if (fullSearchText.includes(searchTokens.join(" "))) {
      score += 40;
    }

    // Orden de ruta: prioriza coincidencias que caen tal cual en el arbol.
    if (normalizedPathSearch.includes(searchTokens.join(" "))) {
      score += 120;
    }

    // Prioriza especificamente coincidencias sobre el final del arbol.
    if (normalizedEntryName.includes(searchTokens.join(" "))) {
      score += 180;
    }
  }

  // Desempate estable: ejercicios mas profundos ligeramente por encima.
  score += entry.depth * 10;

  return score;
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function includesByKey(selected: string, value: string): boolean {
  if (selected === ALL_EXERCISE_FILTER) return true;
  return normalizeSearchValue(selected) === normalizeSearchValue(value);
}

const GROUP_CANONICAL_MAP: Record<string, string> = {
  gemelo: "Pantorrillas",
  gemelos: "Pantorrillas",
  pantorrilla: "Pantorrillas",
  pantorrillas: "Pantorrillas",
  abductor: "Abductores",
  abductores: "Abductores",
  aductor: "Aductores",
  aductores: "Aductores",
};

export function canonicalizeExerciseGroup(group: string): string {
  const cleaned = cleanExerciseText(group);
  if (!cleaned) return "";

  const normalized = normalizeSearchValue(cleaned);
  return GROUP_CANONICAL_MAP[normalized] || cleaned;
}

export function getExerciseBodyZone(group: string): ExerciseBodyZone {
  const normalizedGroup = normalizeSearchValue(group);
  const words = tokenizeNormalizedWords(normalizedGroup);

  if (words.some((word) => LOWER_BODY_GROUP_TOKENS.has(word))) {
    return EXERCISE_ZONE_LOWER;
  }

  return EXERCISE_ZONE_UPPER;
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
      const group = canonicalizeExerciseGroup(item.group || "") || "General";
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
  const searchTokens = tokenizeExerciseSearch(filters.search);

  return entries.filter((entry) => {
    if (filters.zone !== ALL_EXERCISE_ZONE_FILTER && getExerciseBodyZone(entry.group) !== filters.zone) return false;
    if (filters.group !== ALL_EXERCISE_FILTER && !includesByKey(filters.group, entry.group)) return false;
    if (searchTokens.length > 0 && computeExerciseEntrySearchScore(entry, searchTokens) <= 0) return false;
    return true;
  });
}

export function getExerciseFilterOptions(
  entries: ExerciseCatalogEntry[],
  filters: ExerciseFilters,
): Pick<ExerciseCatalogBrowser, "groupOptions"> {
  const byGroupSearch = getFilteredForOptions(entries, filters);

  const groupOptions = uniqueSorted(byGroupSearch.map((entry) => entry.group));
  return { groupOptions };
}

export function filterExerciseEntries(entries: ExerciseCatalogEntry[], filters: ExerciseFilters): ExerciseCatalogEntry[] {
  const searchTokens = tokenizeExerciseSearch(filters.search);

  const scored = entries.flatMap((entry) => {
    if (filters.zone !== ALL_EXERCISE_ZONE_FILTER && getExerciseBodyZone(entry.group) !== filters.zone) return [];
    if (filters.group !== ALL_EXERCISE_FILTER && !includesByKey(filters.group, entry.group)) return [];

    const similarity = searchTokens.length === 0 ? 0 : computeExerciseEntrySearchScore(entry, searchTokens);
    if (searchTokens.length > 0 && similarity <= 0) return [];
    return [{ entry, similarity }];
  });

  scored.sort((a, b) => {
    if (searchTokens.length > 0 && b.similarity !== a.similarity) {
      return b.similarity - a.similarity;
    }
    return a.entry.path.join(" > ").localeCompare(b.entry.path.join(" > "));
  });

  return scored.map(({ entry }) => entry);
}

export function getVisibleExerciseEntries(
  entries: ExerciseCatalogEntry[],
  filters: ExerciseFilters,
): ExerciseCatalogEntry[] {
  return filterExerciseEntries(entries, filters);
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
