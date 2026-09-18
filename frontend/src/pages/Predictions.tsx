import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { createRun, listRuns } from "../api";
import type { RunListItem } from "../api";
import { useAthleteId } from "../state/athlete";
import { APP_LOCALE } from "../lib/locale";

export default function Predictions() {
  const [athleteId] = useAthleteId();
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nav = useNavigate();

  useEffect(() => {
    if (!athleteId) return;

    let cancelled = false;
    listRuns(athleteId, 20)
      .then((rows) => {
        if (!cancelled) setRuns(rows);
      })
      .catch(() => {
        if (!cancelled) setRuns([]);
      });

    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  async function runNow() {
    if (!athleteId) return;

    setBusy(true);
    setError("");
    try {
      const res = await createRun(athleteId, "volume_load_kg", true);
      nav(`/predictions/run/${encodeURIComponent(res.run_id)}`);
    } catch (e: unknown) {
      setError(String((e as { message?: string })?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Predicción</h1>
        <p>Qué dice tu historial: próximas series, marcas y avisos con su regla.</p>
      </header>

      {error ? <section className="message error">{error}</section> : null}

      <section className="surface">
        <div className="quickActions">
          <button className="btn primary" onClick={runNow} disabled={busy || !athleteId}>
            {busy ? "Calculando..." : "Analizar mi historial"}
          </button>
        </div>
      </section>

      <section className="surface">
        <div className="sectionHead">
          <h3>Análisis recientes</h3>
        </div>

        {runs.length === 0 ? (
          <div className="emptyState">Todavía no has analizado tu historial.</div>
        ) : (
          <div className="stack compactStack" style={{ marginTop: 10 }}>
            {runs.map((r) => (
              <button
                key={r.run_id}
                className="listItem listItemAction"
                onClick={() => nav(`/predictions/run/${encodeURIComponent(r.run_id)}`)}
              >
                <div className="listMain">
                  <strong>{r.summary?.top_scenario || "Escenario"}</strong>
                  <span className="small">{new Date(r.generated_at_utc).toLocaleString(APP_LOCALE)}</span>
                </div>
                <div className="listMeta">
                  <span className="small">
                    {typeof r.summary?.top_probability === "number"
                      ? `${Math.round(r.summary.top_probability * 100)}% probabilidad`
                      : "-"}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
