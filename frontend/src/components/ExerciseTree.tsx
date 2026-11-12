import type { ReactNode } from "react";

import type { ExerciseCatalogEntry } from "../lib/exerciseCatalog";
import {
  formatExerciseNameForList,
  formatExercisePathForList,
  type CatalogNode,
} from "../lib/exerciseTree";

// Arbol de categorias de ejercicios, compartido por Ejercicios, Rutinas y Cargas.
// Cada pantalla decide solo lo que cambia: las acciones de cada fila, si se muestra
// la etiqueta Global/Personal y si alguna fila se oculta.
export type ExerciseTreeOptions = {
  expandAll: boolean;
  onSelectGroup: (group: string) => void;
  activeRootLabel: string | null;
  renderActions: (entry: ExerciseCatalogEntry) => ReactNode;
  showScopeChip?: boolean;
  filterItem?: (entry: ExerciseCatalogEntry) => boolean;
};

export function renderExerciseTree(nodes: CatalogNode[], options: ExerciseTreeOptions, depth = 1): ReactNode[] {
  const { expandAll, onSelectGroup, activeRootLabel, renderActions, showScopeChip = false, filterItem } = options;

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
    const items = filterItem ? node.items.filter((item) => filterItem(item.entry)) : node.items;

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
          {items.length > 0 ? (
            <div className="treeLeafList">
              {items.map((item) => (
                <article key={item.entry.id} className="treeLeaf">
                  <div>
                    <strong>{formatExerciseNameForList(item.entry.name)}</strong>
                    <div className="small">{formatExercisePathForList(item.treePath)}</div>
                    {showScopeChip ? (
                      <div className="chipRow" style={{ marginTop: 6 }}>
                        <span className="chip">{item.entry.scope === "global" ? "Global" : "Personal"}</span>
                      </div>
                    ) : null}
                  </div>
                  {renderActions(item.entry)}
                </article>
              ))}
            </div>
          ) : null}

          {node.children.length > 0 ? renderExerciseTree(node.children, options, depth + 1) : null}
        </div>
      </details>
    );
  });
}
