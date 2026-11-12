import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import BodyMap from "../components/BodyMap";
import { aggregateSetsByBodyGroup } from "../lib/bodyMap";
import { formatSetsRange, loadRoutines, ROUTINES_HYDRATED_EVENT, type RoutineTemplate } from "../lib/storage";
import { useAthleteAccess, useAthleteId } from "../state/athlete";
import { useExerciseCatalog } from "../state/exerciseCatalog";
import { useAthleteSessions } from "../lib/useAthleteSessions";
import "../styles.perfil.css";

const BODY_PERIODS: Array<{ label: string; days: number | null }> = [
  { label: "4 semanas", days: 28 },
  { label: "12 semanas", days: 84 },
  { label: "Todo", days: null },
];

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
  const { sessions, loading, error } = useAthleteSessions(athleteId);
  const { entries } = useExerciseCatalog();
  const [periodDays, setPeriodDays] = useState<number | null>(28);

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

  const bodyAgg = useMemo(
    () => aggregateSetsByBodyGroup(sessions, entries, periodDays),
    [sessions, entries, periodDays],
  );
  const sorted = useMemo(() => [...routines].sort((a, b) => a.name.localeCompare(b.name)), [routines]);

  return (
    <>
      {error ? <section className="message error">{error}</section> : null}

      {activeSubject && activeSubject.kind !== "self" ? (
        <p className="small">{`Viendo: ${activeSubject.label}`}</p>
      ) : null}

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
              <span className="small">{`${routine.exercises.length} ${routine.exercises.length === 1 ? "ejercicio" : "ejercicios"} · ${totalSeries(routine.exercises)} series`}</span>
            </button>
          ))}
        </div>
      )}

      {athleteId && !loading ? (
        <section className="surface zonasCard">
          <div className="sectionHead">
            <h3>Zonas entrenadas</h3>
            <p>Series registradas por grupo muscular. Más opacidad = más series en el periodo.</p>
          </div>
          <div className="chipRow" role="group" aria-label="Periodo" style={{ margin: "10px 0" }}>
            {BODY_PERIODS.map((p) => (
              <button
                key={p.label}
                type="button"
                className={`chipButton ${p.days === periodDays ? "activeChipButton" : ""}`}
                aria-pressed={p.days === periodDays}
                onClick={() => setPeriodDays(p.days)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <BodyMap values={bodyAgg.sets} />
          {bodyAgg.unclassifiedSets > 0 ? (
            <p className="small">{`${bodyAgg.unclassifiedSets} series de ejercicios sin grupo en el catálogo no se muestran.`}</p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
