export const UNCHECK_SET_ANIMATION_MS = 700;

export const DELETE_SET_ANIMATION_MS = 1_500;

export const DELETE_SET_UNDO_TIMEOUT_MS = 7_000;

export function setRowAnimationKey(exerciseIndex: number, setIndex: number): string {
  return `${exerciseIndex}:${setIndex}`;
}
