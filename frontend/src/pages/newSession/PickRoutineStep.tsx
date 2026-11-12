import { formatSetsRange } from "../../lib/storage";
import type { RoutineTemplate } from "../../lib/storage";
import { formatExerciseNameForCard, formatRestRecommendation } from "../../lib/session/format";

type PickRoutineStepProps = {
  routines: RoutineTemplate[];
  routineId: string;
  requestedDayKey: string;
  error: string;
  hasActiveAthlete: boolean;
  noAthletesAssigned: boolean;
  onStartRoutine: (routineId: string) => void;
  onGoToTraining: () => void;
};

export default function PickRoutineStep({
  routines,
  routineId,
  requestedDayKey,
  error,
  hasActiveAthlete,
  noAthletesAssigned,
  onStartRoutine,
  onGoToTraining,
}: PickRoutineStepProps) {
  const hasRoutines = routines.length > 0;

  return (
    <div className="container stack">
      <header className="titleBlock">
        <div className="pickHead">
          <h1>Nueva sesión</h1>
          {hasRoutines ? (
            <button type="button" className="pickEditLink" onClick={onGoToTraining}>
              Editar rutinas
            </button>
          ) : null}
        </div>
        <p>Elige una rutina para empezar.</p>
      </header>

      <section className="surface pickSurface">
        {requestedDayKey ? (
          <div className="chipRow">
            <span className="chip">Día: {requestedDayKey}</span>
          </div>
        ) : null}

        {error ? (
          <div className="message error" style={{ marginTop: 12 }}>
            {error}
          </div>
        ) : null}

        {!hasRoutines ? (
          <div className="emptyState" style={{ marginTop: 12 }}>
            No hay rutinas creadas. Crea al menos una rutina para registrar sesiones.
            <div className="quickActions" style={{ marginTop: 10 }}>
              <button className="btn primary" onClick={onGoToTraining}>
                Ir a rutinas
              </button>
            </div>
          </div>
        ) : noAthletesAssigned ? (
          <div className="emptyState" style={{ marginTop: 12 }}>
            No tienes atletas asignados. Pide a un admin que te asigne al menos uno para poder registrar sesiones.
          </div>
        ) : (
          <div className="routinePickGrid">
            {routines.map((routine) => {
              const totalSetsMin = routine.exercises.reduce(
                (acc, exercise) => acc + Math.max(1, Math.round(exercise.target_sets_min || 1)),
                0,
              );
              const totalSetsMax = routine.exercises.reduce(
                (acc, exercise) => acc + Math.max(1, Math.round(exercise.target_sets_max || 1)),
                0,
              );
              const averageRestSeconds =
                routine.exercises.length > 0
                  ? Math.round(
                      routine.exercises.reduce((acc, exercise) => acc + Math.max(0, Math.round(exercise.rest_seconds || 0)), 0) /
                        routine.exercises.length,
                    )
                  : 0;
              const previewNames = routine.exercises
                .slice(0, 3)
                .map((exercise) => formatExerciseNameForCard(exercise.name))
                .filter(Boolean)
                .join(" - ");
              const hiddenCount = Math.max(0, routine.exercises.length - 3);

              return (
                <button
                  type="button"
                  key={routine.id}
                  className={`routinePickCard routinePickBtn ${routine.id === routineId ? "active" : ""}`.trim()}
                  onClick={() => onStartRoutine(routine.id)}
                  disabled={!hasActiveAthlete}
                >
                  <strong>{routine.name}</strong>
                  <span className="small">
                    {`${routine.exercises.length} ejercicio${routine.exercises.length === 1 ? "" : "s"} · ${formatSetsRange(totalSetsMin, totalSetsMax)} series · ~${formatRestRecommendation(averageRestSeconds)}`}
                  </span>
                  <span className="small">
                    {previewNames || "Sin ejercicios"}
                    {hiddenCount > 0 ? ` (+${hiddenCount})` : ""}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
