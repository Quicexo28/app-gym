import { useUndo } from "../state/undo";

export default function UndoBar() {
  const { current, pending, queueSize, undoCurrent, dismissCurrent } = useUndo();

  if (!current) return null;

  const queuedItems = queueSize - 1;

  return (
    <section className="undoBar" role="status" aria-live="polite" aria-atomic="true">
      <div className="undoBarMain">
        <strong className="undoBarMessage">{current.message}</strong>
      </div>

      <div className="undoBarActions">
        <button type="button" className="btn primary undoBarBtn" onClick={() => void undoCurrent()} disabled={pending}>
          {pending ? "Restaurando..." : current.actionLabel}
        </button>
        <button type="button" className="btn undoBarBtn" onClick={dismissCurrent} disabled={pending}>
          Cerrar
        </button>
        {queuedItems > 0 ? <span className="chip">+{queuedItems} en cola</span> : null}
      </div>
    </section>
  );
}
