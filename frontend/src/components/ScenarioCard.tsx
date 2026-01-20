import type { RunSummaryResponse } from "../api";

export function ScenarioCard({ s }: { s: RunSummaryResponse["top3_scenarios"][number] }) {
  const prob = typeof s.probability === "number" ? `${Math.round(s.probability * 100)}%` : "—";
  const conf = typeof s.confidence === "number" ? `${Math.round(s.confidence * 100)}%` : "—";

  return (
    <div className="card" style={{ flex: "1 1 280px" }}>
      <div className="hstack" style={{ justifyContent: "space-between" }}>
        <div>
          <div className="badge">{s.name}</div>
          <h3 style={{ margin: "8px 0 0 0" }}>{s.title}</h3>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="small">prob</div>
          <div style={{ fontWeight: 700 }}>{prob}</div>
          <div className="small" style={{ marginTop: 6 }}>
            conf
          </div>
          <div style={{ fontWeight: 700 }}>{conf}</div>
        </div>
      </div>

      <hr />

      <div className="small" style={{ fontWeight: 700 }}>
        Palancas (direccional, no prescriptivo)
      </div>
      <pre style={{ marginTop: 8 }}>{JSON.stringify(s.levers, null, 2)}</pre>

      <div className="small" style={{ fontWeight: 700, marginTop: 12 }}>
        Trade-offs
      </div>
      <ul className="small" style={{ marginTop: 8 }}>
        {(s.tradeoffs || []).map((t, idx) => (
          <li key={idx}>{t}</li>
        ))}
      </ul>
    </div>
  );
}
