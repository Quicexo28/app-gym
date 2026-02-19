import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  getPlanningAthleteOverview,
  getSessions,
  listRuns,
  type PlanningAthleteOverview,
  type RunListItem,
  type SessionRecord,
} from "../api";
import { loadRoutines } from "../lib/storage";
import { useAthleteAccess } from "../state/athlete";
import { useViewMode } from "../state/viewMode";

type HubTab = "routines" | "sessions" | "analytics" | "projections" | "cycles";

export default function UsersHub() {
  const { viewMode } = useViewMode();
  const { subjects, activeSubject, athleteId, setAthleteId, selfAthleteId, ready } = useAthleteAccess();
  const [tab, setTab] = useState<HubTab>("sessions");
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [planningOverview, setPlanningOverview] = useState<PlanningAthleteOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const nav = useNavigate();

  const selfSubject = useMemo(() => subjects.find((subject) => subject.kind === "self") || null, [subjects]);
  const assignedSubjects = useMemo(() => subjects.filter((subject) => subject.kind === "assigned"), [subjects]);
  const localRoutines = useMemo(() => loadRoutines(), []);
  const isCoachScope = viewMode === "coach" || viewMode === "admin";

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!athleteId) return;
      setLoading(true);
      setError("");
      try {
        const [sessionsData, runsData, planningData] = await Promise.all([
          getSessions(athleteId),
          listRuns(athleteId, 20),
          getPlanningAthleteOverview(athleteId),
        ]);
        if (cancelled) return;
        setSessions(sessionsData);
        setRuns(runsData);
        setPlanningOverview(planningData);
      } catch (cause: unknown) {
        if (cancelled) return;
        setError(String((cause as { message?: string })?.message || cause));
        setSessions([]);
        setRuns([]);
        setPlanningOverview(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  const sessionsSorted = useMemo(
    () => [...sessions].sort((a, b) => String(b.start_time || "").localeCompare(String(a.start_time || ""))),
    [sessions],
  );
  const runsSorted = useMemo(
    () => [...runs].sort((a, b) => String(b.generated_at_utc || "").localeCompare(String(a.generated_at_utc || ""))),
    [runs],
  );

  if (!isCoachScope) {
    return (
      <div className="container stack">
        <header className="titleBlock">
          <h1>Usuarios</h1>
          <p>Esta vista esta disponible en modo coach/admin.</p>
        </header>
        <section className="surface">
          <div className="emptyState">Cambia la vista a coach para gestionar sujetos asignados.</div>
        </section>
      </div>
    );
  }

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Hub de usuarios</h1>
        <p>Mi perfil arriba y luego usuarios asignados con detalle de sesiones, analitica y proyecciones.</p>
      </header>

      {error ? <section className="message error">{error}</section> : null}

      <section className="surface">
        <div className="sectionHead">
          <h3>Sujetos disponibles</h3>
          <p>Selecciona el sujeto activo para revisar su informacion.</p>
        </div>

        <div className="chipRow" style={{ marginTop: 10 }}>
          {selfSubject ? (
            <button
              className={`chipButton ${athleteId === selfSubject.id ? "activeChipButton" : ""}`}
              onClick={() => setAthleteId(selfSubject.id)}
            >
              Mi perfil
            </button>
          ) : null}
          {assignedSubjects.map((subject) => (
            <button
              key={subject.id}
              className={`chipButton ${athleteId === subject.id ? "activeChipButton" : ""}`}
              onClick={() => setAthleteId(subject.id)}
            >
              {subject.label}
            </button>
          ))}
        </div>
      </section>

      <section className="surface">
        <div className="sectionHead">
          <h3>Detalle del sujeto</h3>
          <p>{activeSubject ? `Activo: ${activeSubject.label}` : "Sin sujeto activo."}</p>
        </div>

        <div className="chipRow" style={{ marginTop: 10 }}>
          <span className="chip">Sesiones: {sessionsSorted.length}</span>
          <span className="chip">Runs: {runsSorted.length}</span>
          <span className="chip">{`Ciclos activos: ${planningOverview?.active_assignments?.length || 0}`}</span>
          <span className="chip">Tipo: {activeSubject?.kind === "self" ? "Mi perfil" : "Asignado"}</span>
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
          <button className="btn" onClick={() => nav("/routines")}>
            Mi rutinas
          </button>
          <button className="btn" onClick={() => nav("/planning")}>
            Planificacion
          </button>
        </div>

        <div className="quickActions" style={{ marginTop: 12 }}>
          <button className={`btn ${tab === "routines" ? "primary" : ""}`} onClick={() => setTab("routines")}>
            Rutinas
          </button>
          <button className={`btn ${tab === "sessions" ? "primary" : ""}`} onClick={() => setTab("sessions")}>
            Sesiones
          </button>
          <button className={`btn ${tab === "analytics" ? "primary" : ""}`} onClick={() => setTab("analytics")}>
            Analitica
          </button>
          <button className={`btn ${tab === "projections" ? "primary" : ""}`} onClick={() => setTab("projections")}>
            Proyecciones
          </button>
          <button className={`btn ${tab === "cycles" ? "primary" : ""}`} onClick={() => setTab("cycles")}>
            Ciclos
          </button>
        </div>

        {loading ? <div className="emptyState" style={{ marginTop: 12 }}>Cargando informacion...</div> : null}

        {!loading && tab === "routines" ? (
          <div style={{ marginTop: 12 }}>
            {activeSubject?.kind === "self" ? (
              localRoutines.length === 0 ? (
                <div className="emptyState">No hay rutinas locales guardadas.</div>
              ) : (
                <div className="gridCards">
                  {localRoutines.map((routine) => (
                    <article key={routine.id} className="surfaceButton">
                      <strong>{routine.name}</strong>
                      <span className="small">{`Ejercicios: ${routine.exercises.length}`}</span>
                    </article>
                  ))}
                </div>
              )
            ) : (
              <div className="emptyState">
                La asignacion/edicion colaborativa de rutinas por usuario se mostrara aqui en el siguiente paso backend.
              </div>
            )}
          </div>
        ) : null}

        {!loading && tab === "sessions" ? (
          <div style={{ marginTop: 12 }}>
            {sessionsSorted.length === 0 ? (
              <div className="emptyState">Sin sesiones para este sujeto.</div>
            ) : (
              <div className="stack compactStack">
                {sessionsSorted.slice(0, 12).map((session, idx) => (
                  <article key={`${session.start_time}_${idx}`} className="listItem">
                    <div className="listMain">
                      <strong>{session.start_time ? new Date(session.start_time).toLocaleString() : "Sin fecha"}</strong>
                      <span className="small">{`Duracion: ${session.duration_min || "-"} min`}</span>
                    </div>
                    <div className="listMeta">
                      <span className="small">{`RPE: ${session.rpe ?? "-"}`}</span>
                      <span className="small">{`Ejercicios: ${session.exercises?.length || 0}`}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {!loading && tab === "analytics" ? (
          <div style={{ marginTop: 12 }}>
            {runsSorted.length === 0 ? (
              <div className="emptyState">Aun no hay runs para analitica.</div>
            ) : (
              <div className="gridCards">
                {runsSorted.slice(0, 8).map((run) => (
                  <article key={run.run_id} className="surfaceButton">
                    <strong>{run.summary?.top_scenario || "Run"}</strong>
                    <span className="small">{new Date(run.generated_at_utc).toLocaleString()}</span>
                    <span className="small">
                      {`Confianza top: ${
                        typeof run.summary?.top_probability === "number"
                          ? `${Math.round(run.summary.top_probability * 100)}%`
                          : "-"
                      }`}
                    </span>
                  </article>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {!loading && tab === "projections" ? (
          <div style={{ marginTop: 12 }}>
            {runsSorted.length === 0 ? (
              <div className="emptyState">No hay proyecciones disponibles todavia.</div>
            ) : (
              <div className="stack compactStack">
                {runsSorted.slice(0, 6).map((run) => (
                  <article key={run.run_id} className="listItem">
                    <div className="listMain">
                      <strong>{run.summary?.top_scenario || "Escenario principal"}</strong>
                      <span className="small">{new Date(run.generated_at_utc).toLocaleString()}</span>
                    </div>
                    <div className="listMeta">
                      <span className="small">{`Metrica: ${run.metric_key}`}</span>
                      <button className="btn" onClick={() => nav(`/run/${encodeURIComponent(run.run_id)}`)}>
                        Ver run
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {!loading && tab === "cycles" ? (
          <div style={{ marginTop: 12 }}>
            {!planningOverview ? (
              <div className="emptyState">Sin datos de ciclos para este sujeto.</div>
            ) : (
              <div className="stack compactStack">
                <article className="listItem">
                  <div className="listMain">
                    <strong>{`Ciclos activos: ${planningOverview.active_assignments.length}`}</strong>
                    <span className="small">{`Recientes: ${planningOverview.recent_assignments.length}`}</span>
                  </div>
                </article>
                {planningOverview.active_assignments.length === 0 ? (
                  <div className="emptyState">No hay ciclos activos.</div>
                ) : (
                  planningOverview.active_assignments.slice(0, 8).map((item) => (
                    <article key={item.id} className="listItem">
                      <div className="listMain">
                        <strong>{item.template_name || item.template_id}</strong>
                        <span className="small">{`${item.level} | ${item.status}`}</span>
                      </div>
                      <div className="listMeta">
                        <span className="small">{`Adherencia: ${Math.round((item.adherence || 0) * 100)}%`}</span>
                        <span className="small">{`Bloques: ${item.blocks_completed || 0}/${item.blocks_total || 0}`}</span>
                      </div>
                    </article>
                  ))
                )}
              </div>
            )}
          </div>
        ) : null}
      </section>

      {!ready ? (
        <section className="surface">
          <div className="emptyState">Sincronizando sujetos...</div>
        </section>
      ) : null}
    </div>
  );
}
