import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { renderExerciseTree } from "../components/ExerciseTree";
import Select from "../components/Select";
import {
  ALL_EXERCISE_FILTER as ALL,
  ALL_EXERCISE_MOVEMENT_FILTER,
  ALL_EXERCISE_ZONE_FILTER,
  buildExerciseCatalogBrowser,
  EXERCISE_ZONE_LOWER,
  EXERCISE_ZONE_UPPER,
  tokenizeExerciseSearch,
  type ExerciseBodyZoneFilter,
  type ExerciseCatalogEntry,
  type ExerciseFilters,
} from "../lib/exerciseCatalog";
import { useExerciseCatalog } from "../state/exerciseCatalog";
import {
  buildTree,
  toTreeItems,
} from "../lib/exerciseTree";

export default function CargasExercises() {
  const navigate = useNavigate();
  const { entries } = useExerciseCatalog();
  const [selectedGroup, setSelectedGroup] = useState<string>(ALL);
  const [selectedZone, setSelectedZone] = useState<ExerciseBodyZoneFilter>(ALL_EXERCISE_ZONE_FILTER);
  const [search, setSearch] = useState("");

  const filters = useMemo<ExerciseFilters>(
    () => ({ group: ALL, zone: selectedZone, movement: ALL_EXERCISE_MOVEMENT_FILTER, search }),
    [search, selectedZone],
  );
  const browser = useMemo(() => buildExerciseCatalogBrowser(entries, filters), [entries, filters]);
  const filteredEntries = browser.filteredEntries;
  const searchTokens = useMemo(() => tokenizeExerciseSearch(search), [search]);
  const treeItems = useMemo(() => toTreeItems(filteredEntries, searchTokens), [filteredEntries, searchTokens]);
  const tree = useMemo(() => buildTree(treeItems, searchTokens.length > 0), [treeItems, searchTokens.length]);
  const activeRootLabel = useMemo(() => {
    if (selectedGroup === ALL) return null;
    return tree.some((node) => node.label === selectedGroup) ? selectedGroup : null;
  }, [selectedGroup, tree]);

  const hasFilters = selectedGroup !== ALL || selectedZone !== ALL_EXERCISE_ZONE_FILTER || search.trim() !== "";

  function clearFilters() {
    setSelectedGroup(ALL);
    setSelectedZone(ALL_EXERCISE_ZONE_FILTER);
    setSearch("");
  }

  function selectGroupFromTree(groupValue: string) {
    setSelectedGroup((prev) => (prev === groupValue ? ALL : groupValue));
  }

  function openExercise(entry: ExerciseCatalogEntry) {
    navigate(`/profile/progress/cargas/ejercicio/${encodeURIComponent(entry.name)}`);
  }

  return (
    <section className="surface">
      <div className="sectionHead">
        <h3>Historial de ejercicios</h3>
        <p>Busca un ejercicio para ver su progreso de carga a lo largo del tiempo.</p>
      </div>

      <div className="splitGrid" style={{ marginTop: 10 }}>
        <div>
          <label className="smallLabel">Zona</label>
          <Select
            value={selectedZone}
            onChange={(v) => setSelectedZone(v as ExerciseBodyZoneFilter)}
            options={[
              { value: ALL_EXERCISE_ZONE_FILTER, label: "Todas" },
              { value: EXERCISE_ZONE_UPPER, label: "Superior" },
              { value: EXERCISE_ZONE_LOWER, label: "Inferior" },
            ]}
          />
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <label className="smallLabel" htmlFor="cargas-exercise-search">Buscar ejercicio</label>
        <input
          id="cargas-exercise-search"
          className="input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ej: sentadilla posterior smith"
        />
      </div>

      {hasFilters ? (
        <div className="chipRow" style={{ marginTop: 10 }}>
          <button type="button" className="btn" onClick={clearFilters}>
            Limpiar filtros
          </button>
        </div>
      ) : null}

      {filteredEntries.length === 0 ? (
        <div className="emptyState" style={{ marginTop: 12 }}>
          No hay ejercicios para este filtro.
        </div>
      ) : (
        <div className="treeList" style={{ marginTop: 12 }}>
          {renderExerciseTree(tree, {
            expandAll: searchTokens.length > 0,
            onSelectGroup: selectGroupFromTree,
            activeRootLabel,
            renderActions: (entry) => (
              <button className="btn" onClick={() => openExercise(entry)}>
                Ver progreso
              </button>
            ),
          })}
        </div>
      )}
    </section>
  );
}
