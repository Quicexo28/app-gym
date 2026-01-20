import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ingestSessions } from "../api";

const sample = [
  {
    athlete_id: "a1",
    start_time: "2024-01-01T10:00:00Z",
    duration_min: 60,
    rpe: 7.0,
    modality: "strength",
    exercises: [
      { name: "Bench Press", sets: [{ reps: 8, load_kg: 60 }, { reps: 8, load_kg: 60 }, { reps: 8, load_kg: 60 }] },
    ],
    source: "manual",
    meta: { note: "baseline" },
  },
  {
    athlete_id: "a1",
    start_time: "2024-01-03T10:00:00Z",
    duration_min: 60,
    rpe: 7.5,
    modality: "strength",
    exercises: [
      { name: "Bench Press", sets: [{ reps: 8, load_kg: 65 }, { reps: 8, load_kg: 65 }, { reps: 8, load_kg: 65 }] },
    ],
    source: "manual",
    meta: { note: "build" },
  },
];

export default function Ingest() {
  const [jsonText, setJsonText] = useState<string>(JSON.stringify(sample, null, 2));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");

  const parsed = useMemo(() => {
    try {
      return JSON.parse(jsonText);
    } catch {
      return null;
    }
  }, [jsonText]);

  async function submit() {
    setBusy(true);
    setResult("");
    try {
      const payload = JSON.parse(jsonText);
      const r = await ingestSessions(payload);
      setResult(JSON.stringify(r, null, 2));
    } catch (e: any) {
      setResult(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <div className="header">
        <div>
          <h2 style={{ margin: 0 }}>Ingesta de sesiones (batch)</h2>
          <div className="small">Pega un array JSON de sesiones. El sistema valida y reporta issues.</div>
        </div>
        <div className="nav">
          <Link className="btn" to="/">
            Inicio
          </Link>
        </div>
      </div>

      <div className="row">
        <div className="card" style={{ flex: "2 1 520px" }}>
          <div className="small" style={{ fontWeight: 700 }}>
            JSON
          </div>
          <textarea className="input" value={jsonText} onChange={(e) => setJsonText(e.target.value)} />
          <div className="hstack" style={{ marginTop: 10 }}>
            <button className="btn primary" disabled={!parsed || busy} onClick={submit}>
              {busy ? "Enviando..." : "Enviar batch"}
            </button>
            <button className="btn" onClick={() => setJsonText(JSON.stringify(sample, null, 2))}>
              Cargar ejemplo
            </button>
            <div className="small">{parsed ? "JSON válido" : "JSON inválido"}</div>
          </div>
        </div>

        <div className="card" style={{ flex: "1 1 340px" }}>
          <div className="small" style={{ fontWeight: 700 }}>
            Resultado
          </div>
          <pre style={{ marginTop: 8 }}>{result || "—"}</pre>
        </div>
      </div>
    </div>
  );
}
