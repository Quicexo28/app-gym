import { uid, type ExerciseCatalogItem } from "./storage";

type LegacyVariation = {
  id?: string;
  name?: string;
  subvariations?: LegacyVariation[];
};

type LegacyExercise = {
  id?: string;
  name?: string;
  groupName?: string;
  variations?: LegacyVariation[];
};

type Candidate = {
  id: string;
  name: string;
  group?: string;
  path?: string[];
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

function clean(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function keyOf(name: string): string {
  return name.trim().toLowerCase();
}

type AddCandidateArgs = {
  name: string;
  group: string;
  path?: string[];
  aliases: string[];
  idHint?: string;
  createdAtUtc: string;
};

function addCandidate(map: Map<string, Candidate>, args: AddCandidateArgs): void {
  const { name, group, aliases, idHint, createdAtUtc } = args;
  const normalizedName = clean(name);
  if (!normalizedName) return;

  const k = keyOf(normalizedName);
  const existing = map.get(k);
  if (existing) {
    if (!existing.group && group) existing.group = group;
    for (const alias of aliases) {
      const normalizedAlias = clean(alias);
      if (normalizedAlias && keyOf(normalizedAlias) !== k) {
        existing.aliases.add(normalizedAlias);
      }
    }
    return;
  }

  const aliasSet = new Set<string>();
  for (const alias of aliases) {
    const normalizedAlias = clean(alias);
    if (normalizedAlias && keyOf(normalizedAlias) !== k) {
      aliasSet.add(normalizedAlias);
    }
  }

  map.set(k, {
    id: idHint && clean(idHint) ? clean(idHint) : uid("ex"),
    name: normalizedName,
    group: group || undefined,
    path: args.path && args.path.length > 0 ? args.path : undefined,
    aliases: aliasSet,
    created_at_utc: createdAtUtc,
  });
}

type CollectArgs = {
  baseName: string;
  group: string;
  basePath: string[];
  variations: LegacyVariation[];
  chain: string[];
  createdAtUtc: string;
};

function collectVariations(map: Map<string, Candidate>, args: CollectArgs): void {
  const { baseName, group, basePath, variations, chain, createdAtUtc } = args;

  for (const variation of variations) {
    const varName = clean(variation.name);
    if (!varName) continue;

    const nextChain = [...chain, varName];
    const nextPath = [...basePath, varName];
    const composed = `${baseName} - ${nextChain.join(" - ")}`;
    addCandidate(map, {
      name: composed,
      group,
      path: nextPath,
      aliases: [baseName, varName],
      idHint: variation.id,
      createdAtUtc,
    });

    if (Array.isArray(variation.subvariations) && variation.subvariations.length > 0) {
      collectVariations(map, {
        baseName,
        group,
        basePath: nextPath,
        variations: variation.subvariations,
        chain: nextChain,
        createdAtUtc,
      });
    }
  }
}

function toCatalogItems(map: Map<string, Candidate>): ExerciseCatalogItem[] {
  return Array.from(map.values())
    .map((item) => ({
      id: item.id,
      name: item.name,
      group: item.group,
      path: item.path,
      aliases: item.aliases.size > 0 ? Array.from(item.aliases).sort() : undefined,
      created_at_utc: item.created_at_utc,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function parseLegacyExercises(raw: string): LegacyExercise[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("El archivo debe contener un array JSON de ejercicios.");
  }
  return parsed as LegacyExercise[];
}

function normalizeFromFile(raw: string): ExerciseCatalogItem[] {
  const source = parseLegacyExercises(raw);
  const map = new Map<string, Candidate>();
  const createdAtUtc = new Date().toISOString();

  for (const item of source) {
    const baseName = clean(item.name);
    if (!baseName) continue;
    const group = clean(item.groupName);
    const basePath = [group, baseName].filter(Boolean);

    addCandidate(map, {
      name: baseName,
      group,
      path: basePath.length > 0 ? basePath : [baseName],
      aliases: [],
      idHint: item.id,
      createdAtUtc,
    });

    if (Array.isArray(item.variations) && item.variations.length > 0) {
      collectVariations(map, {
        baseName,
        group,
        basePath: basePath.length > 0 ? basePath : [baseName],
        variations: item.variations,
        chain: [],
        createdAtUtc,
      });
    }
  }

  return toCatalogItems(map);
}

function mergeCatalog(
  existing: ExerciseCatalogItem[],
  incoming: ExerciseCatalogItem[],
): Pick<LegacyImportReport, "items" | "imported" | "updated" | "skippedAsDuplicate"> {
  const map = new Map<string, ExerciseCatalogItem>();
  for (const item of existing) {
    map.set(keyOf(item.name), item);
  }

  let imported = 0;
  let updated = 0;
  let skippedAsDuplicate = 0;

  for (const incomingItem of incoming) {
    const k = keyOf(incomingItem.name);
    const existingItem = map.get(k);
    if (!existingItem) {
      map.set(k, incomingItem);
      imported += 1;
      continue;
    }

    const mergedAliases = new Set<string>([
      ...(existingItem.aliases || []),
      ...(incomingItem.aliases || []),
    ]);
    const nextAliases = mergedAliases.size > 0 ? Array.from(mergedAliases).sort() : undefined;
    const nextGroup = existingItem.group || incomingItem.group;
    const nextPath = existingItem.path && existingItem.path.length > 0 ? existingItem.path : incomingItem.path;

    const changed =
      nextGroup !== existingItem.group ||
      JSON.stringify(nextPath || []) !== JSON.stringify(existingItem.path || []) ||
      JSON.stringify(nextAliases || []) !== JSON.stringify(existingItem.aliases || []);

    if (changed) {
      map.set(k, {
        ...existingItem,
        group: nextGroup,
        path: nextPath,
        aliases: nextAliases,
      });
      updated += 1;
    } else {
      skippedAsDuplicate += 1;
    }
  }

  const items = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  return { items, imported, updated, skippedAsDuplicate };
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
