import { useEffect, useRef, useState, type DragEvent, type Dispatch, type SetStateAction, type PointerEvent as ReactPointerEvent } from "react";

import { routineExerciseIdentity, type DraftRoutineExercise } from "../../lib/routines/draft";

const DRAG_HOLD_TO_REORDER_MS = 280;
const DRAG_AUTO_SCROLL_EDGE_PX = 92;
const DRAG_AUTO_SCROLL_MAX_STEP_PX = 16;

/** Reordenado por arrastre de los ejercicios del borrador (mantener pulsado + arrastrar). */
export function useDraftDrag(setDraftExercises: Dispatch<SetStateAction<DraftRoutineExercise[]>>) {
  const [draggedExerciseIdentity, setDraggedExerciseIdentity] = useState<string | null>(null);
  const [dropSlotIndex, setDropSlotIndex] = useState<number | null>(null);
  const [dragArmedExerciseIdentity, setDragArmedExerciseIdentity] = useState<string | null>(null);
  const dragHoldTimeoutRef = useRef<number | null>(null);
  const dragAutoScrollRafRef = useRef<number | null>(null);
  const dragPointerClientYRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (dragHoldTimeoutRef.current !== null) {
        window.clearTimeout(dragHoldTimeoutRef.current);
        dragHoldTimeoutRef.current = null;
      }
      if (dragAutoScrollRafRef.current !== null) {
        window.cancelAnimationFrame(dragAutoScrollRafRef.current);
        dragAutoScrollRafRef.current = null;
      }
      dragPointerClientYRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!dragArmedExerciseIdentity) return;

    const onPointerRelease = () => {
      if (dragHoldTimeoutRef.current !== null) {
        window.clearTimeout(dragHoldTimeoutRef.current);
        dragHoldTimeoutRef.current = null;
      }
      if (!draggedExerciseIdentity) {
        setDragArmedExerciseIdentity(null);
      }
    };

    window.addEventListener("pointerup", onPointerRelease, true);
    window.addEventListener("pointercancel", onPointerRelease, true);
    return () => {
      window.removeEventListener("pointerup", onPointerRelease, true);
      window.removeEventListener("pointercancel", onPointerRelease, true);
    };
  }, [dragArmedExerciseIdentity, draggedExerciseIdentity]);

  function stopDraftAutoScroll() {
    if (dragAutoScrollRafRef.current !== null) {
      window.cancelAnimationFrame(dragAutoScrollRafRef.current);
      dragAutoScrollRafRef.current = null;
    }
    dragPointerClientYRef.current = null;
  }

  function runDraftAutoScrollLoop() {
    const pointerY = dragPointerClientYRef.current;
    if (pointerY === null) {
      dragAutoScrollRafRef.current = window.requestAnimationFrame(runDraftAutoScrollLoop);
      return;
    }

    const viewportHeight = window.innerHeight;
    const distanceToTop = pointerY;
    const distanceToBottom = viewportHeight - pointerY;
    let deltaY = 0;

    if (distanceToTop < DRAG_AUTO_SCROLL_EDGE_PX) {
      const intensity = (DRAG_AUTO_SCROLL_EDGE_PX - distanceToTop) / DRAG_AUTO_SCROLL_EDGE_PX;
      deltaY = -Math.max(1, Math.round(intensity * DRAG_AUTO_SCROLL_MAX_STEP_PX));
    } else if (distanceToBottom < DRAG_AUTO_SCROLL_EDGE_PX) {
      const intensity = (DRAG_AUTO_SCROLL_EDGE_PX - distanceToBottom) / DRAG_AUTO_SCROLL_EDGE_PX;
      deltaY = Math.max(1, Math.round(intensity * DRAG_AUTO_SCROLL_MAX_STEP_PX));
    }

    if (deltaY !== 0) {
      window.scrollBy({ top: deltaY, left: 0, behavior: "auto" });
    }

    dragAutoScrollRafRef.current = window.requestAnimationFrame(runDraftAutoScrollLoop);
  }

  function updateDraftDragPointerClientY(clientY: number) {
    if (!Number.isFinite(clientY)) return;
    dragPointerClientYRef.current = clientY;
    if (dragAutoScrollRafRef.current === null) {
      dragAutoScrollRafRef.current = window.requestAnimationFrame(runDraftAutoScrollLoop);
    }
  }

  function handleSortableListDragOverCapture(event: DragEvent<HTMLDivElement>) {
    updateDraftDragPointerClientY(event.clientY);
  }

  /** Limpia los tres estados de arrastre (sin tocar timers ni auto-scroll). */
  function resetDragState() {
    setDraggedExerciseIdentity(null);
    setDropSlotIndex(null);
    setDragArmedExerciseIdentity(null);
  }

  function clearDragState() {
    if (dragHoldTimeoutRef.current !== null) {
      window.clearTimeout(dragHoldTimeoutRef.current);
      dragHoldTimeoutRef.current = null;
    }
    stopDraftAutoScroll();
    resetDragState();
  }

  function moveDraftExercise(identityValue: string, slotIndexValue: number) {
    setDraftExercises((prev) => {
      if (prev.length <= 1) return prev;
      const sourceIndex = prev.findIndex((entry) => routineExerciseIdentity(entry) === identityValue);
      if (sourceIndex < 0) return prev;

      const boundedSlotIndex = Math.max(0, Math.min(prev.length, slotIndexValue));
      const destinationIndex = sourceIndex < boundedSlotIndex ? boundedSlotIndex - 1 : boundedSlotIndex;
      if (destinationIndex === sourceIndex) return prev;

      const next = [...prev];
      const [moved] = next.splice(sourceIndex, 1);
      if (!moved) return prev;
      next.splice(destinationIndex, 0, moved);
      return next;
    });
  }

  function armDraftExerciseDrag(identityValue: string) {
    if (dragHoldTimeoutRef.current !== null) {
      window.clearTimeout(dragHoldTimeoutRef.current);
      dragHoldTimeoutRef.current = null;
    }

    setDragArmedExerciseIdentity(null);
    dragHoldTimeoutRef.current = window.setTimeout(() => {
      setDragArmedExerciseIdentity(identityValue);
      dragHoldTimeoutRef.current = null;
    }, DRAG_HOLD_TO_REORDER_MS);
  }

  function handleExercisePointerDown(event: ReactPointerEvent<HTMLElement>, identityValue: string) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (draggedExerciseIdentity) return;
    armDraftExerciseDrag(identityValue);
  }

  function handleExercisePointerRelease() {
    if (dragHoldTimeoutRef.current !== null) {
      window.clearTimeout(dragHoldTimeoutRef.current);
      dragHoldTimeoutRef.current = null;
    }
    if (!draggedExerciseIdentity) {
      setDragArmedExerciseIdentity(null);
    }
  }

  function handleExerciseDragStart(event: DragEvent<HTMLElement>, identityValue: string) {
    if (dragArmedExerciseIdentity !== identityValue) {
      event.preventDefault();
      clearDragState();
      return;
    }

    setDraggedExerciseIdentity(identityValue);
    setDropSlotIndex(null);
    setDragArmedExerciseIdentity(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", identityValue);
    updateDraftDragPointerClientY(event.clientY);
  }

  function handleDropSlotDragOver(event: DragEvent<HTMLDivElement>, slotIndexValue: number) {
    const identityFromEvent = event.dataTransfer.getData("text/plain");
    const nextIdentity = draggedExerciseIdentity || identityFromEvent;
    if (!nextIdentity) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    updateDraftDragPointerClientY(event.clientY);
    if (dropSlotIndex !== slotIndexValue) {
      setDropSlotIndex(slotIndexValue);
    }
  }

  function handleDropSlotDrop(event: DragEvent<HTMLDivElement>, slotIndexValue: number) {
    event.preventDefault();
    const identityFromEvent = event.dataTransfer.getData("text/plain");
    const nextIdentity = draggedExerciseIdentity || identityFromEvent;
    if (!nextIdentity) {
      clearDragState();
      return;
    }
    moveDraftExercise(nextIdentity, slotIndexValue);
    clearDragState();
  }

  return {
    draggedExerciseIdentity,
    dropSlotIndex,
    dragArmedExerciseIdentity,
    clearDragState,
    resetDragState,
    handleSortableListDragOverCapture,
    handleExercisePointerDown,
    handleExercisePointerRelease,
    handleExerciseDragStart,
    handleDropSlotDragOver,
    handleDropSlotDrop,
  };
}
