/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { cancelRestNotification, scheduleRestNotification } from "../lib/restNotification";
import { endSessionLiveActivity, syncSessionLiveActivity } from "../lib/sessionLiveActivity";
import type { SessionLiveActivityState } from "../lib/sessionLiveActivity";
import { loadJSON, removeKey, saveJSON } from "../lib/storage";

export type ActiveSessionStep = "pick_routine" | "capture_session";

export type ActiveSessionSetRow = {
  reps: string;
  load: string;
  completed: boolean;
  effort: string;
};

export type ActiveSessionVoiceIntent =
  | "set_reps"
  | "set_load"
  | "set_set_effort"
  | "set_set_completed"
  | "none";

export type ActiveSessionVoiceCommandAudit = {
  timestamp_ms: number;
  transcript_normalized: string;
  intent: ActiveSessionVoiceIntent;
  exercise_index: number | null;
  set_index: number | null;
  exercise_name: string | null;
  value_text: string | null;
  confidence: number;
  applied: boolean;
  reason: string;
};

export type ActiveSessionExerciseDraft = {
  name: string;
  target_reps_min: number;
  target_reps_max: number;
  rest_seconds: number;
  sets: ActiveSessionSetRow[];
};

export type ActiveSessionTimerState = {
  started_at_ms: number | null;
  running_since_ms: number | null;
  accumulated_ms: number;
  completed_at_ms: number | null;
};

export type ActiveRestTimerState = {
  exercise_index: number;
  set_index: number;
  exercise_name: string;
  duration_seconds: number;
  started_at_ms: number;
  ends_at_ms: number;
  notified: boolean;
};

export type ActiveSessionDraft = {
  athleteId: string;
  routineId: string;
  routineName: string;
  step: ActiveSessionStep;
  startLocal: string;
  notes: string;
  sleepScore: number;
  stressScore: number;
  sensationScore: number;
  routineExercises: ActiveSessionExerciseDraft[];
  sessionTimer: ActiveSessionTimerState;
  restTimer: ActiveRestTimerState | null;
  voiceAudit: ActiveSessionVoiceCommandAudit[];
  voiceUsed: boolean;
  updatedAtMs: number;
};

type ActiveSessionContextValue = {
  draft: ActiveSessionDraft | null;
  saveDraft: (draft: ActiveSessionDraft) => void;
  clearDraft: () => void;
  completeFirstPendingSet: () => void;
};

const KEY = "coach_ai_active_session_v1";
const ActiveSessionContext = createContext<ActiveSessionContextValue | null>(null);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value;
}

function asTimestamp(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function asText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return value;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

function normalizeSet(raw: unknown): ActiveSessionSetRow {
  const source = asRecord(raw);
  return {
    reps: asText(source?.reps ?? ""),
    load: asText(source?.load ?? ""),
    completed: Boolean(source?.completed),
    effort: asText(source?.effort ?? ""),
  };
}

function normalizeExercise(raw: unknown): ActiveSessionExerciseDraft | null {
  const source = asRecord(raw);
  if (!source) return null;
  const name = asText(source.name).trim();
  if (!name) return null;
  const rawSets = Array.isArray(source.sets) ? source.sets : [];
  const sets = rawSets.map(normalizeSet);
  return {
    name,
    target_reps_min: Math.max(1, Math.round(asNumber(source.target_reps_min, 1))),
    target_reps_max: Math.max(1, Math.round(asNumber(source.target_reps_max, 1))),
    rest_seconds: Math.max(0, Math.round(asNumber(source.rest_seconds, 0))),
    sets: sets.length > 0 ? sets : [normalizeSet({})],
  };
}

function normalizeSessionTimer(raw: unknown): ActiveSessionTimerState {
  const source = asRecord(raw);
  return {
    started_at_ms: asTimestamp(source?.started_at_ms),
    running_since_ms: asTimestamp(source?.running_since_ms),
    accumulated_ms: Math.max(0, asNumber(source?.accumulated_ms, 0)),
    completed_at_ms: asTimestamp(source?.completed_at_ms),
  };
}

function normalizeRestTimer(raw: unknown): ActiveRestTimerState | null {
  const source = asRecord(raw);
  if (!source) return null;
  const duration = Math.max(0, Math.round(asNumber(source.duration_seconds, 0)));
  const startedAt = asTimestamp(source.started_at_ms);
  const endsAt = asTimestamp(source.ends_at_ms);
  if (startedAt === null || endsAt === null) return null;
  return {
    exercise_index: Math.max(0, Math.round(asNumber(source.exercise_index, 0))),
    set_index: Math.max(0, Math.round(asNumber(source.set_index, 0))),
    exercise_name: asText(source.exercise_name, "Ejercicio"),
    duration_seconds: duration,
    started_at_ms: startedAt,
    ends_at_ms: endsAt,
    notified: Boolean(source.notified),
  };
}

const VOICE_INTENTS: ActiveSessionVoiceIntent[] = ["set_reps", "set_load", "set_set_effort", "set_set_completed", "none"];
const MAX_VOICE_AUDIT_ENTRIES = 50;

function normalizeVoiceIntent(raw: unknown): ActiveSessionVoiceIntent {
  if (typeof raw !== "string") return "none";
  const key = raw.trim() as ActiveSessionVoiceIntent;
  return VOICE_INTENTS.includes(key) ? key : "none";
}

function normalizeVoiceAuditEntry(raw: unknown): ActiveSessionVoiceCommandAudit | null {
  const source = asRecord(raw);
  if (!source) return null;
  const timestamp = asTimestamp(source.timestamp_ms) ?? Date.now();
  const confidenceRaw = asNumber(source.confidence, 0);
  const confidence = Math.max(0, Math.min(1, Number(confidenceRaw.toFixed(3))));
  return {
    timestamp_ms: timestamp,
    transcript_normalized: asText(source.transcript_normalized).trim(),
    intent: normalizeVoiceIntent(source.intent),
    exercise_index:
      source.exercise_index === null || typeof source.exercise_index === "undefined"
        ? null
        : Math.max(0, Math.round(asNumber(source.exercise_index, 0))),
    set_index:
      source.set_index === null || typeof source.set_index === "undefined"
        ? null
        : Math.max(0, Math.round(asNumber(source.set_index, 0))),
    exercise_name:
      source.exercise_name === null || typeof source.exercise_name === "undefined"
        ? null
        : asText(source.exercise_name).trim(),
    value_text:
      source.value_text === null || typeof source.value_text === "undefined"
        ? null
        : asText(source.value_text).trim(),
    confidence,
    applied: asBoolean(source.applied),
    reason: asText(source.reason).trim(),
  };
}

function normalizeVoiceAudit(raw: unknown): ActiveSessionVoiceCommandAudit[] {
  if (!Array.isArray(raw)) return [];
  const entries = raw
    .map(normalizeVoiceAuditEntry)
    .filter((entry): entry is ActiveSessionVoiceCommandAudit => entry !== null);
  if (entries.length <= MAX_VOICE_AUDIT_ENTRIES) return entries;
  return entries.slice(entries.length - MAX_VOICE_AUDIT_ENTRIES);
}

function normalizeDraft(raw: unknown): ActiveSessionDraft | null {
  const source = asRecord(raw);
  if (!source) return null;
  const athleteId = asText(source.athleteId).trim();
  if (!athleteId) return null;
  const step = source.step === "capture_session" ? "capture_session" : "pick_routine";
  const rawExercises = Array.isArray(source.routineExercises) ? source.routineExercises : [];
  const routineExercises = rawExercises.map(normalizeExercise).filter((item): item is ActiveSessionExerciseDraft => item !== null);
  return {
    athleteId,
    routineId: asText(source.routineId),
    routineName: asText(source.routineName),
    step,
    startLocal: asText(source.startLocal),
    notes: asText(source.notes),
    sleepScore: asNumber(source.sleepScore, 7),
    stressScore: asNumber(source.stressScore, 5),
    sensationScore: asNumber(source.sensationScore, 7),
    routineExercises,
    sessionTimer: normalizeSessionTimer(source.sessionTimer),
    restTimer: normalizeRestTimer(source.restTimer),
    voiceAudit: normalizeVoiceAudit(source.voiceAudit),
    voiceUsed: asBoolean(source.voiceUsed, false),
    updatedAtMs: asTimestamp(source.updatedAtMs) ?? Date.now(),
  };
}

function readStoredDraft(): ActiveSessionDraft | null {
  const raw = loadJSON<unknown>(KEY, null);
  if (raw === null) return null;
  try {
    return normalizeDraft(raw);
  } catch {
    return null;
  }
}

function writeStoredDraft(next: ActiveSessionDraft | null): void {
  if (!next) {
    removeKey(KEY);
    return;
  }
  // Si falla (cuota), la sesión sigue en memoria; saveJSON no tumba la captura.
  saveJSON(KEY, next);
}

function findFirstPendingSet(exercises: ActiveSessionExerciseDraft[]): { exerciseIndex: number; setIndex: number } | null {
  for (const [exerciseIndex, exercise] of exercises.entries()) {
    for (const [setIndex, set] of exercise.sets.entries()) {
      if (!set.completed) return { exerciseIndex, setIndex };
    }
  }
  return null;
}

function buildLiveActivityState(draft: ActiveSessionDraft | null): SessionLiveActivityState | null {
  if (!draft || draft.step !== "capture_session" || draft.sessionTimer.completed_at_ms !== null) return null;
  const pending = findFirstPendingSet(draft.routineExercises);
  const current = draft.routineExercises[pending?.exerciseIndex ?? draft.routineExercises.length - 1];
  const setsAll = draft.routineExercises.reduce((acc, ex) => acc + ex.sets.length, 0);
  const setsDone = draft.routineExercises.reduce((acc, ex) => acc + ex.sets.filter((s) => s.completed).length, 0);
  const timer = draft.sessionTimer;
  const running = timer.running_since_ms !== null;
  const rest = draft.restTimer;
  return {
    routineName: draft.routineName,
    exerciseName: pending ? (current?.name ?? "") : "Sesión completa",
    setNumber: pending ? pending.setIndex + 1 : (current?.sets.length ?? 0),
    setTotal: current?.sets.length ?? 0,
    setsDone,
    setsAll,
    elapsedAnchorMs: timer.running_since_ms === null ? null : timer.running_since_ms - timer.accumulated_ms,
    elapsedPausedMs: running ? 0 : timer.accumulated_ms,
    // Puede estar en el pasado (descanso ya terminado): la vista nativa lo trata como "sin descanso".
    restEndsAtMs: rest ? rest.ends_at_ms : null,
  };
}

export function ActiveSessionProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<ActiveSessionDraft | null>(() => readStoredDraft());

  useEffect(() => {
    writeStoredDraft(draft);
  }, [draft]);

  // Efectos nativos de la sesion (aviso de fin de descanso y Live Activity).
  // Viven aqui y no en NewSession: ActiveSessionBar completa series con esa pantalla
  // desmontada. Sin cleanup a proposito: al salir de la pantalla deben seguir vivos.
  const restEndsAtMs = draft?.restTimer?.ends_at_ms ?? null;
  const restExerciseName = draft?.restTimer?.exercise_name ?? "";
  useEffect(() => {
    if (restEndsAtMs === null) {
      void cancelRestNotification();
      return;
    }
    void scheduleRestNotification(restEndsAtMs, restExerciseName);
  }, [restEndsAtMs, restExerciseName]);

  // Solo eventos discretos (serie, descanso, pausa): la clave cambia ahi y no en cada tick.
  const liveState = useMemo(() => buildLiveActivityState(draft), [draft]);
  const liveKey = liveState ? JSON.stringify(liveState) : "";
  useEffect(() => {
    if (!liveKey) {
      void endSessionLiveActivity();
      return;
    }
    void syncSessionLiveActivity(JSON.parse(liveKey) as SessionLiveActivityState);
  }, [liveKey]);

  const saveDraft = useCallback((nextDraft: ActiveSessionDraft) => {
    setDraft({ ...nextDraft, updatedAtMs: Date.now() });
  }, []);

  const clearDraft = useCallback(() => {
    setDraft(null);
  }, []);

  const completeFirstPendingSet = useCallback(() => {
    setDraft((prev) => {
      if (!prev || prev.step !== "capture_session") return prev;
      const pending = findFirstPendingSet(prev.routineExercises);
      if (!pending) return prev;

      const nextExercises = prev.routineExercises.map((exercise, exerciseIndex) => {
        if (exerciseIndex !== pending.exerciseIndex) return exercise;
        return {
          ...exercise,
          sets: exercise.sets.map((set, setIndex) =>
            setIndex === pending.setIndex ? { ...set, completed: true } : set,
          ),
        };
      });

      const exercise = prev.routineExercises[pending.exerciseIndex];
      const restDuration = exercise?.rest_seconds || 0;
      const now = Date.now();
      const nextRestTimer =
        restDuration > 0
          ? {
              exercise_index: pending.exerciseIndex,
              set_index: pending.setIndex,
              exercise_name: exercise?.name || "Ejercicio",
              duration_seconds: restDuration,
              started_at_ms: now,
              ends_at_ms: now + restDuration * 1_000,
              notified: false,
            }
          : null;

      return {
        ...prev,
        routineExercises: nextExercises,
        restTimer: nextRestTimer,
        updatedAtMs: now,
      };
    });
  }, []);

  const value = useMemo<ActiveSessionContextValue>(
    () => ({
      draft,
      saveDraft,
      clearDraft,
      completeFirstPendingSet,
    }),
    [clearDraft, completeFirstPendingSet, draft, saveDraft],
  );

  return <ActiveSessionContext.Provider value={value}>{children}</ActiveSessionContext.Provider>;
}

export function useActiveSession(): ActiveSessionContextValue {
  const ctx = useContext(ActiveSessionContext);
  if (!ctx) throw new Error("useActiveSession must be used inside ActiveSessionProvider");
  return ctx;
}
