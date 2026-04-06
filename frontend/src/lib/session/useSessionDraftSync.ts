import { useEffect } from "react";

import type { ActiveSessionDraft, ActiveSessionStep, ActiveSessionVoiceCommandAudit } from "../../state/activeSession";
import type { RestTimerState, SessionTimerState } from "./timers";

type RoutineExerciseDraft = {
  name: string;
  target_reps_min: number;
  target_reps_max: number;
  rest_seconds: number;
  sets: Array<{ reps: string; load: string; completed: boolean; effort: string }>;
};

type UseSessionDraftSyncParams = {
  athleteId: string;
  step: ActiveSessionStep;
  sessionAthleteId: string;
  routineId: string;
  selectedRoutineName: string;
  fallbackRoutineName: string;
  startLocal: string;
  notes: string;
  sleepScore: number;
  stressScore: number;
  sensationScore: number;
  routineExercises: RoutineExerciseDraft[];
  sessionTimer: SessionTimerState;
  restTimer: RestTimerState | null;
  voiceAudit: ActiveSessionVoiceCommandAudit[];
  voiceUsed: boolean;
  activeSessionDraft: ActiveSessionDraft | null;
  saveDraft: (draft: ActiveSessionDraft) => void;
  clearDraft: () => void;
};

export function useSessionDraftSync(params: UseSessionDraftSyncParams): void {
  const {
    athleteId,
    step,
    sessionAthleteId,
    routineId,
    selectedRoutineName,
    fallbackRoutineName,
    startLocal,
    notes,
    sleepScore,
    stressScore,
    sensationScore,
    routineExercises,
    sessionTimer,
    restTimer,
    voiceAudit,
    voiceUsed,
    activeSessionDraft,
    saveDraft,
    clearDraft,
  } = params;

  useEffect(() => {
    if (!athleteId) return;

    if (step !== "capture_session") {
      if (sessionAthleteId === athleteId && activeSessionDraft?.athleteId === athleteId) {
        clearDraft();
      }
      return;
    }

    if (!sessionAthleteId || sessionAthleteId !== athleteId) return;

    saveDraft({
      athleteId: sessionAthleteId,
      routineId,
      routineName: selectedRoutineName || fallbackRoutineName || "",
      step,
      startLocal,
      notes,
      sleepScore,
      stressScore,
      sensationScore,
      routineExercises,
      sessionTimer,
      restTimer,
      voiceAudit,
      voiceUsed,
      updatedAtMs: Date.now(),
    });
  }, [
    activeSessionDraft?.athleteId,
    athleteId,
    clearDraft,
    fallbackRoutineName,
    notes,
    restTimer,
    routineExercises,
    routineId,
    saveDraft,
    selectedRoutineName,
    sensationScore,
    sessionAthleteId,
    sessionTimer,
    sleepScore,
    startLocal,
    step,
    stressScore,
    voiceAudit,
    voiceUsed,
  ]);
}
