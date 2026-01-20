import { useEffect, useMemo, useState } from "react";
import { ingestSessions } from "../api";
import { useAthleteId } from "../state/athlete";
import { loadExerciseCatalog, loadRoutines } from "../lib/storage";
import type { RoutineTemplate } from "../lib/storage";
import { useNavigate } from "react-router-dom";

type SetRow = { reps: string; load_kg: string };
type ExerciseRow = { name: string; sets: SetRow[] };

function toISOZ(datetimeLocal: string): string {
  const d = new Date(datetimeLocal);
  return d.toISOString();
}

export default function NewSession() {
  const [athleteId] = useAthleteId();
  const nav = useNavigate();

  const [startLocal, setStartLocal] = useState<string>("");
  const [durationMin, setDurationMin] = useState<string>("60");
  const [rpe, setRpe] = useState<string>("7");
  const [notes, setNotes] = useState<string>("");

  const [exercises, setExercises] = useState<ExerciseRow[]>([{ name: "", sets: [{ reps: "", load_kg: "" }] }]);

  const [routineId, setRoutineId] = useState<string>("");
  const [routines, setRoutines] = useState<RoutineTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  const catalog = useMemo(() => loadExerciseCatalog(), []);

  useEffect(() => {
    setRoutines(loadRoutines());
  }, []);

  function addExercise() {
    setExercises((prev) => [...prev, { name: "", sets: [{ reps: "", load_kg: "" }] }]);
  }

  function removeExercise(idx: number) {
    setExercises((prev) => prev.filter((_, i) => i !== idx));
  }

  function setExerciseName(idx: number, name: string) {
    setExercises((prev) => prev.map((e, i) => (i === idx ? { ...e, name } : e)));
  }

  function addSet(exIdx: number) {
    setExercises((prev) =>
      prev.map((e, i) => (i === exIdx ? { ...e, sets: [...e.sets, { reps: "", load_kg: "" }] } : e)),
    );
  }

  function removeSet(exIdx: number, setIdx: number) {
    setExercises((prev) =>
      prev.map((e, i) => (i === exIdx ? { ...e, sets: e.sets.filter((_, j) => j !== setIdx) } : e)),
    );
  }

  function setSetValue(exIdx: number, setIdx: number, key: "reps" | "load_kg", value: string) {
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
    setExercises(r.exercises.map((name) => ({ name, sets: [{ reps: "", load_kg: "" }] })));
  }

  async function submit() {
    setError("");
    if (!startLocal) {
      setError("Falta fecha/hora de inicio.");
      return;
    }
    const dur = Number(durationMin);
    if (!Number.isFinite(dur) || dur <= 0) {
      setError("Duración inválida (minutos).");
      return;
    }
    const r = Number(rpe);
    if (!Number.isFinite(r) || r < 0 || r > 10) {
      setError("RPE inválido (0–10).");
      return;
    }

    const exOut = exercises
      .map((e) => {
        const name = e.name.trim();
        const sets = e.sets
          .map((s) => ({ reps: Number(s.reps), load_kg: Number(s.load_kg) }))
          .filter((s) => Number.isFinite(s.reps) && s.reps > 0 && Number.isFinite(s.load_kg) && s.load_kg >= 0);

        return { name, sets };
      })
      .filter((e) => e.name && e.sets.length > 0);

    if (exOut.length === 0) {
      setError("Agrega al menos 1 ejercicio con al menos 1 set válido.");
      return;
    }

    const payload = [
      {
        athlete_id: athleteId,
        start_time: toISOZ(startLocal),
        duration_min: dur,
        rpe: r,
        modality: "strength",
        exercises: exOut,
        source: "ui",
        meta: notes ? { note: notes } : {},
      },
    ];

    setBusy(true);
    try {
      await ingestSessions(payload);
      nav("/history");
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <div className="card">
        <div className="badge">Athlete: {athleteId}</div>
        <h2 style={{ margin: "10px 0 0 0" }}>Nueva sesión</h2>
        <div className="small">Registro cómodo para gym. No prescribe cargas: solo captura datos.</div>

        <hr />

        {error ? (
          <div className="card" style={{ borderColor: "#f1c4c4", background: "#fff5f5" }}>
            <div className="small" style={{ color: "#8a1f1f" }}>
              {error}
            </div>
          </div>
        ) : null}

        <div className="row" style={{ marginTop: 12 }}>
          <div className="card">
            <div className="small" style={{ fontWeight: 700 }}>
              Datos base
            </div>

            <div className="row" style={{ marginTop: 10 }}>
              <div>
                <div className="small">Inicio</div>
                <input
                  className="input"
                  type="datetime-local"
                  value={startLocal}
                  onChange={(e) => setStartLocal(e.target.value)}
                />
              </div>
              <div>
                <div className="small">Duración (min)</div>
                <input className="input" value={durationMin} onChange={(e) => setDurationMin(e.target.value)} />
              </div>
              <div>
                <div className="small">RPE (0–10)</div>
                <input className="input" value={rpe} onChange={(e) => setRpe(e.target.value)} />
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <div className="small">Notas (opcional)</div>
              <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: sueño bajo, estrés..." />
            </div>
          </div>

          <div className="card">
            <div className="small" style={{ fontWeight: 700 }}>
              Plantilla (Rutina)
            </div>

            <div className="hstack" style={{ marginTop: 10 }}>
              <select className="input" value={routineId} onChange={(e) => applyRoutine(e.target.value)}>
                <option value="">(sin plantilla)</option>
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

            <div className="small" style={{ marginTop: 10 }}>
              Tip: gestiona nombres en “Ejercicios” para que el historial sea consistente.
            </div>

            <div className="small" style={{ marginTop: 10 }}>
              Catálogo: {catalog.length} ejercicios (opcional)
            </div>
          </div>
        </div>

        <hr />

        <div className="small" style={{ fontWeight: 700 }}>
          Ejercicios
        </div>

        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {exercises.map((ex, exIdx) => (
            <div key={exIdx} className="card">
              <div className="hstack" style={{ justifyContent: "space-between" }}>
                <div style={{ flex: "1 1 auto" }}>
                  <div className="small">Ejercicio</div>
                  <input
                    className="input"
                    value={ex.name}
                    onChange={(e) => setExerciseName(exIdx, e.target.value)}
                    placeholder="Ej: Bench Press"
                    list="exercise_catalog"
                  />
                </div>
                <button className="btn" onClick={() => removeExercise(exIdx)} disabled={exercises.length <= 1}>
                  Eliminar
                </button>
              </div>

              <datalist id="exercise_catalog">
                {catalog.map((c) => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>

              <div className="small" style={{ fontWeight: 700, marginTop: 12 }}>
                Sets
              </div>

              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                {ex.sets.map((s, setIdx) => (
                  <div key={setIdx} className="hstack">
                    <div style={{ flex: "1 1 120px" }}>
                      <div className="small">Reps</div>
                      <input
                        className="input"
                        value={s.reps}
                        onChange={(e) => setSetValue(exIdx, setIdx, "reps", e.target.value)}
                        placeholder="8"
                      />
                    </div>
                    <div style={{ flex: "1 1 160px" }}>
                      <div className="small">Carga (kg)</div>
                      <input
                        className="input"
                        value={s.load_kg}
                        onChange={(e) => setSetValue(exIdx, setIdx, "load_kg", e.target.value)}
                        placeholder="60"
                      />
                    </div>
                    <button className="btn" onClick={() => removeSet(exIdx, setIdx)} disabled={ex.sets.length <= 1}>
                      Quitar set
                    </button>
                  </div>
                ))}
              </div>

              <div className="hstack" style={{ marginTop: 10 }}>
                <button className="btn" onClick={() => addSet(exIdx)}>
                  + Añadir set
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="hstack" style={{ marginTop: 12 }}>
          <button className="btn" onClick={addExercise}>
            + Añadir ejercicio
          </button>
        </div>

        <hr />

        <div className="hstack">
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? "Guardando..." : "Guardar sesión"}
          </button>
          <button className="btn" onClick={() => nav("/history")} disabled={busy}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
