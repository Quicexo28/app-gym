import { useLayoutEffect, useState, type RefObject } from "react";

const VIEWPORT_MARGIN_PX = 8;

/** Corrige un popover posicionado con `left:0` para que no se salga del viewport en pantallas angostas. */
export function useClampPopover(open: boolean, ref: RefObject<HTMLElement | null>): number {
  const [shiftX, setShiftX] = useState(0);

  useLayoutEffect(() => {
    const measure = () => {
      if (!open) {
        setShiftX(0);
        return;
      }
      const el = ref.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      if (rect.right > window.innerWidth - VIEWPORT_MARGIN_PX) {
        setShiftX(window.innerWidth - VIEWPORT_MARGIN_PX - rect.right);
      } else if (rect.left < VIEWPORT_MARGIN_PX) {
        setShiftX(VIEWPORT_MARGIN_PX - rect.left);
      } else {
        setShiftX(0);
      }
    };
    measure();
  }, [open, ref]);

  return shiftX;
}
