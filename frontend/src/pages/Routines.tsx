import { useMemo, useState } from "react";

import {
  ALL_EXERCISE_FILTER as ALL,
  filterExerciseEntries,
  getExerciseFilterOptions,
  toExerciseCatalogEntries,
  type ExerciseFilters,
} from "../lib/exerciseCatalog";
import { loadExerciseCatalog, loadRoutines, saveRoutines, uid } from "../lib/storage";
import type { RoutineTemplate } from "../lib/storage";

type EntryLevel = "all" | "base" | "variation" | "subvariation";

function pathLevel(path: string[]): Exclude<EntryLevel, "all"> {
  if (path.length <= 2) return "base";
  if (path.length === 3) return "variation";
  return "subvariation";
}

export default function Routines() {
  const [items, setItems] = useState<RoutineTemplate[]>(() => loadRoutines());
  const [name, setName] = useState("");
  const [draftExercises, setDraftExercises] = useState<string[]>([]);
  const [error, setError] = useState("");

  const [selectedGroup, setSelectedGroup] = useState<string>(ALL);
  const [selectedFamily, setSelectedFamily] = useState<string>(ALL);
  const [selectedVariation, setSelectedVariation] = useState<string>(ALL);
  const [selectedSubvariation, setSelectedSubvariation] = useState<string>(ALL);
  const [selectedLevel, setSelectedLevel] = useState<EntryLevel>("all");
  const [search, setSearch] = useState("");
  const [selectedExerciseId, setSelectedExerciseId] = useState<string>("");

  const catalogEntries = useMemo(() => toExerciseCatalogEntries(loadExerciseCatalog()), []);

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

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

  const filteredEntries = useMemo(() => {
    const narrowed = filterExerciseEntries(catalogEntries, filters);
    if (selectedLevel === "all") return narrowed;
    return narrowed.filter((entry) => pathLevel(entry.path) === selectedLevel);
  }, [catalogEntries, filters, selectedLevel]);

  const effectiveSelectedExerciseId = useMemo(() => {
    const stillVisible = filteredEntries.some((entry) => entry.id === selectedExerciseId);
    if (stillVisible) return selectedExerciseId;
    return filteredEntries[0]?.id || "";
  }, [filteredEntries, selectedExerciseId]);

  const selectedEntry = useMemo(
    () => filteredEntries.find((entry) => entry.id === effectiveSelectedExerciseId) || null,
    [effectiveSelectedExerciseId, filteredEntries],
  );

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

  function addSelectedExercise() {
    setError("");
    if (!selectedEntry) {
      setError("Selecciona un ejercicio del listado filtrado.");
      return;
    }

    const next = selectedEntry.name;
    if (draftExercises.some((x) => x.toLowerCase() === next.toLowerCase())) return;
    setDraftExercises((prev) => [...prev, next]);
  }

  function removeDraftExercise(value: string) {
    setDraftExercises((prev) => prev.filter((x) => x !== value));
  }

  function clearFilters() {
    setSelectedGroup(ALL);
    setSelectedFamily(ALL);
    setSelectedVariation(ALL);
    setSelectedSubvariation(ALL);
    setSelectedLevel("all");
    setSearch("");
  }

  function addRoutine() {
    setError("");
    const n = name.trim();

    if (!n) {
      setError("Escribe un nombre para la rutina.");
      return;
    }

    if (draftExercises.length === 0) {
      setError("Agrega al menos un ejercicio.");
      return;
    }

    const exists = items.some((x) => x.name.toLowerCase() === n.toLowerCase());
    if (exists) {
      setError("Ya existe una rutina con ese nombre.");
      return;
    }

    const next: RoutineTemplate[] = [
      ...items,
      { id: uid("rt"), name: n, exercises: draftExercises, created_at_utc: new Date().toISOString() },
    ];

    setItems(next);
    saveRoutines(next);
    setName("");
    setDraftExercises([]);
  }

  function removeRoutine(id: string) {
    const next = items.filter((x) => x.id !== id);
    setItems(next);
    saveRoutines(next);
  }

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Rutinas</h1>
        <p>
          Constructor con filtros anidados: grupo {'>'} ejercicio {'>'} variacion {'>'} subvariacion.
        </p>
      </header>

      <section className="surface">
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
              {groupOptions.map((group) => (
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
              {familyOptions.map((family) => (
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
              {variationOptions.map((variation) => (
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
              {subvariationOptions.map((subvariation) => (
                <option key={subvariation} value={subvariation}>
                  {subvariation}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="smallLabel">Nivel</label>
            <select className="input" value={selectedLevel} onChange={(e) => setSelectedLevel(e.target.value as EntryLevel)}>
              <option value="all">Todos</option>
              <option value="base">Solo base</option>
              <option value="variation">Solo variaciones</option>
              <option value="subvariation">Solo subvariaciones</option>
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
        </div>

        <div className="catalogList" style={{ marginTop: 12 }}>
          {filteredEntries.length === 0 ? (
            <div className="emptyState">Sin coincidencias para la combinacion de filtros actual.</div>
          ) : (
            filteredEntries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`catalogItem ${effectiveSelectedExerciseId === entry.id ? "active" : ""}`}
                onClick={() => setSelectedExerciseId(entry.id)}
              >
                <strong>{entry.name}</strong>
                <span className="small">{entry.path.join(" > ")}</span>
              </button>
            ))
          )}
        </div>

        <div className="quickActions" style={{ marginTop: 12 }}>
          <button className="btn" onClick={addSelectedExercise} disabled={!selectedEntry}>
            + Agregar seleccionado
          </button>
        </div>

        <div className="chipRow" style={{ marginTop: 10 }}>
          {draftExercises.length === 0 ? <span className="chip">Sin ejercicios aun</span> : null}
          {draftExercises.map((ex) => (
            <button key={ex} className="chipButton" onClick={() => removeDraftExercise(ex)}>
              {ex} x
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
            {sorted.map((r) => (
              <article key={r.id} className="surfaceButton">
                <strong>{r.name}</strong>
                <div className="chipRow">
                  {r.exercises.map((ex) => (
                    <span key={`${r.id}_${ex}`} className="chip">
                      {ex}
                    </span>
                  ))}
                </div>
                <button className="btn" onClick={() => removeRoutine(r.id)}>
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
