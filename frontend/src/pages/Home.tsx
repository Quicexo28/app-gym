import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { getSessions, listRuns } from "../api";
import type { SessionRecord } from "../api";
import { useAthleteAccess } from "../state/athlete";
import { usePreferences } from "../state/preferences";
import { useViewMode } from "../state/viewMode";

export default function Home() {
  const { athleteId, athleteIds, subjects, activeSubject, selfAthleteId, canSwitch, ready: athleteReady, setAthleteId } =
    useAthleteAccess();
  const { prefs, resolvedTheme } = usePreferences();
  const { viewMode } = useViewMode();
  const [todayMs] = useState<number>(() => Date.now());
  const [sessionCount, setSessionCount] = useState<number>(0);
  const [runCount, setRunCount] = useState<number>(0);
  const [lastSessionAt, setLastSessionAt] = useState<string | null>(null);
  const [sessionsData, setSessionsData] = useState<SessionRecord[]>([]);
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

  const streakDays = useMemo(() => {
    if (!athleteId || sessionsData.length === 0) return 0;
    const dayKeys = Array.from(
      new Set(
        sessionsData
          .map((session) => String(session.start_time || "").slice(0, 10))
          .filter((value) => value.length === 10),
      ),
    ).sort((a, b) => b.localeCompare(a));

    if (dayKeys.length === 0) return 0;

    const todayKey = new Date(todayMs).toISOString().slice(0, 10);
    const yesterdayKey = new Date(todayMs - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (dayKeys[0] !== todayKey && dayKeys[0] !== yesterdayKey) return 0;

    let streak = 1;
    for (let i = 1; i < dayKeys.length; i += 1) {
      const prev = new Date(`${dayKeys[i - 1]}T00:00:00Z`).getTime();
      const current = new Date(`${dayKeys[i]}T00:00:00Z`).getTime();
      if (prev - current === 24 * 60 * 60 * 1000) {
        streak += 1;
      } else {
        break;
      }
    }
    return streak;
  }, [athleteId, sessionsData, todayMs]);

  const todaySessionSuggestion = useMemo(() => {
    if (!athleteId) return "Selecciona un sujeto para definir la sesión de hoy.";
    if (sessionCount === 0) return "Sesión inicial corta: técnica + registro base.";
    if (typeof daysSinceLastSession !== "number") return "Sesión moderada de continuidad.";
    if (daysSinceLastSession >= 4) return "Retoma con sesión ligera y foco en técnica.";
    if (daysSinceLastSession >= 2) return "Sesión principal del bloque con volumen controlado.";
    return "Día de ajuste: descarga activa o movilidad + core.";
  }, [athleteId, daysSinceLastSession, sessionCount]);

  const smartEmptyState = useMemo(() => {
    if (!athleteId) {
      return {
        title: "Elige un sujeto para comenzar",
        message: "Cuando selecciones un sujeto te mostraremos el plan del día y el progreso real.",
        ctaLabel: isCoachScope ? "Seleccionar sujeto" : "Ir a perfil",
        ctaPath: isCoachScope ? "/home" : "/profile",
      };
    }
    if (sessionCount === 0) {
      return {
        title: "Vamos a crear tu primera sesión",
        message: "Empieza con una sesión guiada. El dashboard se volverá inteligente apenas registres datos.",
        ctaLabel: "Crear sesión",
        ctaPath: "/session/new",
      };
    }
    if (runCount === 0) {
      return {
        title: "Ya tienes sesiones, falta análisis",
        message: "Corre un escenario para activar recomendaciones y seguimiento de calidad.",
        ctaLabel: "Ir a historial",
        ctaPath: "/history",
      };
    }
    return null;
  }, [athleteId, isCoachScope, runCount, sessionCount]);

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

  const momentumLabel = useMemo(() => {
    if (sessionCount === 0) return "Sin datos aún";
    if (typeof daysSinceLastSession === "number" && daysSinceLastSession >= 7) return "Necesita impulso";
    if (runCount === 0) return "Falta análisis";
    if (streakDays >= 4) return "Excelente ritmo";
    if (streakDays >= 2) return "Buen ritmo";
    return "Ritmo estable";
  }, [daysSinceLastSession, runCount, sessionCount, streakDays]);
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
        setSessionsData(orderedSessions);
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

      <section className="surface dashboardPulseCard">
        <div className="sectionHead">
          <h3>Estado de hoy</h3>
          <p>{momentumLabel}</p>
        </div>
        <div className="dashboardPulseRow">
          <div className="dashboardPulseMeta">{`🔥 racha: ${streakDays} día${streakDays === 1 ? "" : "s"}`}</div>
          <div className="dashboardPulseMeta">{`Embudo completado: ${funnelCompletionPct}%`}</div>
        </div>
      </section>

      {smartEmptyState ? (
        <section className="surface">
          <div className="sectionHead">
            <h3>{smartEmptyState.title}</h3>
            <p>{smartEmptyState.message}</p>
          </div>
          <div className="quickActions" style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={() => nav(smartEmptyState.ctaPath)}>
              {smartEmptyState.ctaLabel}
            </button>
          </div>
        </section>
      ) : null}

      <section className="surface homeHero">
        <div className="stack compactStack">
          <div className="sectionHead">
            <h3>Estado actual</h3>
            <p>Resumen del atleta y progreso reciente.</p>
          </div>
          <div className="statsGrid">
            <article className="statCard">
              <div className="smallLabel">{isCoachScope ? "Sujeto activo" : "Perfil activo"}</div>
              <strong>{activeSubject?.label || "Sin asignar"}</strong>
            </article>
            <article className="statCard">
              <div className="smallLabel">Racha</div>
              <strong>{`${streakDays} día${streakDays === 1 ? "" : "s"}`}</strong>
            </article>
            <article className="statCard">
              <div className="smallLabel">Última sesión</div>
              <strong>{!athleteId ? "-" : lastSessionAt ? new Date(lastSessionAt).toLocaleDateString() : "Sin registro"}</strong>
            </article>
            {sessionCount > 0 ? (
              <>
                <article className="statCard">
                  <div className="smallLabel">Sesiones</div>
                  <strong>{!athleteId ? "-" : opsLoading ? "..." : sessionCount}</strong>
                </article>
                <article className="statCard">
                  <div className="smallLabel">Runs</div>
                  <strong>{!athleteId ? "-" : opsLoading ? "..." : runCount}</strong>
                </article>
              </>
            ) : null}
          </div>
        </div>

        <div className="stack compactStack">
          <div className="sectionHead">
            <h3>Sesión sugerida hoy</h3>
            <p>{todaySessionSuggestion}</p>
          </div>
          <div className="quickActions">
            <button className="btn primary" onClick={() => nav("/session/new")} disabled={!athleteId}>
              Iniciar sesión sugerida
            </button>
            <button className="btn" onClick={() => nav("/planning")}>
              Ver plan actual
            </button>
          </div>

          <div className="sectionHead" style={{ marginTop: 6 }}>
            <h3>Acciones rápidas</h3>
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

      {sessionCount > 0 ? (
        <section className="surface">
          <div className="sectionHead">
            <h3>Embudo de uso</h3>
            <p>{`Progreso operacional: ${funnelCompletionPct}%`}</p>
          </div>
          <div className="stack compactStack" style={{ marginTop: 10 }}>
            {funnelStages.map((stage) => (
              <article key={stage.id} className="listItem">
                <div className="listMain">
                  <strong>{stage.label}</strong>
                  <span className="small">{stage.ok ? "Completado" : "Pendiente"}</span>
                </div>
                <div className="progressRail" aria-label={stage.label}>
                  <span className="progressFill" style={{ width: stage.ok ? "100%" : "26%" }} />
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {!smartEmptyState ? (
        <section className="surface">
          <div className="sectionHead">
            <h3>Alertas operativas</h3>
            <p>Prioriza estas acciones para mantener continuidad y calidad de señal.</p>
          </div>
          {homeAlerts.length === 0 ? (
            <div className="small" style={{ marginTop: 10 }}>Sin alertas críticas por ahora.</div>
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
      ) : null}

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
