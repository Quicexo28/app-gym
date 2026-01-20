import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getRunSummary } from "../api";
import type { RunSummaryResponse } from "../api";
import { ScenarioCard } from "../components/ScenarioCard";

export default function RunDetail() {
  const params = useParams();
  const runId = decodeURIComponent(params.runId || "");
  const [data, setData] = useState<RunSummaryResponse | null>(null);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    setErr("");
    getRunSummary(runId)
      .then(setData)
      .catch((e) => setErr(String(e?.message || e)));
  }, [runId]);

  return (
    <div className="container">
      <div className="header">
        <div>
          <h2 style={{ margin: 0 }}>Run summary</h2>
          <div className="small">Escenarios + incertidumbre (no prescripción).</div>
        </div>
        <div className="nav">
          <Link className="btn" to="/">
            Inicio
          </Link>
        </div>
      </div>

      {err ? (
        <div className="card">
          <div className="small">{err}</div>
        </div>
      ) : null}

      {!data ? (
        <div className="card">
          <div className="small">Cargando...</div>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="hstack" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="badge">{data.metric_key}</div>
                <div style={{ fontWeight: 800, marginTop: 8 }}>Athlete: {data.athlete_id}</div>
                <div className="small">{new Date(data.generated_at_utc).toLocaleString()}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="small">Confianza (último punto)</div>
                <div style={{ fontWeight: 800 }}>
                  {typeof data.confidence_last === "number" ? `${Math.round(data.confidence_last * 100)}%` : "—"}
                </div>
              </div>
            </div>

            <hr />

            <div className="small" style={{ fontWeight: 700 }}>
              Últimos latentes (probabilidades)
            </div>
            <pre style={{ marginTop: 8 }}>{JSON.stringify(data.last_latents, null, 2)}</pre>

            <div className="small" style={{ fontWeight: 700, marginTop: 12 }}>
              Issues por código (calidad de datos / incertidumbre)
            </div>
            <pre style={{ marginTop: 8 }}>{JSON.stringify(data.issues_by_code, null, 2)}</pre>
          </div>

          <div style={{ marginTop: 12 }}>
            <h3 style={{ margin: "12px 0" }}>Top 3 escenarios</h3>
            <div className="row">
              {data.top3_scenarios.map((s) => (
                <ScenarioCard key={s.name} s={s} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
