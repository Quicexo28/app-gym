import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiPing } from "../api";
import { useAthleteAccess } from "../state/athlete";
import { usePreferences } from "../state/preferences";

export default function Home() {
  const { athleteId, athleteIds, canSwitch, ready: athleteReady, setAthleteId } = useAthleteAccess();
  const { prefs, resolvedTheme } = usePreferences();
  const [ping, setPing] = useState<string>("Conectando API...");
  const nav = useNavigate();

  const themeLabel = useMemo(
    () => (prefs.theme === "system" ? `Sistema (${resolvedTheme})` : prefs.theme === "dark" ? "Oscuro" : "Claro"),
    [prefs.theme, resolvedTheme],
  );

  useEffect(() => {
    apiPing()
      .then((r) => setPing(r.pong ? "API conectada" : "API sin respuesta valida"))
      .catch((e) => setPing(`API error: ${String(e.message || e)}`));
  }, []);

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Dashboard</h1>
        <p>Vista principal simplificada para iniciar flujo rapido de registro y analisis.</p>
      </header>

      <section className="surface homeHero">
        <div className="stack compactStack">
          <div className="sectionHead">
            <h3>Estado actual</h3>
            <p>Conectividad de API y contexto del atleta activo.</p>
          </div>
          <div className="statusText">{ping}</div>
          <div className="statsGrid">
            <article className="statCard">
              <div className="smallLabel">Atleta activo</div>
              <strong>{athleteId ? "Asignado" : "Sin asignar"}</strong>
            </article>
            <article className="statCard">
              <div className="smallLabel">Escala</div>
              <strong>{prefs.effortScale.toUpperCase()}</strong>
            </article>
            <article className="statCard">
              <div className="smallLabel">Carga</div>
              <strong>{prefs.weightUnit}</strong>
            </article>
          </div>
        </div>

        <div className="stack compactStack">
          <div className="sectionHead">
            <h3>Acciones</h3>
            <p>Atajos principales para operar el sistema sin saturar la vista.</p>
          </div>
          <div className="quickActions">
            <button className="btn primary" onClick={() => nav("/session/new")} disabled={!athleteId}>
              Nueva sesion
            </button>
            <button className="btn" onClick={() => nav("/history")} disabled={!athleteId}>
              Historial
            </button>
            <button className="btn" onClick={() => nav("/routines")}>
              Rutinas
            </button>
            <button className="btn" onClick={() => nav("/profile")}>
              Perfil
            </button>
          </div>
        </div>
      </section>

      <section className="surface splitGrid">
        <div>
          <div className="sectionHead">
            <h3>Selector de atleta</h3>
            <p>Visible solo para coach con atletas asignados.</p>
          </div>
          {canSwitch ? (
            <div className="hstack compact" style={{ marginTop: 10 }}>
              <select
                className="input athleteInput"
                value={athleteId}
                onChange={(e) => setAthleteId(e.target.value)}
                disabled={!athleteReady || athleteIds.length === 0}
              >
                {athleteIds.length === 0 ? (
                  <option value="">Sin atletas asignados</option>
                ) : (
                  athleteIds.map((id, idx) => (
                    <option key={id} value={id}>
                      {`Atleta ${idx + 1}`}
                    </option>
                  ))
                )}
              </select>
              <button className="btn" onClick={() => nav(`/athlete/${encodeURIComponent(athleteId)}`)} disabled={!athleteId}>
                Panel atleta
              </button>
            </div>
          ) : (
            <div className="quickActions" style={{ marginTop: 10 }}>
              <button className="btn" onClick={() => nav(`/athlete/${encodeURIComponent(athleteId)}`)} disabled={!athleteId}>
                Abrir panel de atleta
              </button>
            </div>
          )}

          {canSwitch && athleteReady && athleteIds.length === 0 ? (
            <div className="message error" style={{ marginTop: 12 }}>
              No tienes atletas asignados. Pide a un admin que te asigne al menos uno.
            </div>
          ) : null}
        </div>

        <div>
          <div className="sectionHead">
            <h3>Preferencias activas</h3>
            <p>Resumen limpio de configuración actual.</p>
          </div>
          <ul className="compactList cleanList" style={{ marginTop: 10 }}>
            <li>{`Tema: ${themeLabel}`}</li>
            <li>{`Esfuerzo: ${prefs.effortScale.toUpperCase()}`}</li>
            <li>{`Carga: ${prefs.weightUnit}`}</li>
            <li>{`Distancia: ${prefs.distanceUnit}`}</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
