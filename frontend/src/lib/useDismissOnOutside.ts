import { useEffect, useRef, type RefObject } from "react";

type DismissOptions = {
  /** Si es false, solo cierra con click fuera (el Escape lo maneja el propio componente). */
  closeOnEscape?: boolean;
};

/** Cierra un popover abierto con `pointerdown` fuera de `rootRef` o con Escape. */
export function useDismissOnOutside(
  open: boolean,
  rootRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  { closeOnEscape = true }: DismissOptions = {},
): void {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onCloseRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    if (closeOnEscape) window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      if (closeOnEscape) window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, rootRef, closeOnEscape]);
}
