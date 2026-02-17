import { useMemo, useState } from "react";

import {
  ALL_EXERCISE_FILTER as ALL,
  cleanExerciseText,
  filterExerciseEntries,
  getExerciseFilterOptions,
  normalizeExercisePath,
  toExerciseCatalogEntries,
  type ExerciseCatalogEntry,
  type ExerciseFilters,
} from "../lib/exerciseCatalog";
import { loadExerciseCatalog, saveExerciseCatalog, uid } from "../lib/storage";
import type { ExerciseCatalogItem } from "../lib/storage";

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

    if (currentNode) {
      currentNode.items.push(item);
    }
  }

  return freezeNodes(root);
}

function renderTree(nodes: CatalogNode[], onRemove: (id: string) => void) {
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
                </div>
                <button className="btn" onClick={() => onRemove(item.id)}>
                  Eliminar
                </button>
              </article>
            ))}
          </div>
        ) : null}

        {node.children.length > 0 ? renderTree(node.children, onRemove) : null}
      </div>
    </details>
  ));
}

export default function Exercises() {
  const [items, setItems] = useState<ExerciseCatalogItem[]>(() => loadExerciseCatalog());
  const [group, setGroup] = useState("");
  const [family, setFamily] = useState("");
  const [variation, setVariation] = useState("");
  const [subvariation, setSubvariation] = useState("");

  const [selectedGroup, setSelectedGroup] = useState<string>(ALL);
  const [selectedFamily, setSelectedFamily] = useState<string>(ALL);
  const [selectedVariation, setSelectedVariation] = useState<string>(ALL);
  const [selectedSubvariation, setSelectedSubvariation] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  const catalogEntries = useMemo(() => toExerciseCatalogEntries(items, "General"), [items]);
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
  const { groupOptions, familyOptions, variationOptions, subvariationOptions } = useMemo(
    () => getExerciseFilterOptions(catalogEntries, filters),
    [catalogEntries, filters],
  );
  const filteredEntries = useMemo(() => filterExerciseEntries(catalogEntries, filters), [catalogEntries, filters]);

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

  function add() {
    setError("");

    const normalizedGroup = cleanExerciseText(group) || "General";
    const base = cleanExerciseText(family);
    const varName = cleanExerciseText(variation);
    const subName = cleanExerciseText(subvariation);

    if (!base) {
      setError("Debes indicar al menos el ejercicio base.");
      return;
    }

    const path = [normalizedGroup, base, varName, subName].filter(Boolean);
    const name = [base, varName, subName].filter(Boolean).join(" - ");

    const nextPathKey = path.join(" > ").toLowerCase();
    const exists = items.some(
      (item) => normalizeExercisePath(item, "General").join(" > ").toLowerCase() === nextPathKey,
    );
    if (exists) {
      setError("Ese ejercicio ya existe.");
      return;
    }

    const next: ExerciseCatalogItem[] = [
      ...items,
      {
        id: uid("ex"),
        name,
        group: normalizedGroup,
        path,
        created_at_utc: new Date().toISOString(),
      },
    ];

    setItems(next);
    saveExerciseCatalog(next);
    setFamily("");
    setVariation("");
    setSubvariation("");
  }

  function remove(id: string) {
    const next = items.filter((x) => x.id !== id);
    setItems(next);
    saveExerciseCatalog(next);
  }

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Ejercicios</h1>
        <p>Catalogo ordenado en jerarquia para mantener consistencia al crear rutinas y sesiones.</p>
      </header>

      <section className="surface">
        {error ? <div className="message error">{error}</div> : null}
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
            <input
              className="input"
              value={subvariation}
              onChange={(e) => setSubvariation(e.target.value)}
              placeholder="En smith"
            />
          </div>
        </div>

        <div className="quickActions" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={add}>
            Agregar ejercicio
          </button>
          <span className="chip">Total catalogo: {items.length}</span>
        </div>
      </section>

      <section className="surface">
        <div className="sectionHead">
          <h3>Lista jerarquica</h3>
          <p>Busqueda guiada en pasos: general {'>'} base {'>'} variacion {'>'} subvariacion.</p>
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
              {groupOptions.map((value) => (
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
              {familyOptions.map((value) => (
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
              {variationOptions.map((value) => (
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
              {subvariationOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <label className="smallLabel">Buscar en arbol</label>
          <input
            className="input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ej: cuadriceps sentadilla smith"
          />
        </div>

        <div className="chipRow" style={{ marginTop: 10 }}>
          <span className="chip">Catalogo total: {catalogEntries.length}</span>
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
            {renderTree(tree, remove)}
          </div>
        )}
      </section>
    </div>
  );
}
