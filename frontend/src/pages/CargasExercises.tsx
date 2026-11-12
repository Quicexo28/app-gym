import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

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
  formatExerciseNameForList,
  formatExercisePathForList,
  toTreeItems,
  type CatalogNode,
} from "../lib/exerciseTree";

function renderTree(
  nodes: CatalogNode[],
  onSelect: (entry: ExerciseCatalogEntry) => void,
  expandAll: boolean,
  onSelectGroup: (group: string) => void,
  depth: number,
  activeRootLabel: string | null,
) {
  return nodes.map((node) => {
    const isRoot = depth === 1;
    const isSelectedRoot = isRoot && activeRootLabel === node.label;
    const isSiblingRoot = isRoot && activeRootLabel !== null && !isSelectedRoot;
    const isInSelectedBranch = activeRootLabel !== null && node.path[0] === activeRootLabel;
    const depthClass = depth >= 4 ? "treeNodeDepth4" : `treeNodeDepth${depth}`;
    const nodeClassName = [
      "treeNode",
      depthClass,
      isInSelectedBranch ? "treeNodeFocused" : "",
      isSelectedRoot ? "treeNodeSelectedRoot" : "",
      isSiblingRoot ? "treeNodeSiblingCollapsed" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const isOpen = isRoot && activeRootLabel !== null ? isSelectedRoot : expandAll;

    return (
      <details key={node.path.join(" > ")} className={nodeClassName} open={isOpen}>
        <summary
          className={`treeSummary ${isRoot ? "treeSummarySelectable" : ""} ${isSelectedRoot ? "treeSummarySelected" : ""}`}
          onClick={
            isRoot
              ? (event) => {
                  event.preventDefault();
                  onSelectGroup(node.label);
                }
              : undefined
          }
        >
          <span>{node.label}</span>
          <span className="chip">{node.totalItems}</span>
        </summary>

        <div className="treeChildren">
          {node.items.length > 0 ? (
            <div className="treeLeafList">
              {node.items.map((item) => (
                <article key={item.entry.id} className="treeLeaf">
                  <div>
                    <strong>{formatExerciseNameForList(item.entry.name)}</strong>
                    <div className="small">{formatExercisePathForList(item.treePath)}</div>
                  </div>
                  <button className="btn" onClick={() => onSelect(item.entry)}>
                    Ver progreso
                  </button>
                </article>
              ))}
            </div>
          ) : null}

          {node.children.length > 0
            ? renderTree(node.children, onSelect, expandAll, onSelectGroup, depth + 1, activeRootLabel)
            : null}
        </div>
      </details>
    );
  });
}

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
          {renderTree(tree, openExercise, searchTokens.length > 0, selectGroupFromTree, 1, activeRootLabel)}
        </div>
      )}
    </section>
  );
}
