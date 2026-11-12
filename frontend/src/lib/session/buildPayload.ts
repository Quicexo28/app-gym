import type { ActiveSessionVoiceCommandAudit } from "../../state/activeSession";
import type { EffortScale, WeightUnit } from "../../state/preferences";
import { toKg } from "../units";
import { toISOZ } from "./format";
import { parseSetEffortValue } from "./routine";
import { computeSessionElapsedMs } from "./sessionTimer";
import type { RoutineExerciseDraft, SessionTimerState } from "./types";
import {
  ENABLE_OFFLINE_VOICE_CAPTURE,
  MAX_VOICE_AUDIT_ENTRIES,
  VOICE_ENGINE,
  VOICE_LANGUAGE,
  VOICE_MODEL_ID,
  VOICE_WAKE_PHRASE,
} from "./voice";
import { clampWellnessScore, stressLabelFromScore, wellnessLabelFromScore } from "./wellness";

type SessionSetOut = {
  reps: number;
  load_kg: number;
  rpe?: number;
  rir?: number;
  meta: {
    set_index: number;
    completed: boolean;
    effort_scale?: "rpe" | "rir";
    effort_value?: number;
  };
};

type SessionExerciseOut = {
  name: string;
  sets: SessionSetOut[];
  meta: {
    exercise_index: number;
    completed: boolean;
    target_reps_min: number;
    target_reps_max: number;
    target_rest_seconds: number;
    group?: string;
    athlete_note?: string;
  };
};

// Convierte el borrador de ejercicios al formato de ingesta. Devuelve el texto del error si algún set es inválido.
export function buildSessionExercises(
  routineExercises: RoutineExerciseDraft[],
  effortScale: EffortScale,
  weightUnit: WeightUnit,
): { error: string } | { exercises: SessionExerciseOut[] } {
  const exercisesOut: SessionExerciseOut[] = [];
  for (const [exerciseIndex, entry] of routineExercises.entries()) {
    const sets: SessionSetOut[] = [];
    for (const [setIndex, set] of entry.sets.entries()) {
      const reps = Number(set.reps);
      const loadValue = Number(set.load);
      if (!Number.isFinite(reps) || reps <= 0 || !Number.isFinite(loadValue) || loadValue < 0) continue;

      const parsedEffort = parseSetEffortValue(set.effort, effortScale);
      if (!parsedEffort.valid) {
        return {
          error: `${effortScale.toUpperCase()} inválido en ${entry.name}, set ${setIndex + 1} (usa ${
            effortScale === "rir" ? "0-6" : "0-10"
          }).`,
        };
      }
      if (!parsedEffort.hasValue) {
        return { error: `${effortScale.toUpperCase()} requerido en ${entry.name}, set ${setIndex + 1}.` };
      }

      sets.push({
        reps,
        load_kg: Number(toKg(loadValue, weightUnit).toFixed(3)),
        rpe: parsedEffort.rpe ?? undefined,
        rir: parsedEffort.rir ?? undefined,
        meta: {
          set_index: setIndex + 1,
          completed: set.completed,
          effort_scale: effortScale,
          effort_value: parsedEffort.raw ?? undefined,
        },
      });
    }

    // Ejercicio sin sets capturados: se omite para poder cerrar rutinas parciales.
    if (sets.length === 0) continue;

    exercisesOut.push({
      name: entry.name,
      sets,
      meta: {
        exercise_index: exerciseIndex + 1,
        completed: entry.sets.every((set) => set.completed),
        target_reps_min: entry.target_reps_min,
        target_reps_max: entry.target_reps_max,
        target_rest_seconds: entry.rest_seconds,
        group: entry.group || undefined,
        athlete_note: entry.athleteNote?.trim() || undefined,
      },
    });
  }
  return { exercises: exercisesOut };
}

type BuildSessionPayloadArgs = {
  athleteId: string;
  startLocal: string;
  elapsedMinutes: number;
  sessionRpeAuto: number | null;
  exercises: SessionExerciseOut[];
  notes: string;
  routine: { id: string; name: string };
  effortScale: EffortScale;
  weightUnit: WeightUnit;
  finalizedTimer: SessionTimerState;
  nowMs: number;
  allSetsCompleted: boolean;
  sleepScore: number;
  stressScore: number;
  sensationScore: number;
  voiceAssistDesktopEnabled: boolean;
  voiceUsed: boolean;
  voiceAudit: ActiveSessionVoiceCommandAudit[];
};

export function buildSessionPayload(args: BuildSessionPayloadArgs) {
  const { finalizedTimer, nowMs, sleepScore, stressScore, sensationScore } = args;
  const voiceAuditCommands = args.voiceAudit.slice(-MAX_VOICE_AUDIT_ENTRIES);
  const appliedVoiceCommands = voiceAuditCommands.filter((entry) => entry.applied).length;
  const rejectedVoiceCommands = voiceAuditCommands.length - appliedVoiceCommands;

  return [
    {
      athlete_id: args.athleteId,
      start_time: toISOZ(args.startLocal),
      duration_min: args.elapsedMinutes,
      rpe: args.sessionRpeAuto ?? undefined,
      modality: "strength",
      exercises: args.exercises,
      source: "ui_routine",
      meta: {
        note: args.notes || undefined,
        routine_id: args.routine.id,
        routine_name: args.routine.name,
        effort_summary: {
          scale: args.effortScale,
          source: "auto_from_sets",
          computed_session_rpe: args.sessionRpeAuto,
        },
        weight_unit_input: args.weightUnit,
        session_completed_at_utc: finalizedTimer.completed_at_ms ? new Date(finalizedTimer.completed_at_ms).toISOString() : undefined,
        session_elapsed_seconds: Math.floor(computeSessionElapsedMs(finalizedTimer, nowMs) / 1_000),
        session_all_exercises_completed: args.allSetsCompleted,
        session_all_series_completed: args.allSetsCompleted,
        wellness_signals: {
          schema: "wellness_v2_1_10",
          sleep: {
            score_1_10: Number(clampWellnessScore(sleepScore).toFixed(1)),
            label: wellnessLabelFromScore(sleepScore),
          },
          stress: {
            score_1_10: Number(clampWellnessScore(stressScore).toFixed(1)),
            label: stressLabelFromScore(stressScore),
          },
          sensations: {
            score_1_10: Number(clampWellnessScore(sensationScore).toFixed(1)),
            label: wellnessLabelFromScore(sensationScore),
          },
          average_score_1_10: Number(((sleepScore + stressScore + sensationScore) / 3).toFixed(2)),
        },
        capture_protocol: {
          version: "session_capture_v2",
          voice_ready: ENABLE_OFFLINE_VOICE_CAPTURE,
          voice: {
            enabled: ENABLE_OFFLINE_VOICE_CAPTURE && args.voiceAssistDesktopEnabled,
            mode: "wake_phrase_armed",
            engine: VOICE_ENGINE,
            model_id: VOICE_MODEL_ID,
            language: VOICE_LANGUAGE,
            wake_phrase: VOICE_WAKE_PHRASE,
            offline_only: true,
          },
          supported_commands: ["set_reps", "set_load", "set_set_completed", "set_set_effort"],
        },
        voice_capture: {
          summary: {
            used: args.voiceUsed,
            total_commands: voiceAuditCommands.length,
            applied_commands: appliedVoiceCommands,
            rejected_commands: rejectedVoiceCommands,
          },
          commands: voiceAuditCommands,
        },
      },
    },
  ];
}
