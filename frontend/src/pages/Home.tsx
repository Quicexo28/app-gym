import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiPing } from "../api";
import { useAthleteAccess } from "../state/athlete";
import { usePreferences } from "../state/preferences";

export default function Home() {
  const { athleteId, athleteIds, canSwitch, ready: athleteReady, setAthleteId } = useAthleteAccess();
  const { prefs, resolvedTheme } = usePreferences();
  const [ping, setPing] = useState<string>("Conectando API...");
  const nav = useNavigate();
  const themeChip = prefs.theme === "system" ? `system (${resolvedTheme})` : prefs.theme;

  useEffect(() => {
    apiPing()
      .then((r) => setPing(r.pong ? "API conectada" : "API sin respuesta valida"))
      .catch((e) => setPing(`API error: ${String(e.message || e)}`));
  }, []);

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Dashboard</h1>
        <p>Registro rapido para gym con escenarios probabilisticos. La decision final siempre es humana.</p>
      </header>

      <section className="surface quickGrid">
        <div>
          <div className="smallLabel">Estado</div>
          <div className="statusText">{ping}</div>
        </div>
        <div>
          <div className="smallLabel">Atleta activo</div>
          {canSwitch ? (
            <div className="hstack compact">
              <select
                className="input athleteInput"
                value={athleteId}
                onChange={(e) => setAthleteId(e.target.value)}
                disabled={!athleteReady || athleteIds.length === 0}
              >
                {athleteIds.length === 0 ? (
                  <option value="">Sin atletas asignados</option>
                ) : (
                  athleteIds.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))
                )}
              </select>
              <button className="btn" onClick={() => nav(`/athlete/${encodeURIComponent(athleteId)}`)} disabled={!athleteId}>
                Panel atleta
              </button>
            </div>
          ) : (
            <div className="chipRow">
              <span className="chip">{athleteId || "-"}</span>
              <button className="btn" onClick={() => nav(`/athlete/${encodeURIComponent(athleteId)}`)} disabled={!athleteId}>
                Panel atleta
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="surface">
        <div className="sectionHead">
          <h3>Acciones rapidas</h3>
          <p>Flujo recomendado: registrar sesion, revisar historial y correr escenarios.</p>
        </div>
        <div className="quickActions">
          <button className="btn primary" onClick={() => nav("/session/new")} disabled={!athleteId}>
            Nueva sesion
          </button>
          <button className="btn" onClick={() => nav("/history")} disabled={!athleteId}>
            Historial
          </button>
          <button className="btn" onClick={() => nav("/routines")}>Rutinas</button>
          <button className="btn" onClick={() => nav("/settings")}>Ajustes</button>
        </div>
        {canSwitch && athleteReady && athleteIds.length === 0 ? (
          <div className="message error" style={{ marginTop: 12 }}>
            No tienes atletas asignados. Pide a un admin que te asigne al menos uno.
          </div>
        ) : null}
      </section>

      <section className="surface">
        <div className="sectionHead">
          <h3>Preferencias activas</h3>
          <p>Estas opciones impactan como se muestran y capturan los datos en la app.</p>
        </div>
        <div className="chipRow">
          <span className="chip">Tema: {themeChip}</span>
          <span className="chip">Esfuerzo: {prefs.effortScale.toUpperCase()}</span>
          <span className="chip">Carga: {prefs.weightUnit}</span>
          <span className="chip">Distancia: {prefs.distanceUnit}</span>
        </div>
      </section>
    </div>
  );
}

