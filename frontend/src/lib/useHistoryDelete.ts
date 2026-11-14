import { useCallback, useState } from "react";

import type { ConfirmRequest } from "../components/ConfirmDialog";
import { useUndo } from "../state/undo";
import { errorMessage } from "./errors";
import type { DeleteOutcome } from "./historyActions";

export type DeleteJob = {
  /** Identifica qué se está borrando; sirve para desactivar su botón. */
  busyKey: string;
  title: string;
  message: string;
  confirmLabel: string;
  /** Texto de la barra de deshacer, p. ej. "Día eliminado.". */
  undoMessage: string;
  run: () => Promise<DeleteOutcome>;
  /** Se llama tras borrar y tras deshacer, para que la pantalla recargue. */
  onChanged: () => void;
};

/**
 * Único camino de borrado del historial: confirma con diálogo propio, borra, avisa de
 * errores y registra "Deshacer" en la barra global (la misma que usan sesión y dieta).
 */
export function useHistoryDelete() {
  const { registerUndo } = useUndo();
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  const execute = useCallback(
    async (job: DeleteJob) => {
      setBusyKey(job.busyKey);
      setError("");
      try {
        const outcome = await job.run();
        if (outcome.warning) setError(outcome.warning);
        const restore = outcome.restore;
        if (restore) {
          registerUndo({
            message: job.undoMessage,
            onUndo: async () => {
              await restore();
              job.onChanged();
            },
          });
        }
      } catch (cause: unknown) {
        setError(errorMessage(cause));
      } finally {
        setBusyKey(null);
        job.onChanged();
      }
    },
    [registerUndo],
  );

  const requestDelete = useCallback(
    (job: DeleteJob) => {
      setConfirm({
        title: job.title,
        message: job.message,
        confirmLabel: job.confirmLabel,
        onConfirm: () => void execute(job),
      });
    },
    [execute],
  );

  const closeConfirm = useCallback(() => setConfirm(null), []);

  return { confirm, closeConfirm, requestDelete, busyKey, error, clearError: () => setError("") };
}
