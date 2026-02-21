import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useAthleteAccess } from "../state/athlete";
import { useActiveSession } from "../state/activeSession";

const TICK_MS = 1_000;

function formatTimer(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function findFirstPendingSet(
  exercises: Array<{
    name: string;
    sets: Array<{ completed: boolean }>;
  }>,
): { exerciseName: string; exerciseIndex: number; setIndex: number } | null {
  for (const [exerciseIndex, exercise] of exercises.entries()) {
    for (const [setIndex, set] of exercise.sets.entries()) {
      if (!set.completed) {
        return {
          exerciseName: exercise.name,
          exerciseIndex,
          setIndex,
        };
      }
    }
  }
  return null;
}

export default function ActiveSessionBar() {
  const { draft, completeFirstPendingSet } = useActiveSession();
  const { athleteId, setAthleteId } = useAthleteAccess();
  const location = useLocation();
  const nav = useNavigate();
  const [nowMs, setNowMs] = useState(() => Date.now());

  const visible = Boolean(draft && draft.step === "capture_session" && location.pathname !== "/session/new");
  const currentPending = useMemo(
    () => findFirstPendingSet(draft?.routineExercises || []),
    [draft?.routineExercises],
  );
  const restRemainingSec = !draft?.restTimer ? 0 : Math.max(0, Math.ceil((draft.restTimer.ends_at_ms - nowMs) / 1_000));
  const restProgressPct =
    !draft?.restTimer || draft.restTimer.duration_seconds <= 0
      ? 0
      : Math.min(
          100,
          Math.round((Math.max(0, nowMs - draft.restTimer.started_at_ms) / (draft.restTimer.duration_seconds * 1_000)) * 100),
        );

  useEffect(() => {
    if (!visible) return;
    const syncNow = () => setNowMs(Date.now());
    const initialTimeoutId = window.setTimeout(syncNow, 0);
    const intervalId = window.setInterval(syncNow, TICK_MS);
    return () => {
      window.clearTimeout(initialTimeoutId);
      window.clearInterval(intervalId);
    };
  }, [visible]);

  if (!visible || !draft) return null;
  const session = draft;

  const exerciseLabel = currentPending
    ? `${currentPending.exerciseName} - Set ${currentPending.setIndex + 1}`
    : "Todos los sets marcados";
  const restLabel = session.restTimer
    ? restRemainingSec > 0
      ? `Descanso: ${formatTimer(restRemainingSec)}`
      : "Descanso listo"
    : "Sin descanso activo";

  function backToSession() {
    if (session.athleteId && session.athleteId !== athleteId) {
      setAthleteId(session.athleteId);
    }
    nav("/session/new");
  }

  return (
    <section className="activeSessionBar" aria-live="polite">
      <div className="activeSessionMain">
        <div className="activeSessionHead">
          <strong>{`Sesion activa${session.routineName ? `: ${session.routineName}` : ""}`}</strong>
          <span className="chip">{currentPending ? "Pendiente" : "Completada"}</span>
        </div>
        <div className="small">{`Actual: ${exerciseLabel}`}</div>
        <div className="activeSessionRestRow">
          <span className="chip">{restLabel}</span>
          {session.restTimer ? <span className="small">{`${session.restTimer.exercise_name} - Set ${session.restTimer.set_index + 1}`}</span> : null}
        </div>
        {session.restTimer ? (
          <div className="activeSessionTrack" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={restProgressPct}>
            <div className="activeSessionFill" style={{ width: `${restProgressPct}%` }} />
          </div>
        ) : null}
      </div>
      <div className="activeSessionActions">
        <button
          className="btn iconBtn setCompleteBtn activeSessionCheckBtn"
          type="button"
          onClick={completeFirstPendingSet}
          disabled={!currentPending}
          aria-label="Marcar set pendiente como completado"
          title="Marcar set pendiente como completado"
        >
          <svg className="iconGlyph" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M8.5 12.2L10.8 14.5L15.6 9.7" />
          </svg>
        </button>
        <button className="btn primary" type="button" onClick={backToSession}>
          Volver a sesion
        </button>
      </div>
    </section>
  );
}
