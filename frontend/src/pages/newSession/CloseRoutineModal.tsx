type CloseRoutineModalProps = {
  error: string;
  busy: boolean;
  canSave: boolean;
  onComplete: () => void;
  onCancelRoutine: () => void;
  onBack: () => void;
};

export default function CloseRoutineModal({ error, busy, canSave, onComplete, onCancelRoutine, onBack }: CloseRoutineModalProps) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label="Cerrar rutina">
      <div className="modalCard closeRoutineModal">
        <div className="sectionHead">
          <h3>Cerrar rutina</h3>
          <p>Elige como quieres cerrar la sesión activa.</p>
        </div>

        {error ? <div className="message error">{error}</div> : null}

        <div className="closeRoutineActions">
          <button className="btn primary" type="button" disabled={busy || !canSave} onClick={onComplete}>
            {busy ? "Guardando..." : "Completar rutina"}
          </button>
          <span className="small">Guarda los datos capturados y cierra la sesión.</span>

          <button className="btn trashBtn" type="button" disabled={busy} onClick={onCancelRoutine}>
            Cancelar rutina
          </button>
          <span className="small">Cierra sin guardar. Se pierden los datos de esta sesión.</span>

          <button className="btn ghost" type="button" onClick={onBack}>
            Volver
          </button>
        </div>
      </div>
    </div>
  );
}
