import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";

const ACTION_WIDTH = 84;
const DRAG_START_THRESHOLD_PX = 6;
const LONG_PRESS_MS = 450;

type SwipeToDeleteRowProps = {
  children: ReactNode;
  onDelete: () => void;
  deleteLabel?: string;
  disabled?: boolean;
};

/**
 * Fila con "swipe" u "hold" tipo iPhone para revelar un boton de eliminar:
 * arrastrar hacia la izquierda o dejar presionado descubre la acción; soltar
 * sin cruzar el umbral la vuelve a esconder. Pointer events cubren touch,
 * mouse y pen con un solo código (el "long-press" con mouse es mousedown
 * sostenido).
 */
export default function SwipeToDeleteRow({ children, onDelete, deleteLabel = "Eliminar", disabled }: SwipeToDeleteRowProps) {
  const [revealed, setRevealed] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);

  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const draggingRef = useRef(false);
  const decidedAxisRef = useRef<"none" | "horizontal" | "vertical">("none");
  const longPressTimerRef = useRef<number | null>(null);
  const pointerIdRef = useRef<number | null>(null);

  function clearLongPressTimer() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (disabled) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;

    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    draggingRef.current = false;
    decidedAxisRef.current = "none";
    pointerIdRef.current = e.pointerId;

    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      if (decidedAxisRef.current === "vertical") return;
      setRevealed(true);
      setDragX(-ACTION_WIDTH);
    }, LONG_PRESS_MS);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (pointerIdRef.current !== e.pointerId) return;

    const dx = e.clientX - startXRef.current;
    const dy = e.clientY - startYRef.current;

    if (decidedAxisRef.current === "none" && (Math.abs(dx) > DRAG_START_THRESHOLD_PX || Math.abs(dy) > DRAG_START_THRESHOLD_PX)) {
      decidedAxisRef.current = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
      if (decidedAxisRef.current === "vertical") {
        clearLongPressTimer();
        return;
      }
      draggingRef.current = true;
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }

    if (decidedAxisRef.current !== "horizontal") return;

    clearLongPressTimer();
    e.preventDefault();
    const base = revealed ? -ACTION_WIDTH : 0;
    const next = Math.min(0, Math.max(-ACTION_WIDTH, base + dx));
    setDragX(next);
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>) {
    clearLongPressTimer();
    if (pointerIdRef.current === e.pointerId && e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    pointerIdRef.current = null;

    if (draggingRef.current) {
      const shouldReveal = dragX <= -ACTION_WIDTH / 2;
      setRevealed(shouldReveal);
      setDragX(shouldReveal ? -ACTION_WIDTH : 0);
    } else if (decidedAxisRef.current === "none" && revealed) {
      // Tap simple sobre una fila ya abierta: la cierra, como en iOS.
      setRevealed(false);
      setDragX(0);
    }
    draggingRef.current = false;
    decidedAxisRef.current = "none";
    setDragging(false);
  }

  function handleDelete() {
    setRevealed(false);
    setDragX(0);
    onDelete();
  }

  const offset = dragging || revealed ? dragX : 0;

  return (
    <div className="swipeRow">
      {/* En reposo se oculta: el contenido lo tapa, pero el borde redondeado del
          contenedor deja escapar un arco rojo de un pixel en la esquina. */}
      <button
        type="button"
        className={`swipeRowAction ${offset === 0 ? "hidden" : ""}`.trim()}
        onClick={handleDelete}
        disabled={disabled}
        style={{ width: ACTION_WIDTH }}
      >
        {deleteLabel}
      </button>
      <div
        className={`swipeRowContent ${dragging ? "dragging" : ""}`.trim()}
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {children}
      </div>
    </div>
  );
}
