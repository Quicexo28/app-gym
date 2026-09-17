import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getRunSummary } from "../api";
import type { RunSummaryResponse } from "../api";
import { ScenarioCard } from "../components/ScenarioCard";
import { formatDateTime } from "../lib/locale";
import { latentLabel, metricLabel } from "../lib/predictionLabels";

function toPercent(value: number | null | undefined): string {
  if (typeof value !== "number") return "-";
  return `${Math.round(value * 100)}%`;
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

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Escenarios</h1>
        <p>Incertidumbre explícita. Nunca reemplaza criterio humano.</p>
        <div className="quickActions">
          <Link className="btn" to="/predictions">
            Volver
          </Link>
        </div>
      </header>

      {err ? <section className="message error">{err}</section> : null}

      {!data ? (
        <section className="surface">
          <div className="emptyState">Cargando cálculo...</div>
        </section>
      ) : (
        <>
          <section className="surface">
            <div className="chipRow">
              <span className="chip">Métrica: {metricLabel(data.metric_key)}</span>
              <span className="chip">Confianza última: {toPercent(data.confidence_last)}</span>
              <span className="chip">{formatDateTime(data.generated_at_utc)}</span>
            </div>
          </section>

          <section className="surface">
            <div className="sectionHead">
              <h3>Estado estimado</h3>
              <p>Probabilidades internas del modelo sobre tu estado actual.</p>
            </div>
            {latentEntries.length === 0 ? (
              <div className="emptyState">Sin estimaciones para este cálculo.</div>
            ) : (
              <div className="chipRow">
                {latentEntries.map(([key, value]) => (
                  <span key={key} className="chip">
                    {`${latentLabel(key)}: ${toPercent(typeof value === "number" ? value : null)}`}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="surface">
            <div className="sectionHead">
              <h3>Calidad de los datos</h3>
              <p>Avisos que bajan la confianza del cálculo.</p>
            </div>
            {issueEntries.length === 0 ? (
              <div className="emptyState">Sin avisos: los datos usados están completos.</div>
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
              <p>Prioriza riesgos y contras antes de decidir cambios.</p>
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

