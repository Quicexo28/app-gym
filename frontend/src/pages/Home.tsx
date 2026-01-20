import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiPing } from "../api";

export default function Home() {
  const [athleteId, setAthleteId] = useState("a1");
  const [ping, setPing] = useState<string>("(checking...)");
  const nav = useNavigate();

  useEffect(() => {
    apiPing()
      .then((r) => setPing(r.pong ? "API: ok" : "API: unknown"))
      .catch((e) => setPing(`API error: ${String(e.message || e)}`));
  }, []);

  return (
    <div className="container">
      <div className="header">
        <div>
          <h2 style={{ margin: 0 }}>Coach AI Engineer — MVP</h2>
          <div className="small">
            Este sistema <b>no decide</b>. Sugiere escenarios con incertidumbre explícita.
          </div>
        </div>
        <div className="nav">
          <Link className="btn" to="/ingest">
            Ingesta (JSON)
          </Link>
        </div>
      </div>

      <div className="card">
        <div className="small">{ping}</div>

        <hr />

        <label className="small" style={{ fontWeight: 700 }}>
          Athlete ID
        </label>
        <div className="hstack" style={{ marginTop: 8 }}>
          <input className="input" value={athleteId} onChange={(e) => setAthleteId(e.target.value)} />
          <button className="btn primary" onClick={() => nav(`/athlete/${encodeURIComponent(athleteId)}`)}>
            Abrir panel
          </button>
        </div>

        <div className="small" style={{ marginTop: 12 }}>
          Flujo recomendado: <b>Ingesta</b> → <b>Panel atleta</b> → <b>Run</b> → <b>Summary</b>.
        </div>
      </div>
    </div>
  );
}
