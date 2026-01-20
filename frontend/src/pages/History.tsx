import { useEffect, useMemo, useState } from "react";
import { createRun, getSessions, listRuns } from "../api";
import type { RunListItem } from "../api";
import { useAthleteId } from "../state/athlete";
import { useNavigate } from "react-router-dom";

function volumeLoadKg(session: any): number {
  try {
    const ex = session.exercises || [];
    let total = 0;
    for (const e of ex) {
      for (const s of e.sets || []) {
        const reps = Number(s.reps);
        const load = Number(s.load_kg);
        if (Number.isFinite(reps) && Number.isFinite(load)) total += reps * load;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

export default function History() {
  const [athleteId] = useAthleteId();
  const [sessions, setSessions] = useState<any[]>([]);
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    getSessions(athleteId)
      .then(setSessions)
      .catch(() => setSessions([]));
    listRuns(athleteId, 20)
      .then(setRuns)
      .catch(() => setRuns([]));
  }, [athleteId]);

  const sessionsSorted = useMemo(() => {
    return [...sessions].sort((a, b) => String(b.start_time).localeCompare(String(a.start_time)));
  }, [sessions]);

  async function runNow() {
    setBusy(true);
    try {
      const res = await createRun(athleteId, "volume_load_kg", true);
      nav(`/run/${encodeURIComponent(res.run_id)}`);
    } catch (e: any) {
      alert(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <div className="card">
        <div className="badge">Athlete: {athleteId}</div>
        <h2 style={{ margin: "10px 0 0 0" }}>Historial</h2>
        <div className="small">Sesiones registradas + runs (escenarios) generados.</div>

        <hr />

        <div className="hstack">
          <button className="btn primary" onClick={() => nav("/session/new")}>
            Registrar sesión
          </button>
          <button className="btn" onClick={runNow} disabled={busy}>
            {busy ? "Corriendo..." : "Correr escenarios"}
          </button>
        </div>

        <hr />

        <div className="row">
          <div className="card" style={{ flex: "2 1 560px" }}>
            <div className="small" style={{ fontWeight: 700 }}>
              Sesiones ({sessionsSorted.length})
            </div>

            {sessionsSorted.length === 0 ? (
              <div className="small" style={{ marginTop: 10 }}>
                Sin sesiones todavía.
              </div>
            ) : (
              <div style={{ overflowX: "auto", marginTop: 10 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: "8px" }}>Fecha</th>
                      <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: "8px" }}>Dur</th>
                      <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: "8px" }}>RPE</th>
                      <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: "8px" }}>Vol (kg)</th>
                      <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: "8px" }}>Ejercicios</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessionsSorted.slice(0, 30).map((s, idx) => (
                      <tr key={idx}>
                        <td style={{ padding: "8px", borderBottom: "1px solid #f3f3f3" }}>
                          {s.start_time ? new Date(s.start_time).toLocaleString() : "—"}
                        </td>
                        <td style={{ padding: "8px", borderBottom: "1px solid #f3f3f3" }}>{s.duration_min ?? "—"}</td>
                        <td style={{ padding: "8px", borderBottom: "1px solid #f3f3f3" }}>{s.rpe ?? "—"}</td>
                        <td style={{ padding: "8px", borderBottom: "1px solid #f3f3f3" }}>{Math.round(volumeLoadKg(s))}</td>
                        <td style={{ padding: "8px", borderBottom: "1px solid #f3f3f3" }}>
                          {(s.exercises || []).map((e: any) => e.name).filter(Boolean).join(", ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="small" style={{ marginTop: 8 }}>
                  Mostrando hasta 30 sesiones más recientes.
                </div>
              </div>
            )}
          </div>

          <div className="card" style={{ flex: "1 1 360px" }}>
            <div className="small" style={{ fontWeight: 700 }}>
              Runs ({runs.length})
            </div>

            {runs.length === 0 ? (
              <div className="small" style={{ marginTop: 10 }}>
                Sin runs todavía.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                {runs.slice(0, 12).map((r) => (
                  <button
                    key={r.run_id}
                    className="btn"
                    onClick={() => nav(`/run/${encodeURIComponent(r.run_id)}`)}
                    style={{ textAlign: "left" }}
                  >
                    <div className="badge">{r.metric_key}</div>
                    <div style={{ fontWeight: 800, marginTop: 6 }}>{r.summary?.top_scenario || "run"}</div>
                    <div className="small">{new Date(r.generated_at_utc).toLocaleString()}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
