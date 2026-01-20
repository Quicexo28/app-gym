import { useMemo, useState } from "react";
import { loadRoutines, saveRoutines, uid } from "../lib/storage";
import type { RoutineTemplate } from "../lib/storage";

export default function Routines() {
  const [items, setItems] = useState<RoutineTemplate[]>(() => loadRoutines());
  const [name, setName] = useState("");
  const [exerciseLines, setExerciseLines] = useState("Bench Press\nRow\nSquat");

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  function add() {
    const n = name.trim();
    if (!n) return;

    const exercises = exerciseLines
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);

    if (exercises.length === 0) {
      alert("Agrega al menos 1 ejercicio (uno por línea).");
      return;
    }

    const next: RoutineTemplate[] = [
      ...items,
      { id: uid("rt"), name: n, exercises, created_at_utc: new Date().toISOString() },
    ];
    setItems(next);
    saveRoutines(next);
    setName("");
  }

  function remove(id: string) {
    const next = items.filter((x) => x.id !== id);
    setItems(next);
    saveRoutines(next);
  }

  return (
    <div className="container">
      <div className="card">
        <h2 style={{ margin: 0 }}>Rutinas (plantillas)</h2>
        <div className="small">
          Plantillas para agilizar el registro (lista de ejercicios). No son prescripción automática.
        </div>

        <hr />

        <div className="row">
          <div className="card" style={{ flex: "1 1 420px" }}>
            <div className="small" style={{ fontWeight: 700 }}>
              Crear plantilla
            </div>

            <div style={{ marginTop: 10 }}>
              <div className="small">Nombre</div>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Push A / Pull / Pierna..." />
            </div>

            <div style={{ marginTop: 10 }}>
              <div className="small">Ejercicios (1 por línea)</div>
              <textarea className="input" value={exerciseLines} onChange={(e) => setExerciseLines(e.target.value)} />
            </div>

            <div className="hstack" style={{ marginTop: 10 }}>
              <button className="btn primary" onClick={add}>
                Guardar plantilla
              </button>
              <div className="small">Total: {items.length}</div>
            </div>
          </div>

          <div className="card" style={{ flex: "2 1 520px" }}>
            <div className="small" style={{ fontWeight: 700 }}>
              Plantillas
            </div>

            {sorted.length === 0 ? (
              <div className="small" style={{ marginTop: 10 }}>
                Sin plantillas todavía.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                {sorted.map((r) => (
                  <div key={r.id} className="card" style={{ padding: 12 }}>
                    <div className="hstack" style={{ justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontWeight: 800 }}>{r.name}</div>
                        <div className="small">{r.exercises.join(", ")}</div>
                      </div>
                      <button className="btn" onClick={() => remove(r.id)}>
                        Eliminar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <hr />

            <div className="small">
              Estas plantillas se aplican en “Nueva sesión” para prellenar nombres (sin sets/cargas).
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
