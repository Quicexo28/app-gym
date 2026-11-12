import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { formatExerciseNameForCard } from "../../lib/session/format";
import {
  DELETE_SET_ANIMATION_MS,
  DELETE_SET_UNDO_TIMEOUT_MS,
  setRowAnimationKey,
  UNCHECK_SET_ANIMATION_MS,
} from "../../lib/session/setAnimation";
import type { PendingSetDelete, RestTimerState, RoutineExerciseDraft, SessionDraftCommand } from "../../lib/session/types";
import { useUndo } from "../../state/undo";

type UseSetRowAnimationsArgs = {
  routineExercises: RoutineExerciseDraft[];
  setRoutineExercises: Dispatch<SetStateAction<RoutineExerciseDraft[]>>;
  setRestTimer: Dispatch<SetStateAction<RestTimerState | null>>;
  setError: (message: string) => void;
  applySessionDraftCommand: (command: SessionDraftCommand) => void;
};

// Animaciones de marcar/desmarcar y borrar series, con deshacer del borrado.
export function useSetRowAnimations({
  routineExercises,
  setRoutineExercises,
  setRestTimer,
  setError,
  applySessionDraftCommand,
}: UseSetRowAnimationsArgs) {
  const { registerUndo } = useUndo();
  const [uncheckingSetKeys, setUncheckingSetKeys] = useState<string[]>([]);
  const [deletingSetKeys, setDeletingSetKeys] = useState<string[]>([]);

  const uncheckTimeoutsRef = useRef<number[]>([]);
  const deleteTimeoutsRef = useRef<number[]>([]);
  const pendingSetDeletesRef = useRef<Map<string, PendingSetDelete>>(new Map());
  const nextSetDeleteIdRef = useRef(1);
  const clearAnimationTimeouts = useCallback(() => {
    for (const timeoutId of uncheckTimeoutsRef.current) {
      window.clearTimeout(timeoutId);
    }
    for (const timeoutId of deleteTimeoutsRef.current) {
      window.clearTimeout(timeoutId);
    }
    for (const pendingDelete of pendingSetDeletesRef.current.values()) {
      if (pendingDelete.animationTimeoutId !== null) {
        window.clearTimeout(pendingDelete.animationTimeoutId);
      }
      if (pendingDelete.cleanupTimeoutId !== null) {
        window.clearTimeout(pendingDelete.cleanupTimeoutId);
      }
    }
    uncheckTimeoutsRef.current = [];
    deleteTimeoutsRef.current = [];
    pendingSetDeletesRef.current.clear();
  }, []);
  const resetSetAnimations = useCallback(() => {
    clearAnimationTimeouts();
    setUncheckingSetKeys([]);
    setDeletingSetKeys([]);
  }, [clearAnimationTimeouts]);

  useEffect(
    () => () => {
      clearAnimationTimeouts();
    },
    [clearAnimationTimeouts],
  );

  const hasPendingSetDelete = deletingSetKeys.length > 0;

  function removeSet(exIdx: number, setIdx: number) {
    setRoutineExercises((prev) =>
      prev.map((entry, i) => (i === exIdx ? { ...entry, sets: entry.sets.filter((_, j) => j !== setIdx) } : entry)),
    );
    setRestTimer((prev) => {
      if (!prev) return prev;
      if (prev.exercise_index !== exIdx) return prev;
      if (prev.set_index === setIdx) return null;
      if (prev.set_index > setIdx) return { ...prev, set_index: prev.set_index - 1 };
      return prev;
    });
  }

  function restoreRemovedSet(record: PendingSetDelete) {
    setRoutineExercises((prev) =>
      prev.map((entry, i) => {
        if (i !== record.exerciseIndex) return entry;
        const boundedIndex = Math.max(0, Math.min(entry.sets.length, record.setIndex));
        const nextSets = [...entry.sets];
        nextSets.splice(boundedIndex, 0, { ...record.setSnapshot });
        return { ...entry, sets: nextSets };
      }),
    );
  }

  function handleSetCompletedToggle(exIdx: number, setIdx: number, completed: boolean) {
    const setKey = setRowAnimationKey(exIdx, setIdx);
    if (deletingSetKeys.includes(setKey) || uncheckingSetKeys.includes(setKey)) return;

    if (!completed) {
      applySessionDraftCommand({
        type: "set_set_completed",
        exercise_index: exIdx,
        set_index: setIdx,
        value: true,
      });
      return;
    }

    setUncheckingSetKeys((prev) => (prev.includes(setKey) ? prev : [...prev, setKey]));
    const timeoutId = window.setTimeout(() => {
      applySessionDraftCommand({
        type: "set_set_completed",
        exercise_index: exIdx,
        set_index: setIdx,
        value: false,
      });
      setUncheckingSetKeys((prev) => prev.filter((item) => item !== setKey));
      uncheckTimeoutsRef.current = uncheckTimeoutsRef.current.filter((item) => item !== timeoutId);
    }, UNCHECK_SET_ANIMATION_MS);
    uncheckTimeoutsRef.current.push(timeoutId);
  }

  function handleRemoveSetWithAnimation(exIdx: number, setIdx: number) {
    const setKey = setRowAnimationKey(exIdx, setIdx);
    if (hasPendingSetDelete || uncheckingSetKeys.includes(setKey) || deletingSetKeys.includes(setKey)) return;
    const exercise = routineExercises[exIdx];
    const setSnapshot = exercise?.sets[setIdx];
    if (!exercise || !setSnapshot) return;

    const deleteId = `session_set_delete_${nextSetDeleteIdRef.current++}`;
    const pendingDelete: PendingSetDelete = {
      id: deleteId,
      rowKey: setKey,
      exerciseIndex: exIdx,
      setIndex: setIdx,
      setSnapshot: { ...setSnapshot },
      exerciseName: exercise.name,
      committed: false,
      animationTimeoutId: null,
      cleanupTimeoutId: null,
    };
    pendingSetDeletesRef.current.set(deleteId, pendingDelete);

    setDeletingSetKeys([setKey]);
    const timeoutId = window.setTimeout(() => {
      const currentPending = pendingSetDeletesRef.current.get(deleteId);
      if (!currentPending) return;
      currentPending.committed = true;
      currentPending.animationTimeoutId = null;
      removeSet(currentPending.exerciseIndex, currentPending.setIndex);
      setDeletingSetKeys((prev) => prev.filter((item) => item !== currentPending.rowKey));
      deleteTimeoutsRef.current = deleteTimeoutsRef.current.filter((item) => item !== timeoutId);
    }, DELETE_SET_ANIMATION_MS);
    pendingDelete.animationTimeoutId = timeoutId;
    deleteTimeoutsRef.current.push(timeoutId);

    registerUndo({
      message: `Serie ${setIdx + 1} de "${formatExerciseNameForCard(exercise.name)}" eliminada.`,
      timeoutMs: DELETE_SET_UNDO_TIMEOUT_MS,
      onUndo: async () => {
        const currentPending = pendingSetDeletesRef.current.get(deleteId);
        if (!currentPending) return;

        if (currentPending.animationTimeoutId !== null) {
          window.clearTimeout(currentPending.animationTimeoutId);
          deleteTimeoutsRef.current = deleteTimeoutsRef.current.filter((item) => item !== currentPending.animationTimeoutId);
          currentPending.animationTimeoutId = null;
          setDeletingSetKeys((prev) => prev.filter((item) => item !== currentPending.rowKey));
        } else if (currentPending.committed) {
          restoreRemovedSet(currentPending);
        }

        if (currentPending.cleanupTimeoutId !== null) {
          window.clearTimeout(currentPending.cleanupTimeoutId);
        }
        pendingSetDeletesRef.current.delete(deleteId);
        setError("");
      },
    });

    const cleanupTimeoutId = window.setTimeout(() => {
      const staleDelete = pendingSetDeletesRef.current.get(deleteId);
      if (!staleDelete) return;
      if (staleDelete.animationTimeoutId !== null) {
        window.clearTimeout(staleDelete.animationTimeoutId);
      }
      pendingSetDeletesRef.current.delete(deleteId);
    }, DELETE_SET_UNDO_TIMEOUT_MS + 200);
    pendingDelete.cleanupTimeoutId = cleanupTimeoutId;
  }

  return {
    uncheckingSetKeys,
    deletingSetKeys,
    hasPendingSetDelete,
    resetSetAnimations,
    handleSetCompletedToggle,
    handleRemoveSetWithAnimation,
  };
}
