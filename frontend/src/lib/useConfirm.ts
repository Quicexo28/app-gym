import { createElement, useCallback, useMemo, useState, type ReactElement } from "react";

import ConfirmDialog, { type ConfirmRequest } from "../components/ConfirmDialog";

export type ConfirmOptions = Pick<ConfirmRequest, "title" | "message" | "confirmLabel" | "cancelLabel">;

type Pending = { options: ConfirmOptions; resolve: (accepted: boolean) => void };

/**
 * Reemplazo de `window.confirm`. `confirm(opciones)` devuelve una promesa con true si la
 * persona acepta y false si cancela (botón, Escape o clic fuera). Renderiza `dialog` una vez.
 */
export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        // Una petición nueva cancela la anterior para que su promesa no quede colgada.
        setPending((prev) => {
          prev?.resolve(false);
          return { options, resolve };
        });
      }),
    [],
  );

  const dialog: ReactElement = useMemo(() => {
    const request: ConfirmRequest | null = pending
      ? { ...pending.options, onConfirm: () => pending.resolve(true) }
      : null;
    const close = () => {
      pending?.resolve(false);
      setPending(null);
    };
    return createElement(ConfirmDialog, { request, onClose: close });
  }, [pending]);

  return { confirm, dialog };
}
