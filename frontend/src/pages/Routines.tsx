import { useEffect, useMemo, useState } from "react";

import {
  ALL_EXERCISE_FILTER as ALL,
  buildExerciseCatalogBrowser,
  tokenizeExerciseSearch,
  type ExerciseCatalogEntry,
  type ExerciseFilters,
} from "../lib/exerciseCatalog";
import { loadRoutines, saveRoutines, uid } from "../lib/storage";
import type { RoutineExerciseTemplate, RoutineTemplate } from "../lib/storage";
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
};

type TreeItem = {
  entry: ExerciseCatalogEntry;
  treePath: string[];
};

const DEFAULT_TARGET_SETS = 3;
const DEFAULT_TARGET_REPS_MIN = 8;
const DEFAULT_TARGET_REPS_MAX = 12;
const DEFAULT_REST_SECONDS = 90;
const MAX_REST_SECONDS = 900;
const MAX_REST_MINUTES = Math.floor(MAX_REST_SECONDS / 60);

type DraftRoutineExercise = Omit<RoutineExerciseTemplate, "target_reps_min" | "target_reps_max" | "rest_seconds"> & {
  target_reps_min: string;
  target_reps_max: string;
  rest_minutes: string;
  rest_seconds: string;
};

function normalizePathSegment(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function pathKey(path: string[]): string {
  return path.map((segment) => normalizePathSegment(segment)).join(">");
}

function buildNonLeafPathKeys(items: ExerciseCatalogEntry[]): Set<string> {
  const nonLeafKeys = new Set<string>();

  for (const item of items) {
    for (let depth = 1; depth < item.path.length; depth += 1) {
      nonLeafKeys.add(pathKey(item.path.slice(0, depth)));
    }
  }

  return nonLeafKeys;
}

function firstMatchingPathIndex(path: string[], searchTokens: string[]): number {
  if (searchTokens.length === 0) return 0;

  for (let index = 0; index < path.length; index += 1) {
    const normalizedSegment = normalizePathSegment(path[index]);
    if (searchTokens.some((token) => normalizedSegment.includes(token))) {
      return index;
    }
  }

  return 0;
}

function toTreeItems(entries: ExerciseCatalogEntry[], searchTokens: string[]): TreeItem[] {
  return entries.map((entry) => {
    if (searchTokens.length === 0) {
      return { entry, treePath: entry.path };
    }

    const startIndex = firstMatchingPathIndex(entry.path, searchTokens);
    const slicedPath = entry.path.slice(startIndex);
    return { entry, treePath: slicedPath.length > 0 ? slicedPath : entry.path };
  });
}

function parseBoundedInt(value: string, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function parseOptionalBoundedInt(value: string, min: number, max: number): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function clampRestSeconds(value: number): number {
  return Math.max(0, Math.min(MAX_REST_SECONDS, Math.round(value)));
}

function formatRepsRange(min: number, max: number): string {
  if (min === max) return String(min);
  return `${min}-${max}`;
}

function splitRestSeconds(totalSeconds: number): { rest_minutes: string; rest_seconds: string } {
  const safe = clampRestSeconds(totalSeconds);
  return {
    rest_minutes: String(Math.floor(safe / 60)),
    rest_seconds: String(safe % 60),
  };
}

function normalizeDraftRestSeconds(exercise: DraftRoutineExercise): number {
  const parsedMinutes = parseOptionalBoundedInt(exercise.rest_minutes, 0, MAX_REST_MINUTES);
  const parsedSeconds = parseOptionalBoundedInt(exercise.rest_seconds, 0, 60);

  if (parsedMinutes === null && parsedSeconds === null) return 0;
  return clampRestSeconds((parsedMinutes ?? 0) * 60 + (parsedSeconds ?? 0));
}

function formatRestSeconds(restSeconds: number): string {
  if (restSeconds <= 0) return "Sin descanso";
  return `${restSeconds}s`;
}

function freezeNodes(source: Map<string, MutableNode>): CatalogNode[] {
  return Array.from(source.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((node) => {
      const children = freezeNodes(node.children);
      const items = [...node.items].sort((a, b) => a.entry.name.localeCompare(b.entry.name));
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

function buildTree(items: TreeItem[]): CatalogNode[] {
  const root = new Map<string, MutableNode>();

  for (const item of items) {
    if (item.treePath.length === 0) continue;

    let cursor = root;
    const currentPath: string[] = [];
    let currentNode: MutableNode | null = null;

    for (const segment of item.treePath) {
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
  onAdd: (entry: ExerciseCatalogEntry) => void,
  canAdd: (entry: ExerciseCatalogEntry) => boolean,
  expandAll: boolean,
) {
  return nodes.map((node) => (
    <details key={node.path.join(" > ")} className="treeNode" open={expandAll}>
      <summary className="treeSummary">
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
                  <strong>{item.entry.name}</strong>
                  <div className="small">{item.treePath.join(" > ")}</div>
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

        {node.children.length > 0 ? renderTree(node.children, onAdd, canAdd, expandAll) : null}
      </div>
    </details>
  ));
}

export default function Routines() {
  const { loading, syncError, entries: catalogEntries } = useExerciseCatalog();
  const [items, setItems] = useState<RoutineTemplate[]>(() => loadRoutines());
  const [name, setName] = useState("");
  const [draftExercises, setDraftExercises] = useState<DraftRoutineExercise[]>([]);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

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
  const searchTokens = useMemo(() => tokenizeExerciseSearch(search), [search]);
  const treeItems = useMemo(() => toTreeItems(filteredEntries, searchTokens), [filteredEntries, searchTokens]);
  const tree = useMemo(() => buildTree(treeItems), [treeItems]);
  const nonLeafPathKeys = useMemo(() => buildNonLeafPathKeys(catalogEntries), [catalogEntries]);

  const sorted = useMemo(() => [...items].sort((a, b) => a.name.localeCompare(b.name)), [items]);
  const hasIncompleteRepsRange = useMemo(
    () =>
      draftExercises.some(
        (exercise) => exercise.target_reps_min.trim() === "" || exercise.target_reps_max.trim() === "",
      ),
    [draftExercises],
  );
  const canSaveRoutine = name.trim().length > 0 && draftExercises.length > 0 && !hasIncompleteRepsRange;

  function isLeafEntry(entry: ExerciseCatalogEntry): boolean {
    return !nonLeafPathKeys.has(pathKey(entry.path));
  }

  useEffect(() => {
    if (!pickerOpen) return;

    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPickerOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [pickerOpen]);

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
    if (!isLeafEntry(entry)) {
      setError("Selecciona una rama final del catalogo para agregar el ejercicio.");
      return;
    }

    setError("");
    const next = entry.name;
    let added = false;
    setDraftExercises((prev) => {
      if (prev.some((value) => value.name.toLowerCase() === next.toLowerCase())) return prev;
      added = true;
      return [
        ...prev,
        {
          name: next,
          target_sets: DEFAULT_TARGET_SETS,
          target_reps_min: String(DEFAULT_TARGET_REPS_MIN),
          target_reps_max: String(DEFAULT_TARGET_REPS_MAX),
          ...splitRestSeconds(DEFAULT_REST_SECONDS),
        },
      ];
    });
    if (added) {
      setPickerOpen(false);
    }
  }

  function removeDraftExercise(nameValue: string) {
    setDraftExercises((prev) => prev.filter((entry) => entry.name !== nameValue));
  }

  function updateDraftExercise(
    nameValue: string,
    patch: Partial<
      Pick<DraftRoutineExercise, "target_sets" | "target_reps_min" | "target_reps_max" | "rest_minutes" | "rest_seconds">
    >,
  ) {
    setDraftExercises((prev) =>
      prev.map((entry) => (entry.name === nameValue ? { ...entry, ...patch } : entry)),
    );
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

    const hasMissingReps = draftExercises.some(
      (exercise) => exercise.target_reps_min.trim() === "" || exercise.target_reps_max.trim() === "",
    );
    if (hasMissingReps) {
      setError("Completa Reps min y Reps max en todos los ejercicios antes de guardar.");
      return;
    }

    const exists = items.some((entry) => entry.name.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      setError("Ya existe una rutina con ese nombre.");
      return;
    }

    const normalizedExercises: RoutineExerciseTemplate[] = draftExercises.map((exercise) => {
      const parsedMin = parseBoundedInt(exercise.target_reps_min, DEFAULT_TARGET_REPS_MIN, 1, 100);
      const parsedMax = parseBoundedInt(exercise.target_reps_max, DEFAULT_TARGET_REPS_MAX, 1, 100);

      return {
        name: exercise.name,
        target_sets: exercise.target_sets,
        target_reps_min: Math.min(parsedMin, parsedMax),
        target_reps_max: Math.max(parsedMin, parsedMax),
        rest_seconds: normalizeDraftRestSeconds(exercise),
      };
    });

    const next: RoutineTemplate[] = [
      ...items,
      { id: uid("rt"), name: trimmed, exercises: normalizedExercises, created_at_utc: new Date().toISOString() },
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

        <div className="quickActions" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => setPickerOpen(true)}>
            Agregar nuevo ejercicio
          </button>
          <button className="btn primary" onClick={addRoutine} disabled={!canSaveRoutine}>
            Guardar plantilla
          </button>
          <span className="chip">Asignados: {draftExercises.length}</span>
          <span className="chip">Total: {items.length}</span>
          {loading ? <span className="chip">Sincronizando...</span> : null}
        </div>
      </section>

      <section className="surface">
        <div className="sectionHead">
          <h3>Ejercicios asignados a la rutina</h3>
          <p>Revisa o quita ejercicios antes de guardar la plantilla.</p>
        </div>

        <div className="quickActions" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => setPickerOpen(true)}>
            Agregar nuevo ejercicio
          </button>
        </div>

        {draftExercises.length === 0 ? (
          <div className="emptyState" style={{ marginTop: 12 }}>
            Aun no agregaste ejercicios a la rutina.
          </div>
        ) : (
          <div className="treeLeafList" style={{ marginTop: 12 }}>
            {draftExercises.map((exercise) => (
              <article key={exercise.name} className="exerciseCard">
                <div className="hstack" style={{ justifyContent: "space-between" }}>
                  <strong>{exercise.name}</strong>
                  <button className="btn" onClick={() => removeDraftExercise(exercise.name)}>
                    Quitar
                  </button>
                </div>

                <div className="splitGrid" style={{ marginTop: 10 }}>
                  <div>
                    <label className="smallLabel">Series</label>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={30}
                      value={exercise.target_sets}
                      onChange={(e) =>
                        updateDraftExercise(exercise.name, {
                          target_sets: parseBoundedInt(e.target.value, exercise.target_sets, 1, 30),
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="smallLabel">Reps min</label>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={100}
                      value={exercise.target_reps_min}
                      onChange={(e) => {
                        const rawValue = e.target.value;
                        if (rawValue === "") {
                          updateDraftExercise(exercise.name, { target_reps_min: "" });
                          return;
                        }

                        const fallbackMin = parseBoundedInt(exercise.target_reps_min, DEFAULT_TARGET_REPS_MIN, 1, 100);
                        const nextMin = parseBoundedInt(rawValue, fallbackMin, 1, 100);
                        const patch: Partial<DraftRoutineExercise> = { target_reps_min: String(nextMin) };

                        if (exercise.target_reps_max.trim() !== "") {
                          const currentMax = parseBoundedInt(
                            exercise.target_reps_max,
                            DEFAULT_TARGET_REPS_MAX,
                            1,
                            100,
                          );
                          patch.target_reps_max = String(Math.max(nextMin, currentMax));
                        }

                        updateDraftExercise(exercise.name, patch);
                      }}
                    />
                  </div>
                  <div>
                    <label className="smallLabel">Reps max</label>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={100}
                      value={exercise.target_reps_max}
                      onChange={(e) => {
                        const rawValue = e.target.value;
                        if (rawValue === "") {
                          updateDraftExercise(exercise.name, { target_reps_max: "" });
                          return;
                        }

                        const fallbackMax = parseBoundedInt(exercise.target_reps_max, DEFAULT_TARGET_REPS_MAX, 1, 100);
                        const nextMax = parseBoundedInt(rawValue, fallbackMax, 1, 100);
                        const patch: Partial<DraftRoutineExercise> = { target_reps_max: String(nextMax) };

                        if (exercise.target_reps_min.trim() !== "") {
                          const currentMin = parseBoundedInt(
                            exercise.target_reps_min,
                            DEFAULT_TARGET_REPS_MIN,
                            1,
                            100,
                          );
                          patch.target_reps_min = String(Math.min(currentMin, nextMax));
                        }

                        updateDraftExercise(exercise.name, patch);
                      }}
                    />
                  </div>
                  <div>
                    <label className="smallLabel">Descanso</label>
                    <div className="hstack compact" style={{ flexWrap: "nowrap", gap: 6 }}>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        max={MAX_REST_MINUTES}
                        inputMode="numeric"
                        style={{ width: 62, minWidth: 62, padding: "8px 8px", textAlign: "center" }}
                        value={exercise.rest_minutes}
                        onChange={(e) => {
                          const rawValue = e.target.value;
                          if (rawValue === "") {
                            updateDraftExercise(exercise.name, { rest_minutes: "" });
                            return;
                          }

                          const fallbackMinutes = parseOptionalBoundedInt(
                            exercise.rest_minutes,
                            0,
                            MAX_REST_MINUTES,
                          ) ?? 0;
                          const nextMinutes = parseBoundedInt(rawValue, fallbackMinutes, 0, MAX_REST_MINUTES);
                          updateDraftExercise(exercise.name, { rest_minutes: String(nextMinutes) });
                        }}
                      />
                      <span className="smallLabel" style={{ margin: 0 }}>
                        min
                      </span>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        max={60}
                        inputMode="numeric"
                        style={{ width: 62, minWidth: 62, padding: "8px 8px", textAlign: "center" }}
                        value={exercise.rest_seconds}
                        onChange={(e) => {
                          const rawValue = e.target.value;
                          if (rawValue === "") {
                            updateDraftExercise(exercise.name, { rest_seconds: "" });
                            return;
                          }

                          const fallbackSeconds = parseOptionalBoundedInt(exercise.rest_seconds, 0, 60) ?? 0;
                          const nextSeconds = parseBoundedInt(rawValue, fallbackSeconds, 0, 60);
                          updateDraftExercise(exercise.name, { rest_seconds: String(nextSeconds) });
                        }}
                      />
                      <span className="smallLabel" style={{ margin: 0 }}>
                        seg
                      </span>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {pickerOpen ? (
        <div className="modalOverlay" role="presentation" onClick={() => setPickerOpen(false)}>
          <section
            className="modalCard"
            role="dialog"
            aria-modal="true"
            aria-labelledby="routine-picker-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sectionHead">
              <h3 id="routine-picker-title">Agregar nuevo ejercicio</h3>
              <p>Selecciona solo ejercicios finales de cada rama del catalogo.</p>
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
            </div>

            <div className="quickActions" style={{ marginTop: 10 }}>
              <button type="button" className="btn" onClick={clearFilters}>
                Limpiar filtros
              </button>
              <button type="button" className="btn" onClick={() => setPickerOpen(false)}>
                Cerrar
              </button>
            </div>

            {filteredEntries.length === 0 ? (
              <div className="emptyState" style={{ marginTop: 12 }}>
                Sin coincidencias para la combinacion de filtros actual.
              </div>
            ) : (
              <div className="treeList" style={{ marginTop: 12 }}>
                {renderTree(tree, addSelectedExercise, isLeafEntry, searchTokens.length > 0)}
              </div>
            )}
          </section>
        </div>
      ) : null}

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
                    <span key={`${routine.id}_${exercise.name}`} className="chip">
                      {`${exercise.name} - ${exercise.target_sets}x${formatRepsRange(exercise.target_reps_min, exercise.target_reps_max)} - ${formatRestSeconds(exercise.rest_seconds)}`}
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
