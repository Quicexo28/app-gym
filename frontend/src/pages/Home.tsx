import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiPing, getSessions, listRuns } from "../api";
import { useAthleteAccess } from "../state/athlete";
import { usePreferences } from "../state/preferences";
import { useViewMode } from "../state/viewMode";

export default function Home() {
  const { athleteId, athleteIds, subjects, activeSubject, selfAthleteId, canSwitch, ready: athleteReady, setAthleteId } =
    useAthleteAccess();
  const { prefs, resolvedTheme } = usePreferences();
  const { viewMode } = useViewMode();
  const [ping, setPing] = useState<string>("Conectando API...");
  const [todayMs] = useState<number>(() => Date.now());
  const [sessionCount, setSessionCount] = useState<number>(0);
  const [runCount, setRunCount] = useState<number>(0);
  const [lastSessionAt, setLastSessionAt] = useState<string | null>(null);
  const [opsLoading, setOpsLoading] = useState(false);
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

  const daysSinceLastSession = useMemo(() => {
    if (!lastSessionAt) return null;
    const parsed = Date.parse(lastSessionAt);
    if (!Number.isFinite(parsed)) return null;
    return Math.floor((todayMs - parsed) / (24 * 60 * 60 * 1000));
  }, [lastSessionAt, todayMs]);

  const homeAlerts = useMemo(() => {
    const alerts: Array<{ id: string; severity: "high" | "medium" | "low"; message: string; ctaLabel?: string; ctaPath?: string }> = [];
    if (!athleteId) {
      alerts.push({
        id: "no_subject",
        severity: "high",
        message: "Selecciona un sujeto para habilitar registro y analisis.",
      });
      return alerts;
    }
    if (sessionCount === 0) {
      alerts.push({
        id: "no_sessions",
        severity: "high",
        message: "Aun no hay sesiones registradas. Crea la primera sesion para activar analisis.",
        ctaLabel: "Crear sesion",
        ctaPath: "/session/new",
      });
    }
    if (sessionCount > 0 && runCount === 0) {
      alerts.push({
        id: "no_runs",
        severity: "medium",
        message: "Tienes sesiones sin escenarios. Corre un run para obtener recomendaciones.",
        ctaLabel: "Ver historial",
        ctaPath: "/history",
      });
    }
    if (typeof daysSinceLastSession === "number" && daysSinceLastSession >= 4) {
      alerts.push({
        id: "inactive_days",
        severity: daysSinceLastSession >= 7 ? "high" : "medium",
        message: `Han pasado ${daysSinceLastSession} dias desde la ultima sesion.`,
        ctaLabel: "Registrar sesion",
        ctaPath: "/session/new",
      });
    }
    return alerts;
  }, [athleteId, daysSinceLastSession, runCount, sessionCount]);

  const funnelStages = useMemo(() => {
    const hasSubject = Boolean(athleteId);
    const hasSessions = sessionCount > 0;
    const hasRuns = runCount > 0;
    const qualityReady = hasRuns && homeAlerts.filter((item) => item.severity === "high").length === 0;

    return [
      { id: "subject", label: "Sujeto activo", ok: hasSubject },
      { id: "sessions", label: "Sesiones registradas", ok: hasSessions },
      { id: "runs", label: "Escenarios ejecutados", ok: hasRuns },
      { id: "quality", label: "Operacion estable", ok: qualityReady },
    ];
  }, [athleteId, homeAlerts, runCount, sessionCount]);

  const funnelCompletionPct = useMemo(() => {
    if (funnelStages.length === 0) return 0;
    const ok = funnelStages.filter((stage) => stage.ok).length;
    return Math.round((ok / funnelStages.length) * 100);
  }, [funnelStages]);

  useEffect(() => {
    apiPing()
      .then((r) => setPing(r.pong ? "API conectada" : "API sin respuesta valida"))
      .catch((e) => setPing(`API error: ${String(e.message || e)}`));
  }, []);

  useEffect(() => {
    if (!athleteId) {
      return;
    }

    let cancelled = false;
    const loadingTimerId = window.setTimeout(() => {
      if (!cancelled) setOpsLoading(true);
    }, 0);

    Promise.allSettled([getSessions(athleteId), listRuns(athleteId, 20)])
      .then((results) => {
        if (cancelled) return;
        const sessions = results[0].status === "fulfilled" ? results[0].value : [];
        const runs = results[1].status === "fulfilled" ? results[1].value : [];

        const orderedSessions = [...sessions].sort((a, b) => String(b.start_time).localeCompare(String(a.start_time)));
        setSessionCount(orderedSessions.length);
        setRunCount(runs.length);
        setLastSessionAt(orderedSessions[0]?.start_time ? String(orderedSessions[0].start_time) : null);
      })
      .finally(() => {
        if (cancelled) return;
        setOpsLoading(false);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(loadingTimerId);
    };
  }, [athleteId]);

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
              <div className="smallLabel">Sesiones</div>
              <strong>{!athleteId ? "-" : opsLoading ? "..." : sessionCount}</strong>
            </article>
            <article className="statCard">
              <div className="smallLabel">Runs</div>
              <strong>{!athleteId ? "-" : opsLoading ? "..." : runCount}</strong>
            </article>
            <article className="statCard">
              <div className="smallLabel">Ultima sesion</div>
              <strong>{!athleteId ? "-" : lastSessionAt ? new Date(lastSessionAt).toLocaleDateString() : "-"}</strong>
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

      <section className="surface">
        <div className="sectionHead">
          <h3>Embudo de uso</h3>
          <p>{`Progreso operacional: ${funnelCompletionPct}%`}</p>
        </div>
        <div className="statsGrid" style={{ marginTop: 10 }}>
          {funnelStages.map((stage) => (
            <article key={stage.id} className="statCard">
              <div className="smallLabel">{stage.label}</div>
              <strong>{stage.ok ? "OK" : "Pendiente"}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="surface">
        <div className="sectionHead">
          <h3>Alertas operativas</h3>
          <p>Prioriza estas acciones para mantener continuidad y calidad de señal.</p>
        </div>
        {homeAlerts.length === 0 ? (
          <div className="small" style={{ marginTop: 10 }}>Sin alertas criticas por ahora.</div>
        ) : (
          <div className="stack compactStack" style={{ marginTop: 10 }}>
            {homeAlerts.map((alert) => (
              <article key={alert.id} className="listItem">
                <div className="listMain">
                  <strong>{alert.message}</strong>
                  <span className="small">{`Prioridad: ${alert.severity}`}</span>
                </div>
                {alert.ctaLabel && alert.ctaPath ? (
                  <div className="listMeta">
                    <button className="btn" onClick={() => nav(alert.ctaPath!)}>
                      {alert.ctaLabel}
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
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
