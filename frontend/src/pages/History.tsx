import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createRun, getSessions, listRuns } from "../api";
import type { RunListItem } from "../api";
import type { SessionRecord } from "../api";
import { formatWeight } from "../lib/units";
import { useAthleteId } from "../state/athlete";
import { usePreferences } from "../state/preferences";

function volumeLoadKg(session: SessionRecord): number {
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
}

export default function History() {
  const [athleteId] = useAthleteId();
  const { prefs } = usePreferences();
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
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
    } catch (e: unknown) {
      alert(String((e as { message?: string })?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Historial</h1>
        <p>Sesiones y escenarios del atleta activo. Vista compacta para revisar rapido.</p>
      </header>

      <section className="surface">
        <div className="chipRow">
          <span className="chip">Athlete: {athleteId}</span>
          <span className="chip">Carga visible: {prefs.weightUnit}</span>
          <span className="chip">Sesiones: {sessionsSorted.length}</span>
          <span className="chip">Runs: {runs.length}</span>
        </div>
        <div className="quickActions" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={() => nav("/session/new")}>Nueva sesion</button>
          <button className="btn" onClick={runNow} disabled={busy}>
            {busy ? "Corriendo..." : "Correr escenarios"}
          </button>
        </div>
      </section>

      <section className="surface">
        <div className="sectionHead">
          <h3>Sesiones recientes</h3>
          <p>Hasta 30 sesiones ordenadas por fecha.</p>
        </div>

        {sessionsSorted.length === 0 ? (
          <div className="emptyState">Sin sesiones todavia.</div>
        ) : (
          <div className="stack">
            {sessionsSorted.slice(0, 30).map((s, idx) => {
              const volKg = volumeLoadKg(s);
              const exercises = (s.exercises || []).map((e) => e.name).filter(Boolean).join(" - ");

              return (
                <article key={idx} className="listItem">
                  <div className="listMain">
                    <strong>{s.start_time ? new Date(s.start_time).toLocaleString() : "Sin fecha"}</strong>
                    <span className="small">Dur: {s.duration_min ?? "-"} min</span>
                    <span className="small">
                      {prefs.effortScale.toUpperCase()}: {s.rpe ?? "-"}
                    </span>
                  </div>
                  <div className="listMeta">
                    <span className="chip">Vol: {formatWeight(volKg, prefs.weightUnit)}</span>
                    <span className="small">{exercises || "Sin ejercicios"}</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="surface">
        <div className="sectionHead">
          <h3>Runs recientes</h3>
          <p>Abre el detalle para ver trade-offs y confianza.</p>
        </div>

        {runs.length === 0 ? (
          <div className="emptyState">Sin runs todavia.</div>
        ) : (
          <div className="gridCards">
            {runs.slice(0, 12).map((r) => (
              <button
                key={r.run_id}
                className="surfaceButton"
                onClick={() => nav(`/run/${encodeURIComponent(r.run_id)}`)}
              >
                <div className="chipRow">
                  <span className="chip">{r.metric_key}</span>
                  <span className="chip">{new Date(r.generated_at_utc).toLocaleDateString()}</span>
                </div>
                <strong>{r.summary?.top_scenario || "run"}</strong>
                <span className="small">
                  Prob top: {typeof r.summary?.top_probability === "number" ? `${Math.round(r.summary.top_probability * 100)}%` : "-"}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

