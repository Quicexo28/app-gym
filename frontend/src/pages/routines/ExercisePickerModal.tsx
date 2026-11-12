import Select from "../../components/Select";
import {
  ALL_EXERCISE_FILTER as ALL,
  ALL_EXERCISE_ZONE_FILTER,
  EXERCISE_ZONE_LOWER,
  EXERCISE_ZONE_UPPER,
  type ExerciseBodyZoneFilter,
  type ExerciseCatalogEntry,
} from "../../lib/exerciseCatalog";
import { formatExerciseNameForList, formatExercisePathForList, type CatalogNode } from "../../lib/exerciseTree";

function renderTree(
  nodes: CatalogNode[],
  onAdd: (entry: ExerciseCatalogEntry) => void,
  canAdd: (entry: ExerciseCatalogEntry) => boolean,
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
      <details
        key={node.path.join(" > ")}
        className={nodeClassName}
        open={isOpen}
      >
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
          {node.items.filter((item) => canAdd(item.entry)).length > 0 ? (
            <div className="treeLeafList">
              {node.items
                .filter((item) => canAdd(item.entry))
                .map((item) => (
                  <article key={item.entry.id} className="treeLeaf">
                    <div>
                      <strong>{formatExerciseNameForList(item.entry.name)}</strong>
                      <div className="small">{formatExercisePathForList(item.treePath)}</div>
                      <div className="chipRow" style={{ marginTop: 6 }}>
                        <span className="chip">{item.entry.scope === "global" ? "Global" : "Personal"}</span>
                      </div>
                    </div>
                    <button className="btn" onClick={() => onAdd(item.entry)}>
                      Agregar
                    </button>
                  </article>
                ))}
            </div>
          ) : null}

          {node.children.length > 0
            ? renderTree(node.children, onAdd, canAdd, expandAll, onSelectGroup, depth + 1, activeRootLabel)
            : null}
        </div>
      </details>
    );
  });
}

type Props = {
  selectedZone: ExerciseBodyZoneFilter;
  selectedGroup: string;
  search: string;
  catalogCount: number;
  resultsCount: number;
  tree: CatalogNode[];
  expandAll: boolean;
  activeRootLabel: string | null;
  onZoneChange: (zone: ExerciseBodyZoneFilter) => void;
  onSearchChange: (value: string) => void;
  onClearFilters: () => void;
  onClose: () => void;
  onAdd: (entry: ExerciseCatalogEntry) => void;
  canAdd: (entry: ExerciseCatalogEntry) => boolean;
  onSelectGroup: (group: string) => void;
};

export default function ExercisePickerModal({
  selectedZone,
  selectedGroup,
  search,
  catalogCount,
  resultsCount,
  tree,
  expandAll,
  activeRootLabel,
  onZoneChange,
  onSearchChange,
  onClearFilters,
  onClose,
  onAdd,
  canAdd,
  onSelectGroup,
}: Props) {
  return (
    <div className="modalOverlay" role="presentation" onClick={onClose}>
      <section
        className="modalCard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="routine-picker-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sectionHead">
          <h3 id="routine-picker-title">Agregar nuevo ejercicio</h3>
          <p>Selecciona solo ejercicios finales de cada rama del catálogo.</p>
        </div>

        <div className="splitGrid" style={{ marginTop: 10 }}>
          <div>
            <label className="smallLabel">Zona</label>
            <Select
              value={selectedZone}
              onChange={(v) => onZoneChange(v as ExerciseBodyZoneFilter)}
              options={[
                { value: ALL_EXERCISE_ZONE_FILTER, label: "Todas" },
                { value: EXERCISE_ZONE_UPPER, label: "Superior" },
                { value: EXERCISE_ZONE_LOWER, label: "Inferior" },
              ]}
            />
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <label className="smallLabel" htmlFor="routines-exercise-search">Buscar ejercicio</label>
          <input
            id="routines-exercise-search"
            className="input"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="ej: sentadilla posterior smith"
          />
        </div>

        <div className="chipRow" style={{ marginTop: 10, alignItems: "center" }}>
          <span className="chip">Catálogo total: {catalogCount}</span>
          <span className="chip">Resultados: {resultsCount}</span>
          <span className="chip">Zona: {selectedZone === ALL_EXERCISE_ZONE_FILTER ? "Todas" : selectedZone === EXERCISE_ZONE_LOWER ? "Inferior" : "Superior"}</span>
          <span className="chip">Grupo: {selectedGroup === ALL ? "Todos" : selectedGroup}</span>
        </div>

        <div className="quickActions" style={{ marginTop: 10 }}>
          <button type="button" className="btn" onClick={onClearFilters}>
            Limpiar filtros
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cerrar
          </button>
        </div>

        {resultsCount === 0 ? (
          <div className="emptyState" style={{ marginTop: 12 }}>
            Sin coincidencias para la combinación de filtros actual.
          </div>
        ) : (
          <div className="treeList" style={{ marginTop: 12 }}>
            {renderTree(tree, onAdd, canAdd, expandAll, onSelectGroup, 1, activeRootLabel)}
          </div>
        )}
      </section>
    </div>
  );
}
