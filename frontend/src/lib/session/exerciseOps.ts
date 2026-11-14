import {
  DEFAULT_REST_SECONDS,
  DEFAULT_TARGET_REPS_MAX,
  DEFAULT_TARGET_REPS_MIN,
  DEFAULT_TARGET_SETS,
} from "../routines/draft";
import { isUnilateralName, setSides } from "../laterality";
import { defaultSetForExercise, EMPTY_SET } from "./routine";
import type { RestTimerState, RoutineExerciseDraft, SessionDraftCommand, SetRow } from "./types";

type ExerciseIdentity = { name: string; group?: string | null };

/** Dos ejercicios son el mismo si comparten nombre y grupo. */
export function sameExercise(a: ExerciseIdentity, b: ExerciseIdentity): boolean {
  return a.name === b.name && (a.group ?? "") === (b.group ?? "");
}

export function setHasData(set: SetRow): boolean {
  return Boolean(set.completed || set.reps.trim() || set.load.trim() || set.effort.trim());
}

export function exerciseHasData(entry: RoutineExerciseDraft): boolean {
  return entry.sets.some(setHasData);
}

function mapAt(
  list: RoutineExerciseDraft[],
  exIdx: number,
  fn: (entry: RoutineExerciseDraft) => RoutineExerciseDraft,
): RoutineExerciseDraft[] {
  return list.map((entry, i) => (i === exIdx ? fn(entry) : entry));
}

export function setAthleteNote(list: RoutineExerciseDraft[], exIdx: number, value: string) {
  return mapAt(list, exIdx, (entry) => ({ ...entry, athleteNote: value }));
}

export function appendEmptySet(list: RoutineExerciseDraft[], exIdx: number) {
  return mapAt(list, exIdx, (entry) => ({ ...entry, sets: [...entry.sets, { ...EMPTY_SET }] }));
}

export function duplicateLastSetOf(list: RoutineExerciseDraft[], exIdx: number) {
  return mapAt(list, exIdx, (entry) => {
    const last = entry.sets[entry.sets.length - 1] || EMPTY_SET;
    return { ...entry, sets: [...entry.sets, { ...last }] };
  });
}

export function newExerciseFromCatalog(entry: { name: string; group?: string }): RoutineExerciseDraft {
  return {
    name: entry.name,
    group: entry.group,
    athleteNote: "",
    target_reps_min: DEFAULT_TARGET_REPS_MIN,
    target_reps_max: DEFAULT_TARGET_REPS_MAX,
    rest_seconds: DEFAULT_REST_SECONDS,
    sets: Array.from({ length: DEFAULT_TARGET_SETS }, () => defaultSetForExercise()),
  };
}

/** Se conservan objetivos y número de series; los datos capturados eran del ejercicio anterior. */
export function replaceExerciseIdentity(
  list: RoutineExerciseDraft[],
  exIdx: number,
  entry: { name: string; group?: string },
) {
  return mapAt(list, exIdx, (item) => ({
    ...item,
    name: entry.name,
    group: entry.group,
    athleteNote: "",
    sets: item.sets.map(() => defaultSetForExercise()),
  }));
}

/** Ajusta el número de series sin quitar nunca una serie con datos. */
export function resizeSets(sets: SetRow[], requested: number): SetRow[] {
  let lastUsed = -1;
  sets.forEach((set, idx) => {
    if (setHasData(set)) lastUsed = idx;
  });
  const targetCount = Math.max(requested, lastUsed + 1, 1);
  return targetCount >= sets.length
    ? [...sets, ...Array.from({ length: targetCount - sets.length }, () => defaultSetForExercise())]
    : sets.slice(0, targetCount);
}

/** Los índices cambian al quitar ejercicios: el descanso en curso se reajusta o se cancela. */
export function shiftRestTimerAfterRemoval(prev: RestTimerState | null, removedIdx: number): RestTimerState | null {
  if (!prev) return prev;
  if (prev.exercise_index === removedIdx) return null;
  if (prev.exercise_index > removedIdx) return { ...prev, exercise_index: prev.exercise_index - 1 };
  return prev;
}

/** Aplica un comando (input manual o voz) a la serie indicada. */
export function applyCommandToExercises(list: RoutineExerciseDraft[], command: SessionDraftCommand) {
  return list.map((entry, exIdx) => {
    if (exIdx !== command.exercise_index) return entry;
    if (command.set_index < 0 || command.set_index >= entry.sets.length) return entry;
    const unilateral = isUnilateralName(entry.name);
    const sets = entry.sets.map((set, setIdx) => {
      if (setIdx !== command.set_index) return set;
      if (command.type === "set_reps") return { ...set, reps: command.value };
      if (command.type === "set_load") return { ...set, load: command.value };
      if (command.type === "set_set_completed") {
        return unilateral
          ? { ...set, completed: command.value, sides: { left: command.value, right: command.value } }
          : { ...set, completed: command.value };
      }
      if (command.type === "set_set_side") {
        const sides = { ...setSides(set), [command.side]: command.value };
        return { ...set, sides, completed: sides.left && sides.right };
      }
      return { ...set, effort: command.value };
    });
    return { ...entry, sets };
  });
}
