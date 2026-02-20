import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiPing } from "../api";
import { useAthleteAccess } from "../state/athlete";
import { usePreferences } from "../state/preferences";
import { useViewMode } from "../state/viewMode";

export default function Home() {
  const { athleteId, athleteIds, subjects, activeSubject, selfAthleteId, canSwitch, ready: athleteReady, setAthleteId } =
    useAthleteAccess();
  const { prefs, resolvedTheme } = usePreferences();
  const { viewMode } = useViewMode();
  const [ping, setPing] = useState<string>("Conectando API...");
  const nav = useNavigate();

  const isCoachScope = viewMode === "coach" || viewMode === "admin";
  const assignedSubjectsCount = useMemo(
    () => subjects.filter((subject) => subject.kind === "assigned").length,
    [subjects],
  );

  const themeLabel = useMemo(
    () =>
      prefs.theme === "system"
        ? `Sistema (${resolvedTheme})`
        : prefs.theme === "dark"
          ? "Oscuro"
          : "Claro",
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
            <p>Conectividad de API y contexto activo.</p>
          </div>
          <div className="statusText">{ping}</div>
          <div className="statsGrid">
            <article className="statCard">
              <div className="smallLabel">{isCoachScope ? "Sujeto activo" : "Perfil activo"}</div>
              <strong>{activeSubject?.label || "Sin asignar"}</strong>
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
            <p>Atajos principales para operar sin saturar la vista.</p>
          </div>
          <div className="quickActions">
            <button className="btn primary" onClick={() => nav("/session/new")} disabled={!athleteId}>
              Nueva sesion
            </button>
            <button className="btn" onClick={() => nav("/history")} disabled={!athleteId}>
              Historial
            </button>
            <button className="btn" onClick={() => nav("/measurements")} disabled={!athleteId}>
              Medidas
            </button>
            <button className="btn" onClick={() => nav("/routines")}>
              Rutinas
            </button>
            <button className="btn" onClick={() => nav("/planning")}>
              Planificacion
            </button>
            <button className="btn" onClick={() => nav("/profile")}>
              Perfil
            </button>
            {isCoachScope ? (
              <>
                <button
                  className="btn"
                  onClick={() => {
                    if (!selfAthleteId) return;
                    setAthleteId(selfAthleteId);
                    nav("/session/new");
                  }}
                  disabled={!selfAthleteId}
                >
                  Entrenarme
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    if (!selfAthleteId) return;
                    setAthleteId(selfAthleteId);
                    nav("/history");
                  }}
                  disabled={!selfAthleteId}
                >
                  Mi historial
                </button>
                <button className="btn" onClick={() => nav("/measurements")} disabled={!athleteId}>
                  Medidas
                </button>
                <button className="btn" onClick={() => nav("/users")}>
                  Usuarios
                </button>
              </>
            ) : null}
          </div>
        </div>
      </section>

      {isCoachScope ? (
        <section className="surface splitGrid">
          <div>
            <div className="sectionHead">
              <h3>Selector de sujeto</h3>
              <p>Visible solo para coach/admin.</p>
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
                    <option value="">Sin sujetos</option>
                  ) : (
                    subjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.label}
                      </option>
                    ))
                  )}
                </select>
              </div>
            ) : null}

            {canSwitch && athleteReady && assignedSubjectsCount === 0 ? (
              <div className="message error" style={{ marginTop: 12 }}>
                No tienes usuarios asignados. Puedes entrenarte en "Mi perfil" o pedir asignaciones a un admin.
              </div>
            ) : null}
          </div>

          <div>
            <div className="sectionHead">
              <h3>Preferencias activas</h3>
              <p>Resumen limpio de configuracion actual.</p>
            </div>
            <ul className="compactList cleanList" style={{ marginTop: 10 }}>
              <li>{`Tema: ${themeLabel}`}</li>
              <li>{`Esfuerzo: ${prefs.effortScale.toUpperCase()}`}</li>
              <li>{`Carga: ${prefs.weightUnit}`}</li>
              <li>{`Distancia: ${prefs.distanceUnit}`}</li>
            </ul>
          </div>
        </section>
      ) : (
        <section className="surface">
          <div className="sectionHead">
            <h3>Preferencias activas</h3>
            <p>Resumen limpio de configuracion actual.</p>
          </div>
          <ul className="compactList cleanList" style={{ marginTop: 10 }}>
            <li>{`Tema: ${themeLabel}`}</li>
            <li>{`Esfuerzo: ${prefs.effortScale.toUpperCase()}`}</li>
            <li>{`Carga: ${prefs.weightUnit}`}</li>
            <li>{`Distancia: ${prefs.distanceUnit}`}</li>
          </ul>
        </section>
      )}
    </div>
  );
}
