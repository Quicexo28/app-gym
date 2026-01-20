import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { createRun, getSessions, listRuns } from "../api";
import type { RunListItem } from "../api";

export default function Athlete() {
  const params = useParams();
  const athleteId = decodeURIComponent(params.athleteId || "");
  const [sessions, setSessions] = useState<any[] | null>(null);
  const [runs, setRuns] = useState<RunListItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  async function refreshAll() {
    setMsg("");
    const s = await getSessions(athleteId);
    const r = await listRuns(athleteId, 20);
    setSessions(s);
    setRuns(r);
  }

  useEffect(() => {
    refreshAll().catch((e) => setMsg(String(e?.message || e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteId]);

  async function runNow() {
    setBusy(true);
    setMsg("");
    try {
      const res = await createRun(athleteId, "volume_load_kg", true);
      setMsg(`Run creado: ${res.run_id}`);
      await refreshAll();
    } catch (e: any) {
      setMsg(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <div className="header">
        <div>
          <h2 style={{ margin: 0 }}>Atleta: {athleteId}</h2>
          <div className="small">
            La app sugiere escenarios (probabilísticos). La decisión final es humana. No hay prescripción automática.
          </div>
        </div>
        <div className="nav">
          <Link className="btn" to="/">
            Inicio
          </Link>
          <Link className="btn" to="/ingest">
            Ingesta
          </Link>
        </div>
      </div>

      {msg ? (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="small">{msg}</div>
        </div>
      ) : null}

      <div className="row">
        <div className="card" style={{ flex: "1 1 360px" }}>
          <div className="hstack" style={{ justifyContent: "space-between" }}>
            <div>
              <div className="small" style={{ fontWeight: 700 }}>
                Sesiones
              </div>
              <div className="small">{sessions ? `${sessions.length} sesiones` : "cargando..."}</div>
            </div>
            <button className="btn" onClick={() => refreshAll()} disabled={busy}>
              Refrescar
            </button>
          </div>

          <hr />

          <button className="btn primary" onClick={runNow} disabled={busy || (sessions?.length || 0) === 0}>
            {busy ? "Corriendo..." : "Correr Run (escenarios)"}
          </button>

          <div className="small" style={{ marginTop: 10 }}>
            Métrica por defecto: <span className="badge">volume_load_kg</span> (normalizada).
          </div>
        </div>

        <div className="card" style={{ flex: "2 1 520px" }}>
          <div className="small" style={{ fontWeight: 700 }}>
            Runs recientes
          </div>
          <div className="small">{runs ? `${runs.length} runs` : "cargando..."}</div>

          <hr />

          {runs && runs.length > 0 ? (
            <div style={{ display: "grid", gap: 10 }}>
              {runs.map((r) => (
                <Link key={r.run_id} to={`/run/${encodeURIComponent(r.run_id)}`} className="card" style={{ padding: 12 }}>
                  <div className="hstack" style={{ justifyContent: "space-between" }}>
                    <div>
                      <div className="badge">{r.metric_key}</div>
                      <div style={{ fontWeight: 700, marginTop: 6 }}>{r.summary?.top_scenario || "run"}</div>
                      <div className="small">{new Date(r.generated_at_utc).toLocaleString()}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div className="small">prob</div>
                      <div style={{ fontWeight: 700 }}>
                        {typeof r.summary?.top_probability === "number"
                          ? `${Math.round(r.summary.top_probability * 100)}%`
                          : "—"}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="small">Aún no hay runs. Crea uno con “Correr Run”.</div>
          )}
        </div>
      </div>
    </div>
  );
}
