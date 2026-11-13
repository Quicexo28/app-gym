import { useMemo, useState } from "react";

import {
  ALL_EXERCISE_FILTER as ALL,
  ALL_EXERCISE_MOVEMENT_FILTER,
  ALL_EXERCISE_ZONE_FILTER,
  buildExerciseCatalogBrowser,
  tokenizeExerciseSearch,
  type ExerciseBodyZoneFilter,
  type ExerciseCatalogEntry,
  type ExerciseFilters,
} from "../../lib/exerciseCatalog";
import { buildTree, toTreeItems } from "../../lib/exerciseTree";
import { buildNonLeafPathKeys, pathKey } from "../../lib/routines/catalog";
import { useExerciseCatalog } from "../../state/exerciseCatalog";
import ExercisePickerModal from "../routines/ExercisePickerModal";

type SessionExercisePickerProps = {
  title: string;
  hint: string;
  isAdded: (entry: ExerciseCatalogEntry) => boolean;
  addedCount: number;
  onPick: (entry: ExerciseCatalogEntry) => void;
  onClose: () => void;
};

/** Selector de catálogo para la sesión activa (agregar o reemplazar un ejercicio). */
export default function SessionExercisePicker({ title, hint, isAdded, addedCount, onPick, onClose }: SessionExercisePickerProps) {
  const { entries: catalogEntries } = useExerciseCatalog();
  const [selectedGroup, setSelectedGroup] = useState<string>(ALL);
  const [selectedZone, setSelectedZone] = useState<ExerciseBodyZoneFilter>(ALL_EXERCISE_ZONE_FILTER);
  const [search, setSearch] = useState("");

  const filters = useMemo<ExerciseFilters>(
    () => ({ group: ALL, zone: selectedZone, movement: ALL_EXERCISE_MOVEMENT_FILTER, search }),
    [search, selectedZone],
  );
  const browser = useMemo(() => buildExerciseCatalogBrowser(catalogEntries, filters), [catalogEntries, filters]);
  const searchTokens = useMemo(() => tokenizeExerciseSearch(search), [search]);
  const treeItems = useMemo(() => toTreeItems(browser.filteredEntries, searchTokens), [browser.filteredEntries, searchTokens]);
  const tree = useMemo(() => buildTree(treeItems, searchTokens.length > 0), [treeItems, searchTokens.length]);
  const activeRootLabel = useMemo(() => {
    if (selectedGroup === ALL) return null;
    return tree.some((node) => node.label === selectedGroup) ? selectedGroup : null;
  }, [selectedGroup, tree]);
  const nonLeafPathKeys = useMemo(() => buildNonLeafPathKeys(catalogEntries), [catalogEntries]);

  return (
    <ExercisePickerModal
      title={title}
      hint={hint}
      selectedZone={selectedZone}
      selectedGroup={selectedGroup}
      search={search}
      catalogCount={catalogEntries.length}
      resultsCount={browser.filteredEntries.length}
      tree={tree}
      expandAll={searchTokens.length > 0}
      activeRootLabel={activeRootLabel}
      onZoneChange={setSelectedZone}
      onSearchChange={setSearch}
      onClearFilters={() => {
        setSelectedGroup(ALL);
        setSelectedZone(ALL_EXERCISE_ZONE_FILTER);
        setSearch("");
      }}
      onClose={onClose}
      onAdd={onPick}
      canAdd={(entry) => !nonLeafPathKeys.has(pathKey(entry.path))}
      isAdded={isAdded}
      addedCount={addedCount}
      onSelectGroup={(group) => setSelectedGroup((prev) => (prev === group ? ALL : group))}
    />
  );
}
