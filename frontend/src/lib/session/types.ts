// Tipos compartidos de la captura de sesión por rutina.
export type SetRow = { reps: string; load: string; completed: boolean; effort: string };

export type RoutineExerciseDraft = {
  name: string;
  group?: string;
  athleteNote?: string;
  target_reps_min: number;
  target_reps_max: number;
  rest_seconds: number;
  sets: SetRow[];
};

export type SessionStep = "pick_routine" | "capture_session";

export type SessionTimerState = {
  started_at_ms: number | null;
  running_since_ms: number | null;
  accumulated_ms: number;
  completed_at_ms: number | null;
};

export type RestTimerState = {
  exercise_index: number;
  set_index: number;
  exercise_name: string;
  duration_seconds: number;
  started_at_ms: number;
  ends_at_ms: number;
  notified: boolean;
};

export type NotificationCapability = NotificationPermission | "unsupported";

export type SessionDraftCommand =
  | { type: "set_reps"; exercise_index: number; set_index: number; value: string }
  | { type: "set_load"; exercise_index: number; set_index: number; value: string }
  | { type: "set_set_completed"; exercise_index: number; set_index: number; value: boolean }
  | { type: "set_set_effort"; exercise_index: number; set_index: number; value: string };

export type PendingSetDelete = {
  id: string;
  rowKey: string;
  exerciseIndex: number;
  setIndex: number;
  setSnapshot: SetRow;
  exerciseName: string;
  committed: boolean;
  animationTimeoutId: number | null;
  cleanupTimeoutId: number | null;
};
