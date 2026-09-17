import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { getSessions, type SessionRecord } from "../api";
import { loggedExerciseNames } from "../lib/loadHistory";
import { formatSetsRange, loadRoutines, ROUTINES_HYDRATED_EVENT, type RoutineTemplate } from "../lib/storage";
import { useAthleteAccess, useAthleteId } from "../state/athlete";

function totalSeries(exercises: RoutineTemplate["exercises"]): string {
  const min = exercises.reduce((acc, exercise) => acc + Math.max(0, exercise.target_sets_min || 0), 0);
  const max = exercises.reduce((acc, exercise) => acc + Math.max(0, exercise.target_sets_max || 0), 0);
  return formatSetsRange(min, max);
}

export default function CargasRoutines() {
  const navigate = useNavigate();
  const [athleteId] = useAthleteId();
  const { activeSubject } = useAthleteAccess();
  const [routines, setRoutines] = useState<RoutineTemplate[]>(() => (athleteId ? loadRoutines(athleteId) : []));
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Reset sincronizado durante render al cambiar de sujeto (evita efecto + setState).
  const [renderedAthleteId, setRenderedAthleteId] = useState(athleteId);
  if (renderedAthleteId !== athleteId) {
    setRenderedAthleteId(athleteId);
    setRoutines(athleteId ? loadRoutines(athleteId) : []);
  }

  useEffect(() => {
    const onHydrated = () => setRoutines(athleteId ? loadRoutines(athleteId) : []);
    window.addEventListener(ROUTINES_HYDRATED_EVENT, onHydrated);
    return () => window.removeEventListener(ROUTINES_HYDRATED_EVENT, onHydrated);
  }, [athleteId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!athleteId) {
        setSessions([]);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const items = await getSessions(athleteId);
        if (!cancelled) setSessions(items);
      } catch (cause: unknown) {
        if (!cancelled) setError(String((cause as { message?: string })?.message || cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  const loggedNames = useMemo(() => loggedExerciseNames(sessions), [sessions]);
  const sorted = useMemo(() => [...routines].sort((a, b) => a.name.localeCompare(b.name)), [routines]);

  function hasHistory(routine: RoutineTemplate): boolean {
    return routine.exercises.some((exercise) => loggedNames.has(exercise.name.replace(/\s+/g, " ").trim().toLowerCase()));
  }

  return (
    <>
      {error ? <section className="message error">{error}</section> : null}

      <section className="surface">
        <div className="sectionHead">
          <h3>Progreso por rutina</h3>
          <p>{`Sujeto activo: ${activeSubject?.label || "Sin sujeto"}. Toca una rutina para ver el progreso de sus ejercicios.`}</p>
        </div>
      </section>

      {!athleteId ? (
        <section className="surface">
          <div className="emptyState">No hay sujeto seleccionado.</div>
        </section>
      ) : loading ? (
        <section className="surface">
          <div className="emptyState">Cargando histórico de sesiones...</div>
        </section>
      ) : sorted.length === 0 ? (
        <section className="surface">
          <div className="emptyState">No hay rutinas guardadas para este sujeto.</div>
        </section>
      ) : (
        <div className="gridCards">
          {sorted.map((routine) => (
            <button
              key={routine.id}
              type="button"
              className="surfaceButton"
              onClick={() => navigate(`/profile/progress/cargas/rutina/${routine.id}`)}
            >
              <strong>{routine.name}</strong>
              <div className="chipRow">
                <span className="chip">{`Ejercicios: ${routine.exercises.length}`}</span>
                <span className="chip">{`Series objetivo: ${totalSeries(routine.exercises)}`}</span>
                <span className="chip">{hasHistory(routine) ? "Con historial" : "Sin historial aún"}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
