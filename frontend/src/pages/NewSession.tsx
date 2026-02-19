import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ingestSessions } from "../api";
import { loadRoutines } from "../lib/storage";
import type { RoutineTemplate } from "../lib/storage";
import { toKg } from "../lib/units";
import { useAthleteAccess, useAthleteId } from "../state/athlete";
import { usePreferences } from "../state/preferences";

type SetRow = { reps: string; load: string };
type RoutineExerciseDraft = { name: string; sets: SetRow[] };
type SessionStep = "pick_routine" | "capture_session";

const EMPTY_SET: SetRow = { reps: "", load: "" };
const DEFAULT_DURATION_MIN = "60";

function toISOZ(datetimeLocal: string): string {
  const d = new Date(datetimeLocal);
  return d.toISOString();
}

function deviceDatetimeLocal(): string {
  const now = new Date();
  const timezoneOffsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
}

function parseDurationSeconds(value: string): number | null {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.round(minutes * 60);
}

function formatTimer(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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
  const { athleteIds, canSwitch, ready: athleteReady } = useAthleteAccess();
  const [athleteId] = useAthleteId();
  const { prefs } = usePreferences();
  const nav = useNavigate();

  const [step, setStep] = useState<SessionStep>("pick_routine");
  const [startLocal, setStartLocal] = useState<string>("");
  const [durationMin, setDurationMin] = useState<string>(DEFAULT_DURATION_MIN);
  const [effort, setEffort] = useState<string>(prefs.effortScale === "rir" ? "2" : "7");
  const [notes, setNotes] = useState<string>("");

  const [routineId, setRoutineId] = useState<string>("");
  const [routines, setRoutines] = useState<RoutineTemplate[]>([]);
  const [routineExercises, setRoutineExercises] = useState<RoutineExerciseDraft[]>([]);

  const [remainingSec, setRemainingSec] = useState<number>(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerFinished, setTimerFinished] = useState(false);

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
  const durationSeconds = useMemo(() => parseDurationSeconds(durationMin), [durationMin]);

  useEffect(() => {
    if (!timerRunning) return;

    const intervalId = window.setInterval(() => {
      setRemainingSec((prev) => {
        if (prev <= 1) {
          window.clearInterval(intervalId);
          setTimerRunning(false);
          setTimerFinished(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [timerRunning]);

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

  function startSessionStep() {
    if (!selectedRoutine) {
      setError("Selecciona una rutina para comenzar la sesion.");
      return;
    }

    setError("");
    setRoutineExercises(routineToDraft(selectedRoutine));
    setStartLocal(deviceDatetimeLocal());
    setStep("capture_session");

    if (!durationSeconds) {
      setRemainingSec(0);
      setTimerRunning(false);
      setTimerFinished(false);
      setError("Duracion invalida (minutos).");
      return;
    }

    setRemainingSec(durationSeconds);
    setTimerFinished(false);
    setTimerRunning(true);
  }

  function goBackToRoutineStep() {
    setStep("pick_routine");
    setTimerRunning(false);
    setTimerFinished(false);
    setRemainingSec(0);
    setError("");
  }

  function startOrResumeTimer() {
    if (!durationSeconds) {
      setError("Duracion invalida (minutos).");
      return;
    }

    setError("");
    const mustReset = timerFinished || remainingSec <= 0;
    if (mustReset) {
      setRemainingSec(durationSeconds);
      setTimerFinished(false);
    }
    setTimerRunning(true);
  }

  function pauseTimer() {
    setTimerRunning(false);
  }

  function resetTimer(autostart: boolean) {
    if (!durationSeconds) {
      setError("Duracion invalida (minutos).");
      return;
    }

    setError("");
    setRemainingSec(durationSeconds);
    setTimerFinished(false);
    setTimerRunning(autostart);
  }

  function updateDuration(next: string) {
    setDurationMin(next);
    if (timerRunning) return;

    const parsed = parseDurationSeconds(next);
    if (!parsed) {
      setRemainingSec(0);
      return;
    }

    setRemainingSec(parsed);
    setTimerFinished(false);
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

    if (!athleteId) {
      setError("No hay atleta activo para registrar la sesion.");
      return;
    }

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
  const hasActiveAthlete = Boolean(athleteId);

  if (step === "pick_routine") {
    return (
      <div className="container stack">
        <header className="titleBlock">
          <h1>Nueva sesion</h1>
          <p>Paso 1/2. Selecciona una rutina para iniciar el registro.</p>
        </header>

        <section className="surface">
          <div className="chipRow">
            <span className="chip">Athlete: {athleteId}</span>
            <span className="chip">Escala: {prefs.effortScale.toUpperCase()}</span>
            <span className="chip">Carga: {prefs.weightUnit}</span>
            <span className="chip">Rutinas: {sortedRoutines.length}</span>
          </div>

          {error ? (
            <div className="message error" style={{ marginTop: 12 }}>
              {error}
            </div>
          ) : null}

          {!hasRoutines ? (
            <div className="emptyState" style={{ marginTop: 12 }}>
              No hay rutinas creadas. Crea al menos una rutina para registrar sesiones.
              <div className="quickActions" style={{ marginTop: 10 }}>
                <button className="btn primary" onClick={() => nav("/routines")}>
                  Ir a rutinas
                </button>
              </div>
            </div>
          ) : canSwitch && athleteReady && athleteIds.length === 0 ? (
            <div className="emptyState" style={{ marginTop: 12 }}>
              No tienes atletas asignados. Pide a un admin que te asigne al menos uno para poder registrar sesiones.
            </div>
          ) : (
            <div className="stack" style={{ marginTop: 12 }}>
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

              <div className="quickActions">
                <button className="btn primary" onClick={startSessionStep} disabled={!selectedRoutine || !hasActiveAthlete}>
                  Continuar a datos de sesion
                </button>
                <button className="btn" onClick={() => nav("/routines")}>
                  Gestionar rutinas
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    );
  }

  const timerStatus = timerRunning ? "En curso" : timerFinished ? "Finalizado" : "Pausado";
  const timerActionLabel = timerFinished || remainingSec <= 0 ? "Iniciar nuevamente" : "Reanudar";

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Sesion por rutina</h1>
        <p>Paso 2/2. Fecha predefinida del dispositivo y temporizador activo por duracion.</p>
      </header>

      <section className="surface">
        <div className="chipRow">
          <span className="chip">Athlete: {athleteId}</span>
          <span className="chip">Escala: {prefs.effortScale.toUpperCase()}</span>
          <span className="chip">Carga: {prefs.weightUnit}</span>
          <span className="chip">Rutina: {selectedRoutine?.name || "-"}</span>
        </div>

        {error ? (
          <div className="message error" style={{ marginTop: 12 }}>
            {error}
          </div>
        ) : null}

        <div className="quickActions" style={{ marginTop: 12 }}>
          <button className="btn" onClick={goBackToRoutineStep}>
            Cambiar rutina
          </button>
          <button className="btn" onClick={() => nav("/routines")}>
            Gestionar rutinas
          </button>
          <button className="btn" onClick={resetRoutineSets} disabled={!selectedRoutine}>
            Reiniciar sets
          </button>
        </div>
      </section>

      <section className="surface">
        <div className="sectionHead">
          <h3>Datos de la rutina</h3>
          <p>Fecha tomada del dispositivo al iniciar el paso 2 y duracion con temporizador.</p>
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
            <input className="input" value={durationMin} onChange={(e) => updateDuration(e.target.value)} />
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

        <div className="surface" style={{ marginTop: 12, padding: 12 }}>
          <div className="sectionHead">
            <h4>Temporizador de sesion</h4>
            <p>Iniciado al entrar en este paso. Se detiene automaticamente al finalizar.</p>
          </div>
          <div className="timerValue" style={{ marginTop: 10 }}>
            {formatTimer(remainingSec)}
          </div>
          <div className="chipRow" style={{ marginTop: 8 }}>
            <span className="chip">Estado: {timerStatus}</span>
            <span className="chip">Duracion objetivo: {durationMin || "-"} min</span>
          </div>
          <div className="quickActions" style={{ marginTop: 10 }}>
            {timerRunning ? (
              <button className="btn primary" type="button" onClick={pauseTimer}>
                Pausar temporizador
              </button>
            ) : (
              <button className="btn primary" type="button" onClick={startOrResumeTimer} disabled={!durationSeconds}>
                {timerActionLabel}
              </button>
            )}
            <button className="btn" type="button" onClick={() => resetTimer(true)} disabled={!durationSeconds}>
              Reiniciar
            </button>
          </div>
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
          <button className="btn primary" onClick={submit} disabled={busy || !selectedRoutine || !hasActiveAthlete}>
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
