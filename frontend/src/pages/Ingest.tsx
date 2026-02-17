import { useMemo, useState } from "react";
import { ingestSessions } from "../api";

const sample = [
  {
    athlete_id: "a1",
    start_time: "2024-01-01T10:00:00Z",
    duration_min: 60,
    rpe: 7,
    modality: "strength",
    exercises: [{ name: "Bench Press", sets: [{ reps: 8, load_kg: 60 }] }],
    source: "manual",
    meta: { note: "baseline" },
  },
  {
    athlete_id: "a1",
    start_time: "2024-01-03T10:00:00Z",
    duration_min: 55,
    rpe: 8,
    modality: "strength",
    exercises: [{ name: "Squat", sets: [{ reps: 5, load_kg: 100 }] }],
    source: "manual",
    meta: { note: "build" },
  },
];

function safeParse(raw: string): unknown {
  return JSON.parse(raw);
}

export default function Ingest() {
  const [jsonText, setJsonText] = useState<string>(JSON.stringify(sample, null, 2));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState("");

  const parsed = useMemo(() => {
    try {
      return safeParse(jsonText);
    } catch {
      return null;
    }
  }, [jsonText]);

  const parsedCount = useMemo(() => {
    if (!Array.isArray(parsed)) return 0;
    return parsed.length;
  }, [parsed]);

  async function submit() {
    if (!parsed) {
      setError("JSON invalido. Corrige formato antes de enviar.");
      return;
    }

    setBusy(true);
    setResult("");
    setError("");
    try {
      const r = await ingestSessions(parsed);
      setResult(JSON.stringify(r, null, 2));
    } catch (e: unknown) {
      setError(String((e as { message?: string })?.message || e));
    } finally {
      setBusy(false);
    }
  }

  function loadSample() {
    setJsonText(JSON.stringify(sample, null, 2));
    setError("");
  }

  function onFileSelected(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      setJsonText(text);
      setShowAdvanced(false);
      setError("");
    };
    reader.onerror = () => setError("No se pudo leer el archivo.");
    reader.readAsText(file);
  }

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Importar sesiones</h1>
        <p>Carga por archivo o ejemplo. El editor JSON manual queda en modo avanzado.</p>
      </header>

      <section className="surface">
        {error ? <div className="message error">{error}</div> : null}

        <div className="quickActions">
          <button className="btn" onClick={loadSample}>Cargar ejemplo</button>
          <label className="btn" style={{ display: "inline-flex", alignItems: "center", cursor: "pointer" }}>
            Importar archivo .json
            <input
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(e) => onFileSelected(e.target.files?.[0] || null)}
            />
          </label>
          <button className="btn" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? "Ocultar editor avanzado" : "Mostrar editor avanzado"}
          </button>
        </div>

        <div className="chipRow" style={{ marginTop: 12 }}>
          <span className="chip">JSON: {parsed ? "valido" : "invalido"}</span>
          <span className="chip">Sesiones detectadas: {parsedCount}</span>
        </div>

        {showAdvanced ? (
          <div style={{ marginTop: 12 }}>
            <label className="smallLabel">Editor JSON (avanzado)</label>
            <textarea className="input compactTextarea" value={jsonText} onChange={(e) => setJsonText(e.target.value)} />
          </div>
        ) : null}

        <div className="quickActions" style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={!parsed || busy} onClick={submit}>
            {busy ? "Enviando..." : "Enviar batch"}
          </button>
        </div>
      </section>

      <section className="surface">
        <div className="sectionHead">
          <h3>Resultado</h3>
          <p>Resumen de inserciones, duplicados e issues del backend.</p>
        </div>

        {result ? (
          <details>
            <summary>Ver detalle JSON de respuesta</summary>
            <pre style={{ marginTop: 10 }}>{result}</pre>
          </details>
        ) : (
          <div className="emptyState">Aun no hay respuesta. Ejecuta un envio batch.</div>
        )}
      </section>
    </div>
  );
}

