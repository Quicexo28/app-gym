import { formatTimer } from "../../lib/session/sessionTimer";
import type { SessionTimerState } from "../../lib/session/types";
import { APP_LOCALE } from "../../lib/locale";

type SessionTimerCardProps = {
  sessionTimer: SessionTimerState;
  elapsedSec: number;
  running: boolean;
  completed: boolean;
  started: boolean;
  onPause: () => void;
  onResume: () => void;
};

export default function SessionTimerCard({ sessionTimer, elapsedSec, running, completed, started, onPause, onResume }: SessionTimerCardProps) {
  const timerStatus = running ? "En curso" : completed ? "Completada" : started ? "Pausada" : "Sin iniciar";
  return (
    <div className="surface" style={{ marginTop: 12, padding: 12 }}>
      <div className="sectionHead">
        <h4>Temporizador de sesión</h4>
      </div>
      <div className="timerValue" style={{ marginTop: 10 }}>
        {formatTimer(elapsedSec)}
      </div>
      <div className="chipRow" style={{ marginTop: 8 }}>
        <span className="chip">Estado: {timerStatus}</span>
        {sessionTimer.completed_at_ms ? <span className="chip">{`Completada: ${new Date(sessionTimer.completed_at_ms).toLocaleTimeString(APP_LOCALE)}`}</span> : null}
      </div>
      {completed ? null : (
        <div className="quickActions" style={{ marginTop: 8 }}>
          <button
            className="btn"
            type="button"
            style={{ padding: "4px 12px", fontSize: 13, minHeight: 0 }}
            onClick={running ? onPause : onResume}
          >
            {running ? "Pausar" : "Reanudar"}
          </button>
        </div>
      )}
    </div>
  );
}
