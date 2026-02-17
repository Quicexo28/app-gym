import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ingestSessions } from "../api";
import {
  ALL_EXERCISE_FILTER as ALL,
  cleanExerciseText,
  filterExerciseEntries,
  getExerciseFilterOptions,
  toExerciseCatalogEntries,
  type ExerciseFilters,
} from "../lib/exerciseCatalog";
import { loadExerciseCatalog, loadRoutines } from "../lib/storage";
import type { RoutineTemplate } from "../lib/storage";
import { toKg } from "../lib/units";
import { useAthleteId } from "../state/athlete";
import { usePreferences } from "../state/preferences";

type SetRow = { reps: string; load: string };
type ExerciseRow = { name: string; sets: SetRow[] };

const EMPTY_SET: SetRow = { reps: "", load: "" };

function toISOZ(datetimeLocal: string): string {
  const d = new Date(datetimeLocal);
  return d.toISOString();
}

export default function NewSession() {
  const [athleteId] = useAthleteId();
  const { prefs } = usePreferences();
  const nav = useNavigate();

  const [startLocal, setStartLocal] = useState<string>("");
  const [durationMin, setDurationMin] = useState<string>("60");
  const [effort, setEffort] = useState<string>(prefs.effortScale === "rir" ? "2" : "7");
  const [notes, setNotes] = useState<string>("");

  const [exercises, setExercises] = useState<ExerciseRow[]>([{ name: "", sets: [{ ...EMPTY_SET }] }]);

  const [routineId, setRoutineId] = useState<string>("");
  const [routines, setRoutines] = useState<RoutineTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  const [selectedGroup, setSelectedGroup] = useState<string>(ALL);
  const [selectedFamily, setSelectedFamily] = useState<string>(ALL);
  const [selectedVariation, setSelectedVariation] = useState<string>(ALL);
  const [selectedSubvariation, setSelectedSubvariation] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [selectedExerciseId, setSelectedExerciseId] = useState<string>("");

  const catalogEntries = useMemo(() => toExerciseCatalogEntries(loadExerciseCatalog()), []);
  const catalogNames = useMemo(
    () => new Set(catalogEntries.map((entry) => cleanExerciseText(entry.name).toLowerCase())),
    [catalogEntries],
  );

  useEffect(() => {
    setRoutines(loadRoutines());
  }, []);

  useEffect(() => {
    setEffort((prev) => {
      if (prev) return prev;
      return prefs.effortScale === "rir" ? "2" : "7";
    });
  }, [prefs.effortScale]);

  const effortChoices = prefs.effortScale === "rir" ? [0, 1, 2, 3] : [6, 7, 8, 9];

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

  const effectiveSelectedExerciseId = useMemo(() => {
    const stillVisible = filteredEntries.some((entry) => entry.id === selectedExerciseId);
    if (stillVisible) return selectedExerciseId;
    return filteredEntries[0]?.id || "";
  }, [filteredEntries, selectedExerciseId]);

  const selectedEntry = useMemo(
    () => filteredEntries.find((entry) => entry.id === effectiveSelectedExerciseId) || null,
    [effectiveSelectedExerciseId, filteredEntries],
  );

  function addBlankExercise() {
    setExercises((prev) => [...prev, { name: "", sets: [{ ...EMPTY_SET }] }]);
  }

  function addExerciseFromSelector() {
    setError("");
    if (!selectedEntry) {
      setError("Selecciona un ejercicio del listado.");
      return;
    }
    setExercises((prev) => [...prev, { name: selectedEntry.name, sets: [{ ...EMPTY_SET }] }]);
  }

  function removeExercise(idx: number) {
    setExercises((prev) => prev.filter((_, i) => i !== idx));
  }

  function setExerciseName(idx: number, name: string) {
    setExercises((prev) => prev.map((e, i) => (i === idx ? { ...e, name } : e)));
  }

  function addSet(exIdx: number) {
    setExercises((prev) =>
      prev.map((e, i) => (i === exIdx ? { ...e, sets: [...e.sets, { ...EMPTY_SET }] } : e)),
    );
  }

  function duplicateLastSet(exIdx: number) {
    setExercises((prev) =>
      prev.map((e, i) => {
        if (i !== exIdx) return e;
        const last = e.sets[e.sets.length - 1] || EMPTY_SET;
        return { ...e, sets: [...e.sets, { ...last }] };
      }),
    );
  }

  function removeSet(exIdx: number, setIdx: number) {
    setExercises((prev) =>
      prev.map((e, i) => (i === exIdx ? { ...e, sets: e.sets.filter((_, j) => j !== setIdx) } : e)),
    );
  }

  function setSetValue(exIdx: number, setIdx: number, key: "reps" | "load", value: string) {
    setExercises((prev) =>
      prev.map((e, i) => {
        if (i !== exIdx) return e;
        const sets = e.sets.map((s, j) => (j === setIdx ? { ...s, [key]: value } : s));
        return { ...e, sets };
      }),
    );
  }

  function applyRoutine(id: string) {
    setRoutineId(id);
    const r = routines.find((x) => x.id === id);
    if (!r) return;
    setExercises(r.exercises.map((name) => ({ name, sets: [{ ...EMPTY_SET }] })));
  }

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

  function parseEffort(): { apiRpe: number; raw: number } | null {
    const raw = Number(effort);
    if (!Number.isFinite(raw)) return null;

    if (prefs.effortScale === "rpe") {
      if (raw < 0 || raw > 10) return null;
      return { apiRpe: raw, raw };
    }

    if (raw < 0 || raw > 6) return null;
    return { apiRpe: Math.max(0, Math.min(10, 10 - raw)), raw };
  }

  async function submit() {
    setError("");
    if (!startLocal) {
      setError("Falta fecha/hora de inicio.");
      return;
    }

    const dur = Number(durationMin);
    if (!Number.isFinite(dur) || dur <= 0) {
      setError("Duracion invalida (minutos).");
      return;
    }

    const effortParsed = parseEffort();
    if (!effortParsed) {
      setError(prefs.effortScale === "rir" ? "RIR invalido (0-6)." : "RPE invalido (0-10).");
      return;
    }

    const exOut = exercises
      .map((e) => {
        const name = e.name.trim();
        const sets = e.sets
          .map((s) => ({ reps: Number(s.reps), loadValue: Number(s.load) }))
          .filter((s) => Number.isFinite(s.reps) && s.reps > 0 && Number.isFinite(s.loadValue) && s.loadValue >= 0)
          .map((s) => ({ reps: s.reps, load_kg: Number(toKg(s.loadValue, prefs.weightUnit).toFixed(3)) }));

        return { name, sets };
      })
      .filter((e) => e.name && e.sets.length > 0);

    if (exOut.length === 0) {
      setError("Agrega al menos 1 ejercicio con 1 set valido.");
      return;
    }

    const payload = [
      {
        athlete_id: athleteId,
        start_time: toISOZ(startLocal),
        duration_min: dur,
        rpe: effortParsed.apiRpe,
        modality: "strength",
        exercises: exOut,
        source: "ui",
        meta: {
          note: notes || undefined,
          effort_input: {
            scale: prefs.effortScale,
            value: effortParsed.raw,
          },
          weight_unit_input: prefs.weightUnit,
        },
      },
    ];

    setBusy(true);
    try {
      await ingestSessions(payload);
      nav("/history");
    } catch (e: unknown) {
      setError(String((e as { message?: string })?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Nueva sesion</h1>
        <p>Registro rapido para gym. Las cargas se guardan en kg internamente aunque escribas en {prefs.weightUnit}.</p>
      </header>

      <section className="surface">
        <div className="chipRow">
          <span className="chip">Athlete: {athleteId}</span>
          <span className="chip">Escala: {prefs.effortScale.toUpperCase()}</span>
          <span className="chip">Carga: {prefs.weightUnit}</span>
        </div>

        {error ? <div className="message error">{error}</div> : null}

        <div className="splitGrid">
          <div>
            <label className="smallLabel">Inicio</label>
            <input
              className="input"
              type="datetime-local"
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
            />
          </div>
          <div>
            <label className="smallLabel">Duracion (min)</label>
            <input className="input" value={durationMin} onChange={(e) => setDurationMin(e.target.value)} />
          </div>
          <div>
            <label className="smallLabel">{prefs.effortScale === "rir" ? "RIR (0-6)" : "RPE (0-10)"}</label>
            <input className="input" value={effort} onChange={(e) => setEffort(e.target.value)} />
          </div>
        </div>

        <div className="chipRow" style={{ marginTop: 10 }}>
          {effortChoices.map((value) => (
            <button key={value} type="button" className="chipButton" onClick={() => setEffort(String(value))}>
              {prefs.effortScale.toUpperCase()} {value}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 12 }}>
          <label className="smallLabel">Nota breve (opcional)</label>
          <input
            className="input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="sueno, estres, sensacion general"
          />
        </div>
      </section>

      <section className="surface">
        <div className="sectionHead">
          <h3>Plantilla de rutina</h3>
          <p>Aplica una plantilla para cargar ejercicios en un toque.</p>
        </div>
        <div className="hstack">
          <select className="input" value={routineId} onChange={(e) => applyRoutine(e.target.value)}>
            <option value="">Sin plantilla</option>
            {routines.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => nav("/routines")}>
            Gestionar rutinas
          </button>
        </div>
      </section>

      <section className="surface">
        <div className="sectionHead">
          <h3>Ejercicios</h3>
          <p>Usa selector jerarquico para agregar rapido y deja el detalle por sets abajo.</p>
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
          <button className="btn primary" onClick={addExerciseFromSelector} disabled={!selectedEntry}>
            + Agregar desde selector
          </button>
          <button className="btn" onClick={addBlankExercise}>
            + Ejercicio libre
          </button>
        </div>

        <div className="stack" style={{ marginTop: 12 }}>
          {exercises.map((ex, exIdx) => {
            const hasOption = catalogNames.has(cleanExerciseText(ex.name).toLowerCase());

            return (
              <div key={exIdx} className="exerciseCard">
                <div className="hstack" style={{ justifyContent: "space-between" }}>
                  <div style={{ flex: 1 }}>
                    <label className="smallLabel">Ejercicio</label>
                    <select className="input" value={ex.name} onChange={(e) => setExerciseName(exIdx, e.target.value)}>
                      {!hasOption && ex.name ? (
                        <option value={ex.name}>{ex.name} (manual)</option>
                      ) : null}
                      <option value="">Selecciona ejercicio...</option>
                      {catalogEntries.map((entry) => (
                        <option key={entry.id} value={entry.name}>
                          {entry.path.join(" > ")}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button className="btn" onClick={() => removeExercise(exIdx)} disabled={exercises.length <= 1}>
                    Quitar
                  </button>
                </div>

                <div className="setGrid">
                  {ex.sets.map((s, setIdx) => (
                    <div key={setIdx} className="setRow">
                      <span className="setTag">Set {setIdx + 1}</span>
                      <input
                        className="input"
                        value={s.reps}
                        onChange={(e) => setSetValue(exIdx, setIdx, "reps", e.target.value)}
                        placeholder="reps"
                      />
                      <input
                        className="input"
                        value={s.load}
                        onChange={(e) => setSetValue(exIdx, setIdx, "load", e.target.value)}
                        placeholder={`carga (${prefs.weightUnit})`}
                      />
                      <button className="btn" onClick={() => removeSet(exIdx, setIdx)} disabled={ex.sets.length <= 1}>
                        -
                      </button>
                    </div>
                  ))}
                </div>

                <div className="hstack compact">
                  <button className="btn" onClick={() => addSet(exIdx)}>
                    + Set vacio
                  </button>
                  <button className="btn" onClick={() => duplicateLastSet(exIdx)}>
                    + Duplicar ultimo set
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="surface">
        <div className="hstack">
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? "Guardando..." : "Guardar sesion"}
          </button>
          <button className="btn" onClick={() => nav("/history")} disabled={busy}>
            Cancelar
          </button>
        </div>
      </section>
    </div>
  );
}
