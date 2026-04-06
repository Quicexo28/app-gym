import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getRunSummary } from "../api";
import type { RunSummaryResponse } from "../api";
import { ScenarioCard } from "../components/ScenarioCard";

function toPercent(value: number | null | undefined): string {
  if (typeof value !== "number") return "-";
  return `${Math.round(value * 100)}%`;
}

function suggestedActionFromScenario(name: string | undefined): string {
  switch ((name || "").toLowerCase()) {
    case "recovery":
      return "Reducir volumen/intensidad por 1-2 sesiones y priorizar recuperacion.";
    case "progression":
      return "Subir carga de forma conservadora manteniendo tecnica y control de fatiga.";
    case "variation":
      return "Introducir variaciones de estimulo (rango reps/ejercicio) sin aumentar ruido excesivo.";
    case "stabilize":
      return "Mantener variables estables para reducir volatilidad y mejorar lectura de respuesta.";
    case "data_review":
      return "Revisar calidad de datos antes de ajustar el plan (registro incompleto/inconsistente).";
    default:
      return "Mantener plan actual y recopilar una sesion adicional para confirmar tendencia.";
  }
}

export default function RunDetail() {
  const params = useParams();
  const runId = decodeURIComponent(params.runId || "");
  const [data, setData] = useState<RunSummaryResponse | null>(null);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    getRunSummary(runId)
      .then((response) => {
        if (cancelled) return;
        setData(response);
        setErr("");
      })
      .catch((e) => {
        if (cancelled) return;
        setData(null);
        setErr(String(e?.message || e));
      });

    return () => {
      cancelled = true;
    };
  }, [runId]);

  const latentEntries = useMemo(() => Object.entries(data?.last_latents || {}), [data]);
  const issueEntries = useMemo(() => Object.entries(data?.issues_by_code || {}), [data]);
  const topScenario = data?.top3_scenarios?.[0];
  const issuesTotal = useMemo(() => issueEntries.reduce((acc, [, count]) => acc + Number(count || 0), 0), [issueEntries]);

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Run summary</h1>
        <p>Escenarios con incertidumbre explicita. Nunca reemplaza criterio humano.</p>
        <div className="quickActions">
          <Link className="btn" to="/history">
            Volver al historial
          </Link>
        </div>
      </header>

      {err ? <section className="message error">{err}</section> : null}

      {!data ? (
        <section className="surface">
          <div className="emptyState">Cargando run...</div>
        </section>
      ) : (
        <>
          <section className="surface">
            <div className="chipRow">
              <span className="chip">Metric: {data.metric_key}</span>
              <span className="chip">Confianza ultima: {toPercent(data.confidence_last)}</span>
              <span className="chip">{new Date(data.generated_at_utc).toLocaleString()}</span>
            </div>
          </section>

          <section className="surface">
            <div className="sectionHead">
              <h3>Accion sugerida hoy</h3>
              <p>Propuesta operativa basada en el escenario top.</p>
            </div>
            <div className="stack compactStack" style={{ marginTop: 10 }}>
              <strong>{suggestedActionFromScenario(topScenario?.name)}</strong>
              <span className="small">{`Escenario top: ${topScenario?.title || "-"}`}</span>
              <span className="small">{`Probabilidad: ${toPercent(topScenario?.probability)} | Confianza: ${toPercent(topScenario?.confidence)}`}</span>
              <span className="small">{`Issues de calidad detectados: ${issuesTotal}`}</span>
            </div>
          </section>

          <section className="surface">
            <div className="sectionHead">
              <h3>Latentes recientes</h3>
              <p>Probabilidades internas del estado del atleta.</p>
            </div>
            {latentEntries.length === 0 ? (
              <div className="emptyState">Sin latentes.</div>
            ) : (
              <div className="chipRow">
                {latentEntries.map(([key, value]) => (
                  <span key={key} className="chip">
                    {`${key}: ${toPercent(typeof value === "number" ? value : null)}`}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="surface">
            <div className="sectionHead">
              <h3>Issues de calidad</h3>
              <p>Conteo por codigo para revisar confianza de datos.</p>
            </div>
            {issueEntries.length === 0 ? (
              <div className="emptyState">Sin issues reportados.</div>
            ) : (
              <div className="chipRow">
                {issueEntries.map(([code, count]) => (
                  <span key={code} className="chip">{`${code}: ${count}`}</span>
                ))}
              </div>
            )}
          </section>

          <section className="surface">
            <div className="sectionHead">
              <h3>Top escenarios</h3>
              <p>Prioriza riesgos y trade-offs antes de decidir cambios.</p>
            </div>
            <div className="gridCards">
              {data.top3_scenarios.map((s) => (
                <ScenarioCard key={s.name} s={s} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

