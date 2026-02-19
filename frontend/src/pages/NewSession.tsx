import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ingestSessions } from "../api";
import { loadRoutines } from "../lib/storage";
import type { RoutineTemplate } from "../lib/storage";
import { toKg } from "../lib/units";
import { useAthleteId } from "../state/athlete";
import { usePreferences } from "../state/preferences";

type SetRow = { reps: string; load: string };
type RoutineExerciseDraft = { name: string; sets: SetRow[] };

const EMPTY_SET: SetRow = { reps: "", load: "" };

function toISOZ(datetimeLocal: string): string {
  const d = new Date(datetimeLocal);
  return d.toISOString();
}

function normalizeRoutineExercises(source: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of source) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function routineToDraft(routine: RoutineTemplate): RoutineExerciseDraft[] {
  return normalizeRoutineExercises(routine.exercises).map((name) => ({ name, sets: [{ ...EMPTY_SET }] }));
}

export default function NewSession() {
  const [athleteId] = useAthleteId();
  const { prefs } = usePreferences();
  const nav = useNavigate();

  const [startLocal, setStartLocal] = useState<string>("");
  const [durationMin, setDurationMin] = useState<string>("60");
  const [effort, setEffort] = useState<string>(prefs.effortScale === "rir" ? "2" : "7");
  const [notes, setNotes] = useState<string>("");

  const [routineId, setRoutineId] = useState<string>("");
  const [routines, setRoutines] = useState<RoutineTemplate[]>([]);
  const [routineExercises, setRoutineExercises] = useState<RoutineExerciseDraft[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

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

  const sortedRoutines = useMemo(() => [...routines].sort((a, b) => a.name.localeCompare(b.name)), [routines]);
  const selectedRoutine = useMemo(() => sortedRoutines.find((routine) => routine.id === routineId) || null, [routineId, sortedRoutines]);

  function applyRoutine(nextRoutineId: string) {
    setRoutineId(nextRoutineId);
    setError("");
    const routine = sortedRoutines.find((item) => item.id === nextRoutineId);
    if (!routine) {
      setRoutineExercises([]);
      return;
    }
    setRoutineExercises(routineToDraft(routine));
  }

  function addSet(exIdx: number) {
    setRoutineExercises((prev) =>
      prev.map((entry, i) => (i === exIdx ? { ...entry, sets: [...entry.sets, { ...EMPTY_SET }] } : entry)),
    );
  }

  function duplicateLastSet(exIdx: number) {
    setRoutineExercises((prev) =>
      prev.map((entry, i) => {
        if (i !== exIdx) return entry;
        const last = entry.sets[entry.sets.length - 1] || EMPTY_SET;
        return { ...entry, sets: [...entry.sets, { ...last }] };
      }),
    );
  }

  function removeSet(exIdx: number, setIdx: number) {
    setRoutineExercises((prev) =>
      prev.map((entry, i) => (i === exIdx ? { ...entry, sets: entry.sets.filter((_, j) => j !== setIdx) } : entry)),
    );
  }

  function setSetValue(exIdx: number, setIdx: number, key: "reps" | "load", value: string) {
    setRoutineExercises((prev) =>
      prev.map((entry, i) => {
        if (i !== exIdx) return entry;
        const sets = entry.sets.map((set, j) => (j === setIdx ? { ...set, [key]: value } : set));
        return { ...entry, sets };
      }),
    );
  }

  function resetRoutineSets() {
    if (!selectedRoutine) return;
    setRoutineExercises(routineToDraft(selectedRoutine));
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

    if (!selectedRoutine) {
      setError("Selecciona una rutina para registrar la sesion.");
      return;
    }

    if (!startLocal) {
      setError("Falta fecha/hora de inicio.");
      return;
    }

    const duration = Number(durationMin);
    if (!Number.isFinite(duration) || duration <= 0) {
      setError("Duracion invalida (minutos).");
      return;
    }

    const effortParsed = parseEffort();
    if (!effortParsed) {
      setError(prefs.effortScale === "rir" ? "RIR invalido (0-6)." : "RPE invalido (0-10).");
      return;
    }

    const exercisesOut = [];
    for (const entry of routineExercises) {
      const sets = entry.sets
        .map((set) => ({ reps: Number(set.reps), loadValue: Number(set.load) }))
        .filter((set) => Number.isFinite(set.reps) && set.reps > 0 && Number.isFinite(set.loadValue) && set.loadValue >= 0)
        .map((set) => ({ reps: set.reps, load_kg: Number(toKg(set.loadValue, prefs.weightUnit).toFixed(3)) }));

      if (sets.length === 0) {
        setError(`Completa al menos 1 set valido en "${entry.name}".`);
        return;
      }
      exercisesOut.push({ name: entry.name, sets });
    }

    const payload = [
      {
        athlete_id: athleteId,
        start_time: toISOZ(startLocal),
        duration_min: duration,
        rpe: effortParsed.apiRpe,
        modality: "strength",
        exercises: exercisesOut,
        source: "ui_routine",
        meta: {
          note: notes || undefined,
          routine_id: selectedRoutine.id,
          routine_name: selectedRoutine.name,
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
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    } finally {
      setBusy(false);
    }
  }

  const hasRoutines = sortedRoutines.length > 0;

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Nueva sesion</h1>
        <p>Registro guiado por rutina. Cada sesion se construye desde una plantilla existente.</p>
      </header>

      <section className="surface">
        <div className="chipRow">
          <span className="chip">Athlete: {athleteId}</span>
          <span className="chip">Escala: {prefs.effortScale.toUpperCase()}</span>
          <span className="chip">Carga: {prefs.weightUnit}</span>
          <span className="chip">Rutinas: {sortedRoutines.length}</span>
        </div>

        {error ? <div className="message error" style={{ marginTop: 12 }}>{error}</div> : null}

        {!hasRoutines ? (
          <div className="emptyState" style={{ marginTop: 12 }}>
            No hay rutinas creadas. Crea al menos una rutina para poder registrar sesiones.
            <div className="quickActions" style={{ marginTop: 10 }}>
              <button className="btn primary" onClick={() => nav("/routines")}>
                Ir a rutinas
              </button>
            </div>
          </div>
        ) : (
          <div className="splitGrid" style={{ marginTop: 12 }}>
            <div>
              <label className="smallLabel">Rutina</label>
              <select className="input" value={routineId} onChange={(e) => applyRoutine(e.target.value)}>
                <option value="">Selecciona una rutina...</option>
                {sortedRoutines.map((routine) => (
                  <option key={routine.id} value={routine.id}>
                    {routine.name} ({routine.exercises.length})
                  </option>
                ))}
              </select>
            </div>

            <div style={{ alignSelf: "end" }}>
              <div className="quickActions">
                <button className="btn" onClick={() => nav("/routines")}>
                  Gestionar rutinas
                </button>
                <button className="btn" onClick={resetRoutineSets} disabled={!selectedRoutine}>
                  Reiniciar sets
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="surface">
        <div className="sectionHead">
          <h3>Datos de la sesion</h3>
          <p>Se aplican a todos los ejercicios de la rutina seleccionada.</p>
        </div>

        <div className="splitGrid" style={{ marginTop: 10 }}>
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
          <h3>Ejercicios de rutina</h3>
          <p>
            {selectedRoutine
              ? `Rutina activa: ${selectedRoutine.name}`
              : "Selecciona una rutina para capturar sets en cada ejercicio."}
          </p>
        </div>

        {!selectedRoutine ? (
          <div className="emptyState" style={{ marginTop: 12 }}>
            Aun no seleccionaste una rutina.
          </div>
        ) : (
          <div className="stack" style={{ marginTop: 12 }}>
            {routineExercises.map((exercise, exIdx) => (
              <div key={`${selectedRoutine.id}_${exercise.name}_${exIdx}`} className="exerciseCard">
                <div className="hstack" style={{ justifyContent: "space-between" }}>
                  <div>
                    <label className="smallLabel">Ejercicio</label>
                    <strong>{exercise.name}</strong>
                  </div>
                  <span className="chip">Sets: {exercise.sets.length}</span>
                </div>

                <div className="setGrid">
                  {exercise.sets.map((set, setIdx) => (
                    <div key={setIdx} className="setRow">
                      <span className="setTag">Set {setIdx + 1}</span>
                      <input
                        className="input"
                        value={set.reps}
                        onChange={(e) => setSetValue(exIdx, setIdx, "reps", e.target.value)}
                        placeholder="reps"
                      />
                      <input
                        className="input"
                        value={set.load}
                        onChange={(e) => setSetValue(exIdx, setIdx, "load", e.target.value)}
                        placeholder={`carga (${prefs.weightUnit})`}
                      />
                      <button className="btn" onClick={() => removeSet(exIdx, setIdx)} disabled={exercise.sets.length <= 1}>
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
            ))}
          </div>
        )}
      </section>

      <section className="surface">
        <div className="hstack">
          <button className="btn primary" onClick={submit} disabled={busy || !selectedRoutine}>
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
