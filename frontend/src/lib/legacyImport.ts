import { cleanExerciseText, catalogPathKeyFromParts } from "./exerciseCatalog";
import { uid, type ExerciseCatalogItem } from "./storage";

type LegacyVariation = {
  id?: string;
  name?: string;
  subvariations?: LegacyVariation[];
  executionTypes?: LegacyVariation[];
  executionType?: LegacyVariation[];
};

type LegacyExercise = {
  id?: string;
  name?: string;
  groupName?: string;
  variations?: LegacyVariation[];
};

type FlatExerciseLike = {
  id?: unknown;
  group?: unknown;
  family?: unknown;
  variation?: unknown;
  subvariation?: unknown;
  aliases?: unknown;
  created_at_utc?: unknown;
};

type Candidate = {
  id: string;
  group: string;
  family: string;
  variation?: string;
  subvariation?: string;
  aliases: Set<string>;
  created_at_utc: string;
};

export type LegacyImportMode = "merge" | "replace";

export type LegacyImportReport = {
  items: ExerciseCatalogItem[];
  totalParsed: number;
  normalizedFromFile: number;
  imported: number;
  updated: number;
  skippedAsDuplicate: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clean(value: unknown): string {
  if (typeof value !== "string") return "";
  return cleanExerciseText(value);
}

function sortCatalog(items: ExerciseCatalogItem[]): ExerciseCatalogItem[] {
  return [...items].sort((a, b) => {
    const ak = [a.group, a.family, a.variation || "", a.subvariation || ""].join(" > ");
    const bk = [b.group, b.family, b.variation || "", b.subvariation || ""].join(" > ");
    return ak.localeCompare(bk);
  });
}

function candidateToItem(candidate: Candidate): ExerciseCatalogItem {
  const aliases = Array.from(candidate.aliases).map((alias) => clean(alias)).filter(Boolean);

  return {
    id: candidate.id,
    group: candidate.group,
    family: candidate.family,
    variation: candidate.variation || undefined,
    subvariation: candidate.subvariation || undefined,
    aliases: aliases.length > 0 ? Array.from(new Set(aliases)).sort((a, b) => a.localeCompare(b)) : undefined,
    created_at_utc: candidate.created_at_utc,
  };
}

function parseLegacyExercises(raw: string): LegacyExercise[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("El archivo debe contener un array JSON de ejercicios.");
  }
  return parsed as LegacyExercise[];
}

function addCandidate(map: Map<string, Candidate>, candidate: Candidate): void {
  const key = catalogPathKeyFromParts(
    candidate.group,
    candidate.family,
    candidate.variation || "",
    candidate.subvariation || "",
  );
  const existing = map.get(key);
  if (!existing) {
    map.set(key, candidate);
    return;
  }

  for (const alias of candidate.aliases) {
    existing.aliases.add(alias);
  }
}

function getLegacyVariationChildren(variation: LegacyVariation): LegacyVariation[] {
  const children: LegacyVariation[] = [];
  if (Array.isArray(variation.subvariations)) {
    children.push(...variation.subvariations);
  }
  if (Array.isArray(variation.executionTypes)) {
    children.push(...variation.executionTypes);
  }
  if (Array.isArray(variation.executionType)) {
    children.push(...variation.executionType);
  }
  return children;
}

function collectVariationCandidates(
  map: Map<string, Candidate>,
  baseName: string,
  group: string,
  variations: LegacyVariation[],
  chain: string[],
  createdAtUtc: string,
): void {
  for (const variation of variations) {
    const variationName = clean(variation.name);
    if (!variationName) continue;

    const nextChain = [...chain, variationName];
    const firstVariation = nextChain[0] || "";
    const subvariation = nextChain.slice(1).join(" > ");
    const aliasSeed = [baseName, ...nextChain].filter(Boolean);

    addCandidate(map, {
      id: clean(variation.id) || uid("ex"),
      group,
      family: baseName,
      variation: firstVariation || undefined,
      subvariation: subvariation || undefined,
      aliases: new Set(aliasSeed),
      created_at_utc: createdAtUtc,
    });

    const children = getLegacyVariationChildren(variation);
    if (children.length > 0) {
      collectVariationCandidates(map, baseName, group, children, nextChain, createdAtUtc);
    }
  }
}

function normalizeFromFile(raw: string): ExerciseCatalogItem[] {
  const source = parseLegacyExercises(raw);
  const map = new Map<string, Candidate>();
  const createdAtUtc = new Date().toISOString();

  for (const item of source) {
    const family = clean(item.name);
    if (!family) continue;

    const group = clean(item.groupName) || "General";
    addCandidate(map, {
      id: clean(item.id) || uid("ex"),
      group,
      family,
      variation: undefined,
      subvariation: undefined,
      aliases: new Set([family]),
      created_at_utc: createdAtUtc,
    });

    if (Array.isArray(item.variations) && item.variations.length > 0) {
      collectVariationCandidates(map, family, group, item.variations, [], createdAtUtc);
    }
  }

  return sortCatalog(Array.from(map.values()).map(candidateToItem));
}

function normalizeFlatExercise(item: FlatExerciseLike): ExerciseCatalogItem | null {
  const group = clean(item.group) || "General";
  const family = clean(item.family);
  if (!family) return null;

  const variation = clean(item.variation);
  const subvariation = clean(item.subvariation);
  const aliasesRaw = Array.isArray(item.aliases) ? item.aliases : [];
  const aliases = Array.from(
    new Set(
      aliasesRaw
        .map((alias) => clean(alias))
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));

  return {
    id: clean(item.id) || uid("ex"),
    group,
    family,
    variation: variation || undefined,
    subvariation: subvariation || undefined,
    aliases: aliases.length > 0 ? aliases : undefined,
    created_at_utc: clean(item.created_at_utc) || new Date().toISOString(),
  };
}

function normalizeFlatCatalog(source: unknown[]): ExerciseCatalogItem[] {
  const map = new Map<string, ExerciseCatalogItem>();

  for (const raw of source) {
    if (!isRecord(raw)) continue;
    const normalized = normalizeFlatExercise(raw as FlatExerciseLike);
    if (!normalized) continue;

    const key = catalogPathKeyFromParts(
      normalized.group,
      normalized.family,
      normalized.variation || "",
      normalized.subvariation || "",
    );
    const existing = map.get(key);
    if (!existing) {
      map.set(key, normalized);
      continue;
    }

    const mergedAliases = Array.from(
      new Set([...(existing.aliases || []), ...(normalized.aliases || [])].map((alias) => clean(alias)).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b));
    map.set(key, {
      ...existing,
      aliases: mergedAliases.length > 0 ? mergedAliases : undefined,
    });
  }

  return sortCatalog(Array.from(map.values()));
}

function looksLikeFlatCatalogArray(source: unknown[]): boolean {
  return source.some((item) => {
    if (!isRecord(item)) return false;
    return "family" in item || "group" in item || "subvariation" in item || "aliases" in item;
  });
}

export function parseExerciseImportFile(raw: string): ExerciseCatalogItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("El archivo no es JSON valido.");
  }

  if (isRecord(parsed) && Array.isArray(parsed.items)) {
    if (parsed.items.length === 0) return [];
    if (!looksLikeFlatCatalogArray(parsed.items)) {
      throw new Error("Formato no compatible. Usa JSON legacy o export global.");
    }
    return normalizeFlatCatalog(parsed.items);
  }

  if (Array.isArray(parsed) && looksLikeFlatCatalogArray(parsed)) {
    return normalizeFlatCatalog(parsed);
  }

  try {
    return importLegacyExercises(raw, [], "replace").items;
  } catch {
    throw new Error("Formato no compatible. Usa JSON legacy o export global.");
  }
}

function mergeCatalog(
  existing: ExerciseCatalogItem[],
  incoming: ExerciseCatalogItem[],
): Pick<LegacyImportReport, "items" | "imported" | "updated" | "skippedAsDuplicate"> {
  const map = new Map<string, ExerciseCatalogItem>();
  for (const item of existing) {
    const key = catalogPathKeyFromParts(item.group, item.family, item.variation || "", item.subvariation || "");
    map.set(key, item);
  }

  let imported = 0;
  let updated = 0;
  let skippedAsDuplicate = 0;

  for (const incomingItem of incoming) {
    const key = catalogPathKeyFromParts(
      incomingItem.group,
      incomingItem.family,
      incomingItem.variation || "",
      incomingItem.subvariation || "",
    );

    const existingItem = map.get(key);
    if (!existingItem) {
      map.set(key, incomingItem);
      imported += 1;
      continue;
    }

    const aliases = Array.from(
      new Set([...(existingItem.aliases || []), ...(incomingItem.aliases || [])].map((alias) => clean(alias)).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b));

    const changed = JSON.stringify(existingItem.aliases || []) !== JSON.stringify(aliases);
    if (!changed) {
      skippedAsDuplicate += 1;
      continue;
    }

    map.set(key, {
      ...existingItem,
      aliases: aliases.length > 0 ? aliases : undefined,
    });
    updated += 1;
  }

  return {
    items: sortCatalog(Array.from(map.values())),
    imported,
    updated,
    skippedAsDuplicate,
  };
}

export function importLegacyExercises(
  raw: string,
  existing: ExerciseCatalogItem[],
  mode: LegacyImportMode,
): LegacyImportReport {
  const normalizedFromFile = normalizeFromFile(raw);

  if (mode === "replace") {
    return {
      items: normalizedFromFile,
      totalParsed: normalizedFromFile.length,
      normalizedFromFile: normalizedFromFile.length,
      imported: normalizedFromFile.length,
      updated: 0,
      skippedAsDuplicate: 0,
    };
  }

  const merged = mergeCatalog(existing, normalizedFromFile);
  return {
    items: merged.items,
    totalParsed: normalizedFromFile.length,
    normalizedFromFile: normalizedFromFile.length,
    imported: merged.imported,
    updated: merged.updated,
    skippedAsDuplicate: merged.skippedAsDuplicate,
  };
}
