import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { createRun, getSessions, listRuns } from "../api";
import type { RunListItem } from "../api";
import type { SessionRecord } from "../api";

export default function Athlete() {
  const params = useParams();
  const athleteId = decodeURIComponent(params.athleteId || "");
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const [runs, setRuns] = useState<RunListItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  const refreshAll = useCallback(async () => {
    setMsg("");
    const s = await getSessions(athleteId);
    const r = await listRuns(athleteId, 20);
    setSessions(s);
    setRuns(r);
  }, [athleteId]);

  useEffect(() => {
    refreshAll().catch((e) => setMsg(String(e?.message || e)));
  }, [refreshAll]);

  async function runNow() {
    setBusy(true);
    setMsg("");
    try {
      const res = await createRun(athleteId, "volume_load_kg", true);
      setMsg(`Run creado: ${res.run_id}`);
      await refreshAll();
    } catch (e: unknown) {
      setMsg(String((e as { message?: string })?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Atleta: {athleteId}</h1>
        <p>Resumen rapido de sesiones y escenarios para este atleta.</p>
        <div className="quickActions">
          <Link className="btn" to="/history">
            Historial
          </Link>
          <Link className="btn" to="/session/new">
            Nueva sesion
          </Link>
        </div>
      </header>

      {msg ? <section className="message">{msg}</section> : null}

      <section className="surface">
        <div className="chipRow">
          <span className="chip">Sesiones: {sessions ? sessions.length : "..."}</span>
          <span className="chip">Runs: {runs ? runs.length : "..."}</span>
        </div>

        <div className="quickActions" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => refreshAll()} disabled={busy}>
            Refrescar
          </button>
          <button className="btn primary" onClick={runNow} disabled={busy || (sessions?.length || 0) === 0}>
            {busy ? "Corriendo..." : "Correr escenarios"}
          </button>
        </div>
      </section>

      <section className="surface">
        <div className="sectionHead">
          <h3>Runs recientes</h3>
          <p>Abre uno para ver summary y trade-offs.</p>
        </div>

        {runs && runs.length > 0 ? (
          <div className="gridCards">
            {runs.map((r) => (
              <Link key={r.run_id} to={`/run/${encodeURIComponent(r.run_id)}`} className="surfaceButton">
                <strong>{r.summary?.top_scenario || "run"}</strong>
                <span className="small">{new Date(r.generated_at_utc).toLocaleString()}</span>
                <span className="chip">{r.metric_key}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="emptyState">Aun no hay runs.</div>
        )}
      </section>
    </div>
  );
}

