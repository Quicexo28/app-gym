import type { VoiceSetTarget } from "./types";

type SessionSet = {
  completed: boolean;
};

type SessionExercise = {
  name: string;
  sets: SessionSet[];
};

export function findCurrentSetTarget(exercises: SessionExercise[]): VoiceSetTarget | null {
  for (const [exerciseIndex, exercise] of exercises.entries()) {
    for (const [setIndex, set] of exercise.sets.entries()) {
      if (!set.completed) {
        return {
          exerciseIndex,
          setIndex,
          exerciseName: exercise.name,
        };
      }
    }
  }
  return null;
}

