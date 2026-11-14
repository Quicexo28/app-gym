import { useEffect, useRef } from "react";

// Modales abiertos a la vez: el scroll solo se restaura cuando se cierra el último.
let openModals = 0;
let overflowBeforeModals = "";

/**
 * Comportamiento común de un modal abierto: Escape llama a `onClose` y el scroll del body
 * queda bloqueado hasta cerrar (se restaura el valor previo, también con modales anidados).
 */
export function useModalBehavior(open: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown);

    if (openModals === 0) overflowBeforeModals = document.body.style.overflow;
    openModals += 1;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      openModals -= 1;
      if (openModals === 0) document.body.style.overflow = overflowBeforeModals;
    };
  }, [open]);
}
