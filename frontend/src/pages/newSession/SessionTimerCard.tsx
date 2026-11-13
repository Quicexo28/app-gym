import { formatTimer } from "../../lib/session/sessionTimer";
import type { SessionTimerState } from "../../lib/session/types";

type SessionTimerCardProps = {
  sessionTimer: SessionTimerState;
  elapsedSec: number;
  running: boolean;
  completed: boolean;
  started: boolean;
  onPause: () => void;
  onResume: () => void;
};

// Barra compacta: se queda en su sitio al inicio y se ancla arriba al bajar (position: sticky).
export default function SessionTimerCard({ elapsedSec, running, completed, started, onPause, onResume }: SessionTimerCardProps) {
  const timerStatus = running ? "En curso" : completed ? "Completada" : started ? "Pausada" : "Sin iniciar";
  return (
    <div className="sessionTimerBar" role="timer" aria-label="Temporizador de sesión">
      <span className="sessionTimerValue">{formatTimer(elapsedSec)}</span>
      <span className="small">{timerStatus}</span>
      {completed ? null : (
        <button className="btn sessionTimerBtn" type="button" onClick={running ? onPause : onResume}>
          {running ? "Pausar" : "Reanudar"}
        </button>
      )}
    </div>
  );
}
