import { useMemo, useState } from "react";
import { loadExerciseCatalog, saveExerciseCatalog, uid } from "../lib/storage";
import type { ExerciseCatalogItem } from "../lib/storage";

export default function Exercises() {
  const [items, setItems] = useState<ExerciseCatalogItem[]>(() => loadExerciseCatalog());
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  function add() {
    const n = name.trim();
    if (!n) return;
    const exists = items.some((x) => x.name.toLowerCase() === n.toLowerCase());
    if (exists) {
      alert("Ese ejercicio ya existe (mismo nombre).");
      return;
    }
    const next = [
      ...items,
      {
        id: uid("ex"),
        name: n,
        group: group.trim() || undefined,
        created_at_utc: new Date().toISOString(),
      },
    ];
    setItems(next);
    saveExerciseCatalog(next);
    setName("");
    setGroup("");
  }

  function remove(id: string) {
    const next = items.filter((x) => x.id !== id);
    setItems(next);
    saveExerciseCatalog(next);
  }

  return (
    <div className="container">
      <div className="card">
        <h2 style={{ margin: 0 }}>Ejercicios</h2>
        <div className="small">
          Catálogo personal para nombres consistentes (mejora historial y análisis). No prescribe nada.
        </div>

        <hr />

        <div className="row">
          <div className="card" style={{ flex: "1 1 420px" }}>
            <div className="small" style={{ fontWeight: 700 }}>
              Añadir ejercicio
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <div>
                <div className="small">Nombre</div>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Bench Press" />
              </div>
              <div>
                <div className="small">Grupo (opcional)</div>
                <input
                  className="input"
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                  placeholder="Pecho / Espalda / Pierna..."
                />
              </div>
            </div>
            <div className="hstack" style={{ marginTop: 10 }}>
              <button className="btn primary" onClick={add}>
                Añadir
              </button>
              <div className="small">Total: {items.length}</div>
            </div>
          </div>

          <div className="card" style={{ flex: "2 1 520px" }}>
            <div className="small" style={{ fontWeight: 700 }}>
              Lista
            </div>
            {sorted.length === 0 ? (
              <div className="small" style={{ marginTop: 10 }}>
                Vacío. Puedes escribir nombres manualmente en sesiones, pero el catálogo ayuda a no duplicar variantes.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                {sorted.map((x) => (
                  <div key={x.id} className="card" style={{ padding: 12 }}>
                    <div className="hstack" style={{ justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontWeight: 800 }}>{x.name}</div>
                        <div className="small">{x.group || "—"}</div>
                      </div>
                      <button className="btn" onClick={() => remove(x.id)}>
                        Eliminar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <hr />

        <div className="small">
          Sugerencia: evita “Bench”, “bench press”, “Bench Press” como 3 distintos. Unifica nombres aquí.
        </div>
      </div>
    </div>
  );
}
