import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import Select from "../components/Select";
import {
  ALL_EXERCISE_FILTER as ALL,
  ALL_EXERCISE_MOVEMENT_FILTER,
  ALL_EXERCISE_ZONE_FILTER,
  buildExerciseCatalogBrowser,
  computeExerciseEntrySearchScore,
  EXERCISE_ZONE_LOWER,
  EXERCISE_ZONE_UPPER,
  tokenizeExerciseSearch,
  type ExerciseBodyZoneFilter,
  type ExerciseCatalogEntry,
  type ExerciseFilters,
} from "../lib/exerciseCatalog";
import { useExerciseCatalog } from "../state/exerciseCatalog";

type MutableNode = {
  label: string;
  path: string[];
  children: Map<string, MutableNode>;
  items: TreeItem[];
};

type CatalogNode = {
  label: string;
  path: string[];
  children: CatalogNode[];
  items: TreeItem[];
  totalItems: number;
  maxScore: number;
};

type TreeItem = {
  entry: ExerciseCatalogEntry;
  treePath: string[];
  matchScore: number;
};

function formatExerciseNameForList(name: string): string {
  return name.replace(/\s*>\s*/g, " - ").trim();
}

function formatExercisePathForList(path: string[]): string {
  return path.map((segment) => formatExerciseNameForList(segment)).join(" - ");
}

function toTreeItems(entries: ExerciseCatalogEntry[], searchTokens: string[]): TreeItem[] {
  return entries.map((entry) => {
    const matchScore = searchTokens.length > 0 ? computeExerciseEntrySearchScore(entry, searchTokens) : 0;
    return { entry, treePath: entry.path, matchScore };
  });
}

function freezeNodes(source: Map<string, MutableNode>, rankBySimilarity: boolean): CatalogNode[] {
  const nodes = Array.from(source.values()).map((node) => {
    const children = freezeNodes(node.children, rankBySimilarity);
    const items = [...node.items].sort((a, b) => {
      if (rankBySimilarity && b.matchScore !== a.matchScore) {
        return b.matchScore - a.matchScore;
      }
      return a.entry.name.localeCompare(b.entry.name);
    });
    const childCount = children.reduce((acc, child) => acc + child.totalItems, 0);
    const itemMaxScore = items.reduce((maxScore, item) => Math.max(maxScore, item.matchScore), 0);
    const childMaxScore = children.reduce((maxScore, child) => Math.max(maxScore, child.maxScore), 0);

    return {
      label: node.label,
      path: node.path,
      children,
      items,
      totalItems: items.length + childCount,
      maxScore: Math.max(itemMaxScore, childMaxScore),
    };
  });

  nodes.sort((a, b) => {
    if (rankBySimilarity && b.maxScore !== a.maxScore) {
      return b.maxScore - a.maxScore;
    }
    return a.label.localeCompare(b.label);
  });

  return nodes;
}

function buildTree(items: TreeItem[], rankBySimilarity: boolean): CatalogNode[] {
  const root = new Map<string, MutableNode>();

  for (const item of items) {
    const path = item.treePath;
    if (path.length === 0) continue;

    let cursor = root;
    const currentPath: string[] = [];
    let currentNode: MutableNode | null = null;

    for (const segment of path) {
      currentPath.push(segment);
      let node = cursor.get(segment);
      if (!node) {
        node = { label: segment, path: [...currentPath], children: new Map<string, MutableNode>(), items: [] };
        cursor.set(segment, node);
      }
      currentNode = node;
      cursor = node.children;
    }

    if (currentNode) currentNode.items.push(item);
  }

  return freezeNodes(root, rankBySimilarity);
}

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
        <label className="smallLabel">Buscar ejercicio</label>
        <input
          className="input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ej: sentadilla posterior smith"
        />
      </div>

      <div className="chipRow" style={{ marginTop: 10 }}>
        <span className="chip">Resultados: {filteredEntries.length}</span>
        <span className="chip">Grupo: {selectedGroup === ALL ? "Todos" : selectedGroup}</span>
        <button type="button" className="btn" onClick={clearFilters}>
          Limpiar filtros
        </button>
      </div>

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
