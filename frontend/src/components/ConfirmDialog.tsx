import { useEffect, useRef } from "react";

export type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel: string;
  /** Texto del botón de cancelar; por defecto "Cancelar". */
  cancelLabel?: string;
  onConfirm: () => void;
};

type ConfirmDialogProps = {
  request: ConfirmRequest | null;
  onClose: () => void;
};

/** Ventana de confirmación propia (no la del navegador). Enfoca "Cancelar" para evitar borrados por error. */
export default function ConfirmDialog({ request, onClose }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!request) return;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [request, onClose]);

  if (!request) return null;

  return (
    <div
      className="modalOverlay confirmOverlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modalCard confirmCard" role="alertdialog" aria-modal="true" aria-label={request.title}>
        <div className="confirmIcon" aria-hidden="true">
          !
        </div>
        <h3>{request.title}</h3>
        <p>{request.message}</p>
        <div className="confirmActions">
          <button ref={cancelRef} type="button" className="histBtn neutral" onClick={onClose}>
            {request.cancelLabel ?? "Cancelar"}
          </button>
          <button
            type="button"
            className="histBtn danger"
            onClick={() => {
              request.onConfirm();
              onClose();
            }}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
