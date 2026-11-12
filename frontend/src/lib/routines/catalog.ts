import type { ExerciseCatalogEntry } from "../exerciseCatalog";
import { normalizeLookupText } from "./draft";

export function pathKey(path: string[]): string {
  return path.map((segment) => normalizeLookupText(segment)).join(">");
}

export function buildNonLeafPathKeys(items: ExerciseCatalogEntry[]): Set<string> {
  const nonLeafKeys = new Set<string>();

  for (const item of items) {
    for (let depth = 1; depth < item.path.length; depth += 1) {
      nonLeafKeys.add(pathKey(item.path.slice(0, depth)));
    }
  }

  return nonLeafKeys;
}

/** Nombre normalizado -> grupo, solo cuando el nombre pertenece a un unico grupo. */
export function buildCatalogGroupByName(catalogEntries: ExerciseCatalogEntry[]): Map<string, string> {
  const grouped = new Map<string, Set<string>>();
  for (const entry of catalogEntries) {
    const key = normalizeLookupText(entry.name);
    if (!key) continue;
    const bucket = grouped.get(key) || new Set<string>();
    bucket.add(entry.group);
    grouped.set(key, bucket);
  }

  const map = new Map<string, string>();
  for (const [key, groups] of grouped.entries()) {
    if (groups.size !== 1) continue;
    const [singleGroup] = Array.from(groups);
    if (!singleGroup) continue;
    map.set(key, singleGroup);
  }
  return map;
}
