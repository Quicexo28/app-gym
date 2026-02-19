import { useMemo, useState } from "react";

import {
  ALL_EXERCISE_FILTER as ALL,
  buildExerciseCatalogBrowser,
  type ExerciseCatalogEntry,
  type ExerciseFilters,
} from "../lib/exerciseCatalog";
import { loadRoutines, saveRoutines, uid } from "../lib/storage";
import type { RoutineTemplate } from "../lib/storage";
import { useExerciseCatalog } from "../state/exerciseCatalog";

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
    if (item.path.length === 0) continue;

    let cursor = root;
    const currentPath: string[] = [];
    let currentNode: MutableNode | null = null;

    for (const segment of item.path) {
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

function renderTree(nodes: CatalogNode[], onAdd: (entry: ExerciseCatalogEntry) => void) {
  return nodes.map((node) => (
    <details key={node.path.join(" > ")} className="treeNode">
      <summary className="treeSummary">
        <span>{node.label}</span>
        <span className="chip">{node.totalItems}</span>
      </summary>

      <div className="treeChildren">
        {node.items.length > 0 ? (
          <div className="treeLeafList">
            {node.items.map((entry) => (
              <article key={entry.id} className="treeLeaf">
                <div>
                  <strong>{entry.name}</strong>
                  <div className="small">{entry.path.join(" > ")}</div>
                  <div className="chipRow" style={{ marginTop: 6 }}>
                    <span className="chip">{entry.scope === "global" ? "Global" : "Personal"}</span>
                  </div>
                </div>
                <button className="btn" onClick={() => onAdd(entry)}>
                  Agregar
                </button>
              </article>
            ))}
          </div>
        ) : null}

        {node.children.length > 0 ? renderTree(node.children, onAdd) : null}
      </div>
    </details>
  ));
}

export default function Routines() {
  const { loading, syncError, entries: catalogEntries } = useExerciseCatalog();
  const [items, setItems] = useState<RoutineTemplate[]>(() => loadRoutines());
  const [name, setName] = useState("");
  const [draftExercises, setDraftExercises] = useState<string[]>([]);
  const [error, setError] = useState("");

  const [selectedGroup, setSelectedGroup] = useState<string>(ALL);
  const [selectedFamily, setSelectedFamily] = useState<string>(ALL);
  const [selectedVariation, setSelectedVariation] = useState<string>(ALL);
  const [selectedSubvariation, setSelectedSubvariation] = useState<string>(ALL);
  const [search, setSearch] = useState("");

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
  const browser = useMemo(() => buildExerciseCatalogBrowser(catalogEntries, filters), [catalogEntries, filters]);
  const filteredEntries = browser.filteredEntries;
  const tree = useMemo(() => buildTree(filteredEntries), [filteredEntries]);

  const sorted = useMemo(() => [...items].sort((a, b) => a.name.localeCompare(b.name)), [items]);

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

  function addSelectedExercise(entry: ExerciseCatalogEntry) {
    setError("");
    const next = entry.name;
    if (draftExercises.some((value) => value.toLowerCase() === next.toLowerCase())) return;
    setDraftExercises((prev) => [...prev, next]);
  }

  function removeDraftExercise(value: string) {
    setDraftExercises((prev) => prev.filter((entry) => entry !== value));
  }

  function clearFilters() {
    setSelectedGroup(ALL);
    setSelectedFamily(ALL);
    setSelectedVariation(ALL);
    setSelectedSubvariation(ALL);
    setSearch("");
  }

  function addRoutine() {
    setError("");
    const trimmed = name.trim();

    if (!trimmed) {
      setError("Escribe un nombre para la rutina.");
      return;
    }

    if (draftExercises.length === 0) {
      setError("Agrega al menos un ejercicio.");
      return;
    }

    const exists = items.some((entry) => entry.name.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      setError("Ya existe una rutina con ese nombre.");
      return;
    }

    const next: RoutineTemplate[] = [
      ...items,
      { id: uid("rt"), name: trimmed, exercises: draftExercises, created_at_utc: new Date().toISOString() },
    ];

    setItems(next);
    saveRoutines(next);
    setName("");
    setDraftExercises([]);
  }

  function removeRoutine(id: string) {
    const next = items.filter((entry) => entry.id !== id);
    setItems(next);
    saveRoutines(next);
  }

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Rutinas</h1>
        <p>Constructor con explorador jerarquico desplegable (grupo {'>'} base {'>'} variacion {'>'} subvariacion).</p>
      </header>

      <section className="surface">
        {syncError ? <div className="message error">{syncError}</div> : null}
        {error ? <div className="message error">{error}</div> : null}

        <label className="smallLabel">Nombre de plantilla</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Push A" />

        <div className="splitGrid" style={{ marginTop: 12 }}>
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
              {browser.groupOptions.map((group) => (
                <option key={group} value={group}>
                  {group}
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
              {browser.familyOptions.map((family) => (
                <option key={family} value={family}>
                  {family}
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
              {browser.variationOptions.map((variation) => (
                <option key={variation} value={variation}>
                  {variation}
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
              {browser.subvariationOptions.map((subvariation) => (
                <option key={subvariation} value={subvariation}>
                  {subvariation}
                </option>
              ))}
            </select>
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

        <div className="chipRow" style={{ marginTop: 10, alignItems: "center" }}>
          <span className="chip">Catalogo total: {catalogEntries.length}</span>
          <span className="chip">Resultados: {filteredEntries.length}</span>
          <span className="chip">
            Ruta: {[selectedGroup, selectedFamily, selectedVariation, selectedSubvariation].filter((value) => value !== ALL).join(" > ") || "General"}
          </span>
          <button type="button" className="btn" onClick={clearFilters}>
            Limpiar filtros
          </button>
          {loading ? <span className="chip">Sincronizando...</span> : null}
        </div>

        {filteredEntries.length === 0 ? (
          <div className="emptyState" style={{ marginTop: 12 }}>
            Sin coincidencias para la combinacion de filtros actual.
          </div>
        ) : (
          <div className="treeList" style={{ marginTop: 12 }}>
            {renderTree(tree, addSelectedExercise)}
          </div>
        )}

        <div className="chipRow" style={{ marginTop: 10 }}>
          {draftExercises.length === 0 ? <span className="chip">Sin ejercicios aun</span> : null}
          {draftExercises.map((exercise) => (
            <button key={exercise} className="chipButton" onClick={() => removeDraftExercise(exercise)}>
              {exercise} x
            </button>
          ))}
        </div>

        <div className="quickActions" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={addRoutine}>
            Guardar plantilla
          </button>
          <span className="chip">Total: {items.length}</span>
        </div>
      </section>

      <section className="surface">
        <div className="sectionHead">
          <h3>Plantillas guardadas</h3>
          <p>Toca una para ver contenido. Eliminar quita solo la plantilla local.</p>
        </div>

        {sorted.length === 0 ? (
          <div className="emptyState">No hay plantillas aun.</div>
        ) : (
          <div className="gridCards">
            {sorted.map((routine) => (
              <article key={routine.id} className="surfaceButton">
                <strong>{routine.name}</strong>
                <div className="chipRow">
                  {routine.exercises.map((exercise) => (
                    <span key={`${routine.id}_${exercise}`} className="chip">
                      {exercise}
                    </span>
                  ))}
                </div>
                <button className="btn" onClick={() => removeRoutine(routine.id)}>
                  Eliminar
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
