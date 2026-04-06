import type { RunSummaryResponse } from "../api";

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "number") return Number.isFinite(value) ? String(Number(value.toFixed(3))) : "-";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function ScenarioCard({ s }: { s: RunSummaryResponse["top3_scenarios"][number] }) {
  const prob = typeof s.probability === "number" ? `${Math.round(s.probability * 100)}%` : "-";
  const conf = typeof s.confidence === "number" ? `${Math.round(s.confidence * 100)}%` : "-";
  const leverEntries = Object.entries(s.levers || {});

  return (
    <article className="surfaceButton scenarioCard">
      <div className="hstack" style={{ justifyContent: "space-between" }}>
        <div>
          <span className="chip">{s.name}</span>
          <h3 style={{ margin: "8px 0 0 0" }}>{s.title}</h3>
        </div>
        <div className="metricBlock">
          <span>Prob {prob}</span>
          <span>Conf {conf}</span>
        </div>
      </div>

      <div className="sectionHead" style={{ marginTop: 10 }}>
        <h4>Por que aparece este escenario</h4>
        <p>Contexto resumido para facilitar decision.</p>
      </div>
      {(s.explanation || []).length === 0 ? (
        <div className="small">Sin explicacion adicional.</div>
      ) : (
        <ul className="compactList">
          {(s.explanation || []).slice(0, 3).map((item, idx) => (
            <li key={idx}>{item}</li>
          ))}
        </ul>
      )}

      <div className="sectionHead" style={{ marginTop: 10 }}>
        <h4>Palancas</h4>
        <p>Direccion esperada, no prescripcion exacta.</p>
      </div>
      {leverEntries.length === 0 ? (
        <div className="small">Sin palancas reportadas.</div>
      ) : (
        <div className="chipRow">
          {leverEntries.map(([key, value]) => (
            <span key={key} className="chip">{`${key}: ${renderValue(value)}`}</span>
          ))}
        </div>
      )}

      <div className="sectionHead" style={{ marginTop: 10 }}>
        <h4>Trade-offs</h4>
        <p>Costes potenciales a considerar en la decision.</p>
      </div>
      {(s.tradeoffs || []).length === 0 ? (
        <div className="small">Sin trade-offs reportados.</div>
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

