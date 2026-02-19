import { useMemo, useState } from "react";

import {
  ALL_EXERCISE_FILTER as ALL,
  buildExerciseCatalogBrowser,
  catalogPathKeyFromParts,
  cleanExerciseText,
  type ExerciseCatalogEntry,
  type ExerciseFilters,
} from "../lib/exerciseCatalog";
import { useExerciseCatalog } from "../state/exerciseCatalog";
import { useAuth } from "../state/auth";

type MutableNode = {
  label: string;
  path: string[];
  children: Map<string, MutableNode>;
  items: ExerciseCatalogEntry[];
};

type CatalogNode = {
  label: string;
  path: string[];
  children: CatalogNode[];
  items: ExerciseCatalogEntry[];
  totalItems: number;
};

function freezeNodes(source: Map<string, MutableNode>): CatalogNode[] {
  return Array.from(source.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((node) => {
      const children = freezeNodes(node.children);
      const items = [...node.items].sort((a, b) => a.name.localeCompare(b.name));
      const childCount = children.reduce((acc, child) => acc + child.totalItems, 0);

      return {
        label: node.label,
        path: node.path,
        children,
        items,
        totalItems: items.length + childCount,
      };
    });
}

function buildTree(items: ExerciseCatalogEntry[]): CatalogNode[] {
  const root = new Map<string, MutableNode>();

  for (const item of items) {
    const path = item.path;
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

  return freezeNodes(root);
}

function renderTree(
  nodes: CatalogNode[],
  onRemove: (item: ExerciseCatalogEntry) => void,
  canRemove: (item: ExerciseCatalogEntry) => boolean,
) {
  return nodes.map((node) => (
    <details key={node.path.join(" > ")} className="treeNode">
      <summary className="treeSummary">
        <span>{node.label}</span>
        <span className="chip">{node.totalItems}</span>
      </summary>

      <div className="treeChildren">
        {node.items.length > 0 ? (
          <div className="treeLeafList">
            {node.items.map((item) => (
              <article key={item.id} className="treeLeaf">
                <div>
                  <strong>{item.name}</strong>
                  <div className="small">{item.path.join(" > ")}</div>
                  <div className="chipRow" style={{ marginTop: 6 }}>
                    <span className="chip">{item.scope === "global" ? "Global" : "Personal"}</span>
                  </div>
                </div>
                {canRemove(item) ? (
                  <button className="btn" onClick={() => onRemove(item)}>
                    Eliminar
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}

        {node.children.length > 0 ? renderTree(node.children, onRemove, canRemove) : null}
      </div>
    </details>
  ));
}

export default function Exercises() {
  const { isAdmin } = useAuth();
  const { ready, loading, syncError, items, entries, addCustom, addGlobal, removeItem } = useExerciseCatalog();
  const [group, setGroup] = useState("");
  const [family, setFamily] = useState("");
  const [variation, setVariation] = useState("");
  const [subvariation, setSubvariation] = useState("");
  const [createScope, setCreateScope] = useState<"custom" | "global">("custom");

  const [selectedGroup, setSelectedGroup] = useState<string>(ALL);
  const [selectedFamily, setSelectedFamily] = useState<string>(ALL);
  const [selectedVariation, setSelectedVariation] = useState<string>(ALL);
  const [selectedSubvariation, setSelectedSubvariation] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  const filters = useMemo<ExerciseFilters>(
    () => ({
      group: selectedGroup,
      family: selectedFamily,
      variation: selectedVariation,
      subvariation: selectedSubvariation,
      search,
    }),
    [search, selectedFamily, selectedGroup, selectedSubvariation, selectedVariation],
  );
  const browser = useMemo(() => buildExerciseCatalogBrowser(entries, filters), [entries, filters]);

  const filteredEntries = browser.filteredEntries;
  const tree = useMemo(() => buildTree(filteredEntries), [filteredEntries]);

  function resetLowerFilters(level: "group" | "family" | "variation") {
    if (level === "group") {
      setSelectedFamily(ALL);
      setSelectedVariation(ALL);
      setSelectedSubvariation(ALL);
      return;
    }

    if (level === "family") {
      setSelectedVariation(ALL);
      setSelectedSubvariation(ALL);
      return;
    }

    setSelectedSubvariation(ALL);
  }

  function clearFilters() {
    setSelectedGroup(ALL);
    setSelectedFamily(ALL);
    setSelectedVariation(ALL);
    setSelectedSubvariation(ALL);
    setSearch("");
  }

  async function add() {
    setError("");

    const normalizedGroup = cleanExerciseText(group) || "General";
    const normalizedFamily = cleanExerciseText(family);
    const normalizedVariation = cleanExerciseText(variation);
    const normalizedSubvariation = cleanExerciseText(subvariation);

    if (!normalizedFamily) {
      setError("Debes indicar al menos el ejercicio base.");
      return;
    }

    if (normalizedSubvariation && !normalizedVariation) {
      setError("Para usar subvariacion debes indicar antes una variacion.");
      return;
    }

    const nextKey = catalogPathKeyFromParts(
      normalizedGroup,
      normalizedFamily,
      normalizedVariation,
      normalizedSubvariation,
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
      subvariation: normalizedSubvariation || undefined,
    };

    try {
      if (createScope === "global") {
        await addGlobal(payload);
      } else {
        await addCustom(payload);
      }
      setFamily("");
      setVariation("");
      setSubvariation("");
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    }
  }

  async function remove(entry: ExerciseCatalogEntry) {
    try {
      const item = items.find((candidate) => candidate.id === entry.id);
      if (!item) return;
      await removeItem(item);
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
        {isAdmin ? (
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
            <input className="input" value={group} onChange={(e) => setGroup(e.target.value)} placeholder="Cuadriceps" />
          </div>
          <div>
            <label className="smallLabel">Ejercicio base</label>
            <input className="input" value={family} onChange={(e) => setFamily(e.target.value)} placeholder="Sentadilla" />
          </div>
          <div>
            <label className="smallLabel">Variacion (opcional)</label>
            <input className="input" value={variation} onChange={(e) => setVariation(e.target.value)} placeholder="Posterior" />
          </div>
          <div>
            <label className="smallLabel">Subvariacion (opcional)</label>
            <input className="input" value={subvariation} onChange={(e) => setSubvariation(e.target.value)} placeholder="En smith" />
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
          <p>Filtro jerarquico para navegar desde general hasta objetivo.</p>
        </div>

        <div className="splitGrid" style={{ marginTop: 10 }}>
          <div>
            <label className="smallLabel">Grupo muscular</label>
            <select
              className="input"
              value={selectedGroup}
              onChange={(e) => {
                setSelectedGroup(e.target.value);
                resetLowerFilters("group");
              }}
            >
              <option value={ALL}>Todos</option>
              {browser.groupOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="smallLabel">Ejercicio base</label>
            <select
              className="input"
              value={selectedFamily}
              onChange={(e) => {
                setSelectedFamily(e.target.value);
                resetLowerFilters("family");
              }}
            >
              <option value={ALL}>Todos</option>
              {browser.familyOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="smallLabel">Variacion</label>
            <select
              className="input"
              value={selectedVariation}
              onChange={(e) => {
                setSelectedVariation(e.target.value);
                resetLowerFilters("variation");
              }}
            >
              <option value={ALL}>Todas</option>
              {browser.variationOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="smallLabel">Subvariacion</label>
            <select
              className="input"
              value={selectedSubvariation}
              onChange={(e) => setSelectedSubvariation(e.target.value)}
            >
              <option value={ALL}>Todas</option>
              {browser.subvariationOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
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
          <span className="chip">
            Ruta: {[selectedGroup, selectedFamily, selectedVariation, selectedSubvariation].filter((value) => value !== ALL).join(" > ") || "General"}
          </span>
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
            {renderTree(tree, remove, (entry) => isAdmin || entry.scope === "custom")}
          </div>
        )}
      </section>
    </div>
  );
}
