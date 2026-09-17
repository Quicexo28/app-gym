import type { RunSummaryResponse } from "../api";
import { leverLabel, leverValueLabel, scenarioLabel } from "../lib/predictionLabels";

export function ScenarioCard({ s }: { s: RunSummaryResponse["top3_scenarios"][number] }) {
  const prob = typeof s.probability === "number" ? `${Math.round(s.probability * 100)}%` : "-";
  const conf = typeof s.confidence === "number" ? `${Math.round(s.confidence * 100)}%` : "-";
  const leverEntries = Object.entries(s.levers || {});

  return (
    <article className="surfaceButton scenarioCard">
      <div className="hstack" style={{ justifyContent: "space-between" }}>
        <div>
          <span className="chip">{scenarioLabel(s.name)}</span>
          <h3 style={{ margin: "8px 0 0 0" }}>{s.title}</h3>
        </div>
        <div className="metricBlock">
          <span>Probabilidad {prob}</span>
          <span>Confianza {conf}</span>
        </div>
      </div>

      <div className="sectionHead" style={{ marginTop: 10 }}>
        <h4>Palancas</h4>
        <p>Dirección esperada, no prescripción exacta.</p>
      </div>
      {leverEntries.length === 0 ? (
        <div className="small">Sin palancas reportadas.</div>
      ) : (
        <div className="chipRow">
          {leverEntries.map(([key, value]) => (
            <span key={key} className="chip">{`${leverLabel(key)}: ${leverValueLabel(value)}`}</span>
          ))}
        </div>
      )}

      <div className="sectionHead" style={{ marginTop: 10 }}>
        <h4>Contras</h4>
        <p>Costes potenciales a considerar en la decisión.</p>
      </div>
      {(s.tradeoffs || []).length === 0 ? (
        <div className="small">Sin contras reportadas.</div>
      ) : (
        <ul className="compactList">
          {(s.tradeoffs || []).map((t, idx) => (
            <li key={idx}>{t}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

