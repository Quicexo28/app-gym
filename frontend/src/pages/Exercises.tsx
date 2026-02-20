import { useEffect, useMemo, useState } from "react";

import {
  ALL_EXERCISE_FILTER as ALL,
  ALL_EXERCISE_ZONE_FILTER,
  buildExerciseCatalogBrowser,
  canonicalizeExerciseGroup,
  catalogPathKeyFromParts,
  cleanExerciseText,
  computeExerciseEntrySearchScore,
  EXERCISE_ZONE_LOWER,
  EXERCISE_ZONE_UPPER,
  tokenizeExerciseSearch,
  type ExerciseBodyZoneFilter,
  type ExerciseCatalogEntry,
  type ExerciseFilters,
} from "../lib/exerciseCatalog";
import { useExerciseCatalog } from "../state/exerciseCatalog";
import { useAuth } from "../state/auth";
import { useUndo } from "../state/undo";
import { useViewMode } from "../state/viewMode";

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

type TreeActions = {
  onEdit: (item: ExerciseCatalogEntry) => void;
  canEdit: (item: ExerciseCatalogEntry) => boolean;
  onRemove: (item: ExerciseCatalogEntry) => void;
  canRemove: (item: ExerciseCatalogEntry) => boolean;
  editingId: string;
  onSelectGroup: (group: string) => void;
};

type SubvariationChain = {
  subvariation: string;
  executionType: string;
};

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function splitSubvariationChain(value: string): SubvariationChain {
  const parts = cleanExerciseText(value)
    .split(">")
    .map((part) => cleanExerciseText(part))
    .filter(Boolean);

  if (parts.length === 0) {
    return { subvariation: "", executionType: "" };
  }

  return {
    subvariation: parts[0] || "",
    executionType: parts.slice(1).join(" > "),
  };
}

function joinSubvariationChain(subvariation: string, executionType: string): string {
  const normalizedSubvariation = cleanExerciseText(subvariation);
  const normalizedExecutionType = cleanExerciseText(executionType);
  if (!normalizedSubvariation) return "";
  if (!normalizedExecutionType) return normalizedSubvariation;
  return `${normalizedSubvariation} > ${normalizedExecutionType}`;
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
        node = {
          label: segment,
          path: [...currentPath],
          children: new Map<string, MutableNode>(),
          items: [],
        };
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
  actions: TreeActions,
  expandAll: boolean,
  depth: number,
  activeRootLabel: string | null,
) {
  const { onEdit, canEdit, onRemove, canRemove, editingId, onSelectGroup } = actions;
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
          {node.items.length > 0 ? (
            <div className="treeLeafList">
              {node.items.map((item) => (
                <article key={item.entry.id} className="treeLeaf">
                  <div>
                    <strong>{item.entry.name}</strong>
                    <div className="small">{item.treePath.join(" > ")}</div>
                    <div className="chipRow" style={{ marginTop: 6 }}>
                      <span className="chip">{item.entry.scope === "global" ? "Global" : "Personal"}</span>
                    </div>
                  </div>
                  <div className="hstack compact">
                    {canEdit(item.entry) ? (
                      <button className="btn" onClick={() => onEdit(item.entry)}>
                        {editingId === item.entry.id ? "Editando..." : "Editar"}
                      </button>
                    ) : null}
                    {canRemove(item.entry) ? (
                      <button className="btn" onClick={() => onRemove(item.entry)}>
                        Eliminar
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : null}

          {node.children.length > 0 ? renderTree(node.children, actions, expandAll, depth + 1, activeRootLabel) : null}
        </div>
      </details>
    );
  });
}

export default function Exercises() {
  const { isAdmin } = useAuth();
  const { viewMode } = useViewMode();
  const { registerUndo } = useUndo();
  const isAdminMode = isAdmin && viewMode === "admin";
  const { ready, loading, syncError, items, entries, addCustom, addGlobal, updateItem, removeItem } = useExerciseCatalog();
  const [group, setGroup] = useState("");
  const [family, setFamily] = useState("");
  const [variation, setVariation] = useState("");
  const [subvariation, setSubvariation] = useState("");
  const [createExecutionType, setCreateExecutionType] = useState("");
  const [createScope, setCreateScope] = useState<"custom" | "global">("custom");
  const [editId, setEditId] = useState("");
  const [editGroup, setEditGroup] = useState("");
  const [editFamily, setEditFamily] = useState("");
  const [editVariation, setEditVariation] = useState("");
  const [editSubvariation, setEditSubvariation] = useState("");
  const [editExecutionType, setEditExecutionType] = useState("");

  const [selectedGroup, setSelectedGroup] = useState<string>(ALL);
  const [selectedZone, setSelectedZone] = useState<ExerciseBodyZoneFilter>(ALL_EXERCISE_ZONE_FILTER);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  const filters = useMemo<ExerciseFilters>(
    () => ({
      group: ALL,
      zone: selectedZone,
      search,
    }),
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
  const createOptions = useMemo(() => {
    const groupOptions = uniqueSorted(entries.map((entry) => entry.group));

    const familySource = entries.filter((entry) => (group ? entry.group === group : true));
    const familyOptions = uniqueSorted(familySource.map((entry) => entry.family));

    const variationSource = familySource.filter((entry) => (family ? entry.family === family : true));
    const variationOptions = uniqueSorted(variationSource.map((entry) => entry.variation).filter(Boolean));

    const subvariationSource = variationSource.filter((entry) => (variation ? entry.variation === variation : true));
    const subvariationOptions = uniqueSorted(
      subvariationSource
        .map((entry) => splitSubvariationChain(entry.subvariation).subvariation)
        .filter(Boolean),
    );

    const executionTypeOptions = uniqueSorted(
      subvariationSource
        .map((entry) => splitSubvariationChain(entry.subvariation))
        .filter((entry) => (subvariation ? entry.subvariation === subvariation : Boolean(entry.subvariation)))
        .map((entry) => entry.executionType)
        .filter(Boolean),
    );

    return {
      groupOptions,
      familyOptions,
      variationOptions,
      subvariationOptions,
      executionTypeOptions,
    };
  }, [entries, family, group, subvariation, variation]);
  const editingItem = useMemo(() => items.find((item) => item.id === editId) || null, [editId, items]);
  const editOptions = useMemo(() => {
    const groupOptions = uniqueSorted(entries.map((entry) => entry.group));

    const familySource = entries.filter((entry) => (editGroup ? entry.group === editGroup : true));
    const familyOptions = uniqueSorted(familySource.map((entry) => entry.family));

    const variationSource = familySource.filter((entry) => (editFamily ? entry.family === editFamily : true));
    const variationOptions = uniqueSorted(variationSource.map((entry) => entry.variation).filter(Boolean));

    const subvariationSource = variationSource.filter((entry) => (editVariation ? entry.variation === editVariation : true));
    const subvariationOptions = uniqueSorted(
      subvariationSource
        .map((entry) => splitSubvariationChain(entry.subvariation).subvariation)
        .filter(Boolean),
    );

    const executionTypeOptions = uniqueSorted(
      subvariationSource
        .map((entry) => splitSubvariationChain(entry.subvariation))
        .filter((entry) => (editSubvariation ? entry.subvariation === editSubvariation : Boolean(entry.subvariation)))
        .map((entry) => entry.executionType)
        .filter(Boolean),
    );

    return {
      groupOptions,
      familyOptions,
      variationOptions,
      subvariationOptions,
      executionTypeOptions,
    };
  }, [editFamily, editGroup, editSubvariation, editVariation, entries]);

  function clearFilters() {
    setSelectedGroup(ALL);
    setSelectedZone(ALL_EXERCISE_ZONE_FILTER);
    setSearch("");
  }

  function selectGroupFromTree(groupValue: string) {
    setSelectedGroup((prev) => (prev === groupValue ? ALL : groupValue));
  }

  function clearEdit() {
    setEditId("");
    setEditGroup("");
    setEditFamily("");
    setEditVariation("");
    setEditSubvariation("");
    setEditExecutionType("");
  }

  useEffect(() => {
    if (!editingItem) return;

    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        clearEdit();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [editingItem]);

  function canEditEntry(entry: ExerciseCatalogEntry): boolean {
    return isAdminMode || entry.scope === "custom";
  }

  function startEdit(entry: ExerciseCatalogEntry) {
    if (!canEditEntry(entry)) return;
    setError("");
    const subvariationChain = splitSubvariationChain(entry.subvariation || "");
    setEditId(entry.id);
    setEditGroup(entry.group);
    setEditFamily(entry.family);
    setEditVariation(entry.variation || "");
    setEditSubvariation(subvariationChain.subvariation);
    setEditExecutionType(subvariationChain.executionType);
  }

  function onEditGroupChange(nextGroup: string) {
    setEditGroup(nextGroup);
    setEditFamily("");
    setEditVariation("");
    setEditSubvariation("");
    setEditExecutionType("");
  }

  function onEditFamilyChange(nextFamily: string) {
    setEditFamily(nextFamily);
    setEditVariation("");
    setEditSubvariation("");
    setEditExecutionType("");
  }

  function onEditVariationChange(nextVariation: string) {
    setEditVariation(nextVariation);
    setEditSubvariation("");
    setEditExecutionType("");
  }

  function onEditSubvariationChange(nextSubvariation: string) {
    setEditSubvariation(nextSubvariation);
    setEditExecutionType("");
  }

  function onCreateGroupChange(nextGroup: string) {
    setGroup(nextGroup);
    setFamily("");
    setVariation("");
    setSubvariation("");
    setCreateExecutionType("");
  }

  function onCreateFamilyChange(nextFamily: string) {
    setFamily(nextFamily);
    setVariation("");
    setSubvariation("");
    setCreateExecutionType("");
  }

  function onCreateVariationChange(nextVariation: string) {
    setVariation(nextVariation);
    setSubvariation("");
    setCreateExecutionType("");
  }

  function onCreateSubvariationChange(nextSubvariation: string) {
    setSubvariation(nextSubvariation);
    setCreateExecutionType("");
  }

  async function add() {
    setError("");

    const normalizedGroup = canonicalizeExerciseGroup(group) || "General";
    const normalizedFamily = cleanExerciseText(family);
    const normalizedVariation = cleanExerciseText(variation);
    const normalizedSubvariation = cleanExerciseText(subvariation);
    const normalizedExecutionType = cleanExerciseText(createExecutionType);
    const normalizedSubvariationChain = joinSubvariationChain(normalizedSubvariation, normalizedExecutionType);

    if (!normalizedFamily) {
      setError("Debes indicar al menos el ejercicio base.");
      return;
    }

    if (normalizedSubvariation && !normalizedVariation) {
      setError("Para usar subvariacion debes indicar antes una variacion.");
      return;
    }

    if (normalizedExecutionType && !normalizedSubvariation) {
      setError("Para usar execution type debes indicar antes una subvariacion.");
      return;
    }

    const nextKey = catalogPathKeyFromParts(
      normalizedGroup,
      normalizedFamily,
      normalizedVariation,
      normalizedSubvariationChain,
    );

    const exists = items.some((item) => {
      const samePath =
        catalogPathKeyFromParts(item.group, item.family, item.variation || "", item.subvariation || "") === nextKey;
      if (!samePath) return false;
      if (createScope === "global") return item.scope === "global";
      return item.scope !== "global";
    });
    if (exists) {
      setError("Ese ejercicio ya existe en el catalogo.");
      return;
    }

    const payload = {
      group: normalizedGroup,
      family: normalizedFamily,
      variation: normalizedVariation || undefined,
      subvariation: normalizedSubvariationChain || undefined,
    };

    try {
      if (createScope === "global") {
        await addGlobal(payload);
      } else {
        await addCustom(payload);
      }
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    }
  }

  async function remove(entry: ExerciseCatalogEntry) {
    try {
      const item = items.find((candidate) => candidate.id === entry.id);
      if (!item) return;
      await removeItem(item);
      registerUndo({
        message: `Ejercicio "${entry.name}" eliminado.`,
        onUndo: async () => {
          try {
            const payload = {
              group: item.group,
              family: item.family,
              variation: item.variation,
              subvariation: item.subvariation,
              aliases: item.aliases,
            };
            if (item.scope === "global") {
              await addGlobal(payload);
            } else {
              await addCustom(payload);
            }
            setError("");
          } catch (cause: unknown) {
            const message = String((cause as { message?: string })?.message || cause);
            setError(message);
            throw cause;
          }
        },
      });
      if (editId === entry.id) {
        clearEdit();
      }
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    }
  }

  async function saveEdit() {
    setError("");
    if (!editingItem) {
      setError("Selecciona un ejercicio para editar.");
      return;
    }

    const normalizedGroup = canonicalizeExerciseGroup(editGroup) || "General";
    const normalizedFamily = cleanExerciseText(editFamily);
    const normalizedVariation = cleanExerciseText(editVariation);
    const normalizedSubvariation = cleanExerciseText(editSubvariation);
    const normalizedExecutionType = cleanExerciseText(editExecutionType);
    const normalizedSubvariationChain = joinSubvariationChain(normalizedSubvariation, normalizedExecutionType);

    if (!normalizedFamily) {
      setError("Debes indicar al menos el ejercicio base.");
      return;
    }

    if (normalizedSubvariation && !normalizedVariation) {
      setError("Para usar subvariacion debes indicar antes una variacion.");
      return;
    }

    if (normalizedExecutionType && !normalizedSubvariation) {
      setError("Para usar execution type debes indicar antes una subvariacion.");
      return;
    }

    const nextKey = catalogPathKeyFromParts(
      normalizedGroup,
      normalizedFamily,
      normalizedVariation,
      normalizedSubvariationChain,
    );
    const scope = editingItem.scope === "global" ? "global" : "custom";

    const exists = items.some((item) => {
      if (item.id === editingItem.id) return false;
      const samePath =
        catalogPathKeyFromParts(item.group, item.family, item.variation || "", item.subvariation || "") === nextKey;
      if (!samePath) return false;
      if (scope === "global") return item.scope === "global";
      return item.scope !== "global";
    });
    if (exists) {
      setError("Ese ejercicio ya existe en el catalogo.");
      return;
    }

    try {
      await updateItem(editingItem, {
        group: normalizedGroup,
        family: normalizedFamily,
        variation: normalizedVariation || undefined,
        subvariation: normalizedSubvariationChain || undefined,
        aliases: editingItem.aliases,
      });
      clearEdit();
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    }
  }

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Ejercicios</h1>
        <p>Catalogo jerarquico para elegir ejercicios de forma consistente y rapida.</p>
      </header>

      <section className="surface">
        {syncError ? <div className="message error">{syncError}</div> : null}
        {error ? <div className="message error">{error}</div> : null}
        {isAdminMode ? (
          <div className="pillGroup" style={{ marginBottom: 12 }}>
            <button
              type="button"
              className={`pill ${createScope === "custom" ? "active" : ""}`}
              onClick={() => setCreateScope("custom")}
            >
              <span>Ejercicio personal</span>
              <small>Solo visible para tu cuenta</small>
            </button>
            <button
              type="button"
              className={`pill ${createScope === "global" ? "active" : ""}`}
              onClick={() => setCreateScope("global")}
            >
              <span>Ejercicio global</span>
              <small>Visible para todas las cuentas</small>
            </button>
          </div>
        ) : null}
        <div className="splitGrid">
          <div>
            <label className="smallLabel">Grupo</label>
            <input
              className="input"
              list="create-group-options"
              value={group}
              onChange={(e) => onCreateGroupChange(e.target.value)}
              placeholder="Ej: Cuadriceps"
            />
            <datalist id="create-group-options">
              {createOptions.groupOptions.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="smallLabel">Ejercicio base</label>
            <input
              className="input"
              list="create-family-options"
              value={family}
              onChange={(e) => onCreateFamilyChange(e.target.value)}
              disabled={!group}
              placeholder="Ej: Sentadilla"
            />
            <datalist id="create-family-options">
              {createOptions.familyOptions.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="smallLabel">Variacion (opcional)</label>
            <input
              className="input"
              list="create-variation-options"
              value={variation}
              onChange={(e) => onCreateVariationChange(e.target.value)}
              disabled={!family}
              placeholder="Ej: Posterior"
            />
            <datalist id="create-variation-options">
              {createOptions.variationOptions.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="smallLabel">Subvariacion (opcional)</label>
            <input
              className="input"
              list="create-subvariation-options"
              value={subvariation}
              onChange={(e) => onCreateSubvariationChange(e.target.value)}
              disabled={!variation}
              placeholder="Ej: En smith"
            />
            <datalist id="create-subvariation-options">
              {createOptions.subvariationOptions.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="smallLabel">Execution type (opcional)</label>
            <input
              className="input"
              list="create-execution-type-options"
              value={createExecutionType}
              onChange={(e) => setCreateExecutionType(e.target.value)}
              disabled={!subvariation}
              placeholder="Ej: Polea alta"
            />
            <datalist id="create-execution-type-options">
              {createOptions.executionTypeOptions.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </div>
        </div>

        <div className="quickActions" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={() => void add()} disabled={loading || !ready}>
            {loading ? "Sincronizando..." : createScope === "global" ? "Agregar global" : "Agregar personal"}
          </button>
          <span className="chip">Total catalogo: {items.length}</span>
        </div>
      </section>

      <section className="surface">
        <div className="sectionHead">
          <h3>Explorador</h3>
          <p>Filtra por zona y grupo muscular antes de buscar en el arbol.</p>
        </div>

        <div className="splitGrid" style={{ marginTop: 10 }}>
          <div>
            <label className="smallLabel">Zona</label>
            <select className="input" value={selectedZone} onChange={(e) => setSelectedZone(e.target.value as ExerciseBodyZoneFilter)}>
              <option value={ALL_EXERCISE_ZONE_FILTER}>Todas</option>
              <option value={EXERCISE_ZONE_UPPER}>Superior</option>
              <option value={EXERCISE_ZONE_LOWER}>Inferior</option>
            </select>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <label className="smallLabel">Buscar en catalogo</label>
          <input
            className="input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ej: sentadilla posterior smith"
          />
        </div>

        <div className="chipRow" style={{ marginTop: 10 }}>
          <span className="chip">Resultados: {filteredEntries.length}</span>
          <span className="chip">Zona: {selectedZone === ALL_EXERCISE_ZONE_FILTER ? "Todas" : selectedZone === EXERCISE_ZONE_LOWER ? "Inferior" : "Superior"}</span>
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
            {renderTree(tree, {
              onEdit: startEdit,
              canEdit: canEditEntry,
              onRemove: remove,
              canRemove: canEditEntry,
              editingId: editId,
              onSelectGroup: selectGroupFromTree,
            }, searchTokens.length > 0, 1, activeRootLabel)}
          </div>
        )}
      </section>

      {editingItem ? (
        <div className="modalOverlay" role="presentation" onClick={clearEdit}>
          <section
            className="modalCard"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-exercise-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sectionHead">
              <h3 id="edit-exercise-title">Editar ejercicio</h3>
              <p>Cambia grupo muscular y la rama completa del ejercicio seleccionado.</p>
            </div>
            <div className="chipRow" style={{ marginTop: 6 }}>
              <span className="chip">Tipo: {editingItem.scope === "global" ? "Global" : "Personal"}</span>
            </div>

            <div className="splitGrid" style={{ marginTop: 8 }}>
              <div>
                <label className="smallLabel">Grupo muscular</label>
                <input
                  className="input"
                  list="edit-group-options"
                  value={editGroup}
                  onChange={(e) => onEditGroupChange(e.target.value)}
                  placeholder="Ej: Cuadriceps"
                />
                <datalist id="edit-group-options">
                  {editOptions.groupOptions.map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="smallLabel">Ejercicio base</label>
                <input
                  className="input"
                  list="edit-family-options"
                  value={editFamily}
                  onChange={(e) => onEditFamilyChange(e.target.value)}
                  disabled={!editGroup}
                  placeholder="Ej: Sentadilla"
                />
                <datalist id="edit-family-options">
                  {editOptions.familyOptions.map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="smallLabel">Variacion (opcional)</label>
                <input
                  className="input"
                  list="edit-variation-options"
                  value={editVariation}
                  onChange={(e) => onEditVariationChange(e.target.value)}
                  disabled={!editFamily}
                  placeholder="Ej: Posterior"
                />
                <datalist id="edit-variation-options">
                  {editOptions.variationOptions.map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="smallLabel">Subvariacion (opcional)</label>
                <input
                  className="input"
                  list="edit-subvariation-options"
                  value={editSubvariation}
                  onChange={(e) => onEditSubvariationChange(e.target.value)}
                  disabled={!editVariation}
                  placeholder="Ej: En smith"
                />
                <datalist id="edit-subvariation-options">
                  {editOptions.subvariationOptions.map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="smallLabel">Execution type (opcional)</label>
                <input
                  className="input"
                  list="edit-execution-type-options"
                  value={editExecutionType}
                  onChange={(e) => setEditExecutionType(e.target.value)}
                  disabled={!editSubvariation}
                  placeholder="Ej: Polea alta"
                />
                <datalist id="edit-execution-type-options">
                  {editOptions.executionTypeOptions.map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="quickActions" style={{ marginTop: 12 }}>
              <button className="btn primary" onClick={() => void saveEdit()} disabled={loading || !ready}>
                {loading ? "Sincronizando..." : "Guardar cambios"}
              </button>
              <button className="btn" onClick={clearEdit}>
                Cancelar
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
