import { APP_LOCALE } from "../../lib/locale";
import { formatExerciseNameForCard } from "../../lib/session/format";
import { voiceStatusLabel } from "../../lib/session/voice";
import type { ActiveSessionVoiceCommandAudit } from "../../state/activeSession";
import type { OfflineRecognizerState } from "../../lib/voice/types";

type VoiceDockProps = {
  open: boolean;
  voiceStatus: OfflineRecognizerState;
  captureActive: boolean;
  assistEnabled: boolean;
  clipboardBusy: boolean;
  currentTarget: { exerciseName: string; setIndex: number } | null;
  transcript: string;
  partial: string;
  transcriptDisplay: string;
  error: string;
  auditPreview: ActiveSessionVoiceCommandAudit[];
  onOpen: () => void;
  onClose: () => void;
  onToggleAssist: () => void;
  onStart: () => void;
  onStop: () => void;
  onTranscribeClipboard: () => void;
  onClear: () => void;
};

export default function VoiceDock({
  open,
  voiceStatus,
  captureActive,
  assistEnabled,
  clipboardBusy,
  currentTarget,
  transcript,
  partial,
  transcriptDisplay,
  error,
  auditPreview,
  onOpen,
  onClose,
  onToggleAssist,
  onStart,
  onStop,
  onTranscribeClipboard,
  onClear,
}: VoiceDockProps) {
  if (!open) {
    return (
      <button
        className={`voiceDockToggle ${captureActive ? "listening" : ""}`.trim()}
        type="button"
        onClick={onOpen}
        aria-label="Abrir asistencia por voz"
      >
        <span className="voiceDockDot" aria-hidden="true" />
        Voz
      </button>
    );
  }

  return (
    <aside className="voiceStatusDock" aria-live="polite">
      <div className="voiceStatusHead">
        <strong>Asistencia por voz</strong>
        <div className="hstack compact">
          <button className="btn" type="button" onClick={onToggleAssist}>
            {assistEnabled ? "Desactivar" : "Activar"}
          </button>
          <button className="btn ghost" type="button" onClick={onClose} aria-label="Ocultar asistencia por voz">
            Ocultar
          </button>
        </div>
      </div>
      <div className="chipRow">
        <span className={`chip ${voiceStatus === "error" ? "voiceChipError" : ""}`}>{`Estado: ${voiceStatusLabel(voiceStatus)}`}</span>
        <span className="chip">{`Escuchando: ${captureActive ? "si" : "no"}`}</span>
      </div>
      <div className="small">
        {currentTarget
          ? `Set actual: ${formatExerciseNameForCard(currentTarget.exerciseName)} - Set ${currentTarget.setIndex + 1}`
          : "Set actual: sin pendientes"}
      </div>
      <div className="voiceDockActions">
        <button className="btn primary" type="button" onClick={onStart} disabled={!assistEnabled || captureActive || clipboardBusy}>
          Iniciar escucha
        </button>
        <button className="btn" type="button" onClick={onStop} disabled={!captureActive && voiceStatus !== "error"}>
          Detener escucha
        </button>
        <button className="btn primary" type="button" onClick={onTranscribeClipboard} disabled={!assistEnabled || clipboardBusy}>
          {clipboardBusy ? "Transcribiendo..." : "Transcribir portapapeles"}
        </button>
        <button className="btn" type="button" onClick={onClear} disabled={!transcript && !partial && !error}>
          Limpiar
        </button>
      </div>
      <div className="voiceDockTranscript">{transcriptDisplay || "Sin transcripción aún."}</div>
      {error ? <div className="message error">{error}</div> : null}
      <div className="voiceLog">
        {auditPreview.length === 0 ? (
          <div className="small">Sin eventos de voz en esta sesión.</div>
        ) : (
          auditPreview.map((entry, index) => (
            <article key={`${entry.timestamp_ms}_${index}`} className={`voiceLogItem ${entry.applied ? "applied" : "rejected"}`.trim()}>
              <div className="hstack" style={{ justifyContent: "space-between" }}>
                <strong>{entry.applied ? "Aplicado" : "Rechazado"}</strong>
                <span className="small">{new Date(entry.timestamp_ms).toLocaleTimeString(APP_LOCALE)}</span>
              </div>
              <div className="small">{entry.transcript_normalized || "(sin texto)"}</div>
              <div className="small">{entry.reason}</div>
            </article>
          ))
        )}
      </div>
    </aside>
  );
}
