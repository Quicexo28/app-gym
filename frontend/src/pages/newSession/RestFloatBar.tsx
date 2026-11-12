import { formatTimerSigned } from "../../lib/session/sessionTimer";
import type { NotificationCapability, RestTimerState } from "../../lib/session/types";

type RestFloatBarProps = {
  restTimer: RestTimerState;
  remainingSecSigned: number;
  progressPct: number;
  notificationCapability: NotificationCapability;
  onRequestNotifications: () => void;
  onClose: () => void;
};

export default function RestFloatBar({
  restTimer,
  remainingSecSigned,
  progressPct,
  notificationCapability,
  onRequestNotifications,
  onClose,
}: RestFloatBarProps) {
  return (
    <section className="restFloatBar" aria-live="polite">
      <div className="restFloatTop">
        <strong>Descanso entre series</strong>
        <span className={`timerValue restFloatTimer${remainingSecSigned < 0 ? " restFloatTimerOver" : ""}`}>
          {formatTimerSigned(remainingSecSigned)}
        </span>
      </div>
      <div className="small">{`${restTimer.exercise_name} - Set ${restTimer.set_index + 1}`}</div>
      <div className="restFloatTrack" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPct}>
        <div className="restFloatFill" style={{ width: `${progressPct}%` }} />
      </div>
      <div className="restFloatBottom">
        <div className="hstack compact">
          {notificationCapability !== "unsupported" && notificationCapability !== "granted" ? (
            <button className="btn" type="button" onClick={onRequestNotifications}>
              Activar notificaciones
            </button>
          ) : null}
          <button className="btn" type="button" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </section>
  );
}
