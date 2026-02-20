import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";

import { ingestSessions } from "../api";
import { loadRoutines } from "../lib/storage";
import type { RoutineExerciseTemplate, RoutineTemplate } from "../lib/storage";
import { toKg } from "../lib/units";
import { useAthleteAccess, useAthleteId } from "../state/athlete";
import { usePreferences } from "../state/preferences";

type SetRow = { reps: string; load: string; completed: boolean; effort: string };
type RoutineExerciseDraft = { name: string; target_reps_min: number; target_reps_max: number; rest_seconds: number; sets: SetRow[] };
type SessionStep = "pick_routine" | "capture_session";

type SessionTimerState = {
  started_at_ms: number | null;
  running_since_ms: number | null;
  accumulated_ms: number;
  completed_at_ms: number | null;
};

type RestTimerState = {
  exercise_index: number;
  set_index: number;
  exercise_name: string;
  duration_seconds: number;
  started_at_ms: number;
  ends_at_ms: number;
  notified: boolean;
};

type NotificationCapability = NotificationPermission | "unsupported";

type SessionDraftCommand =
  | { type: "set_reps"; exercise_index: number; set_index: number; value: string }
  | { type: "set_load"; exercise_index: number; set_index: number; value: string }
  | { type: "set_set_completed"; exercise_index: number; set_index: number; value: boolean }
  | { type: "set_set_effort"; exercise_index: number; set_index: number; value: string };

const EMPTY_SET: SetRow = { reps: "", load: "", completed: false, effort: "" };
const WELLNESS_MIN_SCORE = 1;
const WELLNESS_MAX_SCORE = 10;
const WELLNESS_STEP = 0.1;
const WELLNESS_TICKS = Array.from(
  { length: WELLNESS_MAX_SCORE - WELLNESS_MIN_SCORE + 1 },
  (_, index) => WELLNESS_MIN_SCORE + index,
);
const WELLNESS_LABEL_POINTS = [
  { score: 2, label: "muy malo" },
  { score: 4.5, label: "malo" },
  { score: 6.5, label: "bueno" },
  { score: 9, label: "excelente" },
] as const;
const STRESS_LABEL_POINTS = [
  { score: 2, label: "bajo" },
  { score: 4.5, label: "medio-bajo" },
  { score: 6.5, label: "medio-alto" },
  { score: 9, label: "alto" },
] as const;
const IDLE_SESSION_TIMER: SessionTimerState = {
  started_at_ms: null,
  running_since_ms: null,
  accumulated_ms: 0,
  completed_at_ms: null,
};
const TICK_MS = 1_000;

function toISOZ(datetimeLocal: string): string {
  const d = new Date(datetimeLocal);
  return d.toISOString();
}

function deviceDatetimeLocal(): string {
  const now = new Date();
  const timezoneOffsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
}

function formatTimer(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatRepsRange(min: number, max: number): string {
  if (min === max) return String(min);
  return `${min}-${max}`;
}

function formatRestRecommendation(restSeconds: number): string {
  if (restSeconds <= 0) return "Sin descanso";
  return `${restSeconds}s`;
}

function detectNotificationCapability(): NotificationCapability {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

function defaultSetForExercise(): SetRow {
  return {
    reps: "",
    load: "",
    completed: false,
    effort: "",
  };
}

function normalizeRoutineExercises(source: RoutineExerciseTemplate[]): RoutineExerciseTemplate[] {
  const seen = new Set<string>();
  const out: RoutineExerciseTemplate[] = [];
  for (const raw of source) {
    const name = raw.name.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      target_sets: Math.max(1, Math.min(30, Math.round(raw.target_sets || 1))),
      target_reps_min: Math.max(1, Math.min(100, Math.round(raw.target_reps_min || 1))),
      target_reps_max: Math.max(1, Math.min(100, Math.round(raw.target_reps_max || 1))),
      rest_seconds: Math.max(0, Math.min(900, Math.round(raw.rest_seconds || 0))),
    });
  }
  return out.map((exercise) => ({
    ...exercise,
    target_reps_min: Math.min(exercise.target_reps_min, exercise.target_reps_max),
    target_reps_max: Math.max(exercise.target_reps_min, exercise.target_reps_max),
  }));
}

function routineToDraft(routine: RoutineTemplate): RoutineExerciseDraft[] {
  return normalizeRoutineExercises(routine.exercises).map((exercise) => ({
    name: exercise.name,
    target_reps_min: exercise.target_reps_min,
    target_reps_max: exercise.target_reps_max,
    rest_seconds: exercise.rest_seconds,
    sets: Array.from({ length: exercise.target_sets }, () => defaultSetForExercise()),
  }));
}

function createRunningSessionTimer(nowMs: number): SessionTimerState {
  return {
    started_at_ms: nowMs,
    running_since_ms: nowMs,
    accumulated_ms: 0,
    completed_at_ms: null,
  };
}

function computeSessionElapsedMs(timer: SessionTimerState, nowMs: number): number {
  const chunkMs = timer.running_since_ms === null ? 0 : Math.max(0, nowMs - timer.running_since_ms);
  return Math.max(0, timer.accumulated_ms + chunkMs);
}

function pauseSessionTimerState(timer: SessionTimerState, nowMs: number): SessionTimerState {
  if (timer.running_since_ms === null || timer.completed_at_ms !== null) return timer;
  return {
    ...timer,
    running_since_ms: null,
    accumulated_ms: computeSessionElapsedMs(timer, nowMs),
  };
}

function resumeSessionTimerState(timer: SessionTimerState, nowMs: number): SessionTimerState {
  if (timer.completed_at_ms !== null) return timer;
  if (timer.running_since_ms !== null) return timer;
  if (timer.started_at_ms === null) {
    return createRunningSessionTimer(nowMs);
  }
  return {
    ...timer,
    running_since_ms: nowMs,
  };
}

function completeSessionTimerState(timer: SessionTimerState, nowMs: number): SessionTimerState {
  if (timer.completed_at_ms !== null) return timer;
  const elapsedMs = computeSessionElapsedMs(timer, nowMs);
  return {
    started_at_ms: timer.started_at_ms ?? nowMs,
    running_since_ms: null,
    accumulated_ms: elapsedMs,
    completed_at_ms: nowMs,
  };
}

function parseSetEffortValue(
  value: string,
  scale: "rpe" | "rir",
): {
  valid: boolean;
  hasValue: boolean;
  raw: number | null;
  rpe: number | null;
  rir: number | null;
} {
  const trimmed = value.trim();
  if (!trimmed) {
    return { valid: true, hasValue: false, raw: null, rpe: null, rir: null };
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { valid: false, hasValue: true, raw: null, rpe: null, rir: null };
  }

  if (scale === "rpe") {
    if (parsed < 0 || parsed > 10) {
      return { valid: false, hasValue: true, raw: parsed, rpe: null, rir: null };
    }
    const rounded = Number(parsed.toFixed(2));
    return { valid: true, hasValue: true, raw: rounded, rpe: rounded, rir: null };
  }

  if (parsed < 0 || parsed > 6) {
    return { valid: false, hasValue: true, raw: parsed, rpe: null, rir: null };
  }
  const roundedRir = Number(parsed.toFixed(2));
  const convertedRpe = Number(Math.max(0, Math.min(10, 10 - roundedRir)).toFixed(2));
  return { valid: true, hasValue: true, raw: roundedRir, rpe: convertedRpe, rir: roundedRir };
}

function clampWellnessScore(value: number): number {
  if (!Number.isFinite(value)) return WELLNESS_MIN_SCORE;
  return Math.max(WELLNESS_MIN_SCORE, Math.min(WELLNESS_MAX_SCORE, value));
}

function parseWellnessScore(rawValue: string): number {
  return Number(clampWellnessScore(Number(rawValue)).toFixed(1));
}

function wellnessLabelFromScore(score: number): string {
  if (score >= 8) return "excelente";
  if (score >= 6) return "bueno";
  if (score >= 4) return "malo";
  return "muy malo";
}

function stressLabelFromScore(score: number): string {
  if (score >= 8) return "alto";
  if (score >= 6) return "medio-alto";
  if (score >= 4) return "medio-bajo";
  return "bajo";
}

function formatWellnessScore(score: number): string {
  return Number(clampWellnessScore(score).toFixed(1)).toFixed(1);
}

function wellnessTickOffset(score: number): string {
  const ratio = (score - WELLNESS_MIN_SCORE) / (WELLNESS_MAX_SCORE - WELLNESS_MIN_SCORE);
  return `${Math.max(0, Math.min(1, ratio)) * 100}%`;
}

function wellnessProgress(score: number): string {
  const ratio = (clampWellnessScore(score) - WELLNESS_MIN_SCORE) / (WELLNESS_MAX_SCORE - WELLNESS_MIN_SCORE);
  return `${Math.max(0, Math.min(1, ratio)) * 100}%`;
}

function wellnessSliderStyle(score: number): CSSProperties {
  return { "--wellness-progress": wellnessProgress(score) } as CSSProperties;
}

export default function NewSession() {
  const { athleteIds, canSwitch, ready: athleteReady } = useAthleteAccess();
  const [athleteId] = useAthleteId();
  const { prefs } = usePreferences();
  const nav = useNavigate();

  const [step, setStep] = useState<SessionStep>("pick_routine");
  const [startLocal, setStartLocal] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [sleepScore, setSleepScore] = useState<number>(7);
  const [stressScore, setStressScore] = useState<number>(5);
  const [sensationScore, setSensationScore] = useState<number>(7);

  const [routineId, setRoutineId] = useState<string>("");
  const [routines, setRoutines] = useState<RoutineTemplate[]>([]);
  const [routineExercises, setRoutineExercises] = useState<RoutineExerciseDraft[]>([]);

  const [sessionTimer, setSessionTimer] = useState<SessionTimerState>(IDLE_SESSION_TIMER);
  const [restTimer, setRestTimer] = useState<RestTimerState | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [notificationCapability, setNotificationCapability] = useState<NotificationCapability>(() => detectNotificationCapability());

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  const restTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!athleteId) {
      setRoutines([]);
      setRoutineId("");
      setRoutineExercises([]);
      setStep("pick_routine");
      setSleepScore(7);
      setStressScore(5);
      setSensationScore(7);
      setSessionTimer(IDLE_SESSION_TIMER);
      setRestTimer(null);
      return;
    }

    setRoutines(loadRoutines(athleteId));
    setRoutineId("");
    setRoutineExercises([]);
    setStep("pick_routine");
    setSleepScore(7);
    setStressScore(5);
    setSensationScore(7);
    setSessionTimer(IDLE_SESSION_TIMER);
    setRestTimer(null);
  }, [athleteId]);

  const sortedRoutines = useMemo(() => [...routines].sort((a, b) => a.name.localeCompare(b.name)), [routines]);
  const selectedRoutine = useMemo(() => sortedRoutines.find((routine) => routine.id === routineId) || null, [routineId, sortedRoutines]);
  const sessionElapsedMs = useMemo(() => computeSessionElapsedMs(sessionTimer, nowMs), [sessionTimer, nowMs]);
  const sessionElapsedSec = useMemo(() => Math.floor(sessionElapsedMs / 1000), [sessionElapsedMs]);
  const sessionTimerRunning = sessionTimer.running_since_ms !== null && sessionTimer.completed_at_ms === null;
  const sessionTimerCompleted = sessionTimer.completed_at_ms !== null;
  const sessionTimerStarted = sessionTimer.started_at_ms !== null;
  const restRemainingSec = useMemo(() => {
    if (!restTimer) return 0;
    return Math.max(0, Math.ceil((restTimer.ends_at_ms - nowMs) / 1_000));
  }, [nowMs, restTimer]);
  const allSetsCompleted = useMemo(
    () => routineExercises.length > 0 && routineExercises.every((exercise) => exercise.sets.length > 0 && exercise.sets.every((set) => set.completed)),
    [routineExercises],
  );
  const restProgressPct = useMemo(() => {
    if (!restTimer || restTimer.duration_seconds <= 0) return 0;
    const elapsedMs = Math.max(0, nowMs - restTimer.started_at_ms);
    return Math.min(100, Math.round((elapsedMs / (restTimer.duration_seconds * 1_000)) * 100));
  }, [nowMs, restTimer]);
  const sessionRpeAuto = useMemo(() => {
    const samples: number[] = [];
    for (const exercise of routineExercises) {
      for (const set of exercise.sets) {
        const parsed = parseSetEffortValue(set.effort, prefs.effortScale);
        if (!parsed.valid || !parsed.hasValue || parsed.rpe === null) continue;
        samples.push(parsed.rpe);
      }
    }
    if (samples.length === 0) return null;
    return Number((samples.reduce((acc, item) => acc + item, 0) / samples.length).toFixed(2));
  }, [prefs.effortScale, routineExercises]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const syncNow = () => setNowMs(Date.now());
    const onVisibility = () => {
      if (document.visibilityState === "visible") syncNow();
    };
    window.addEventListener("focus", syncNow);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", syncNow);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    setNotificationCapability(detectNotificationCapability());
  }, []);

  useEffect(() => {
    if (restTimeoutRef.current !== null) {
      window.clearTimeout(restTimeoutRef.current);
      restTimeoutRef.current = null;
    }
    if (!restTimer) return;
    const delayMs = Math.max(0, restTimer.ends_at_ms - Date.now());
    restTimeoutRef.current = window.setTimeout(() => setNowMs(Date.now()), delayMs + 30);
    return () => {
      if (restTimeoutRef.current !== null) {
        window.clearTimeout(restTimeoutRef.current);
        restTimeoutRef.current = null;
      }
    };
  }, [restTimer]);

  useEffect(() => {
    if (!restTimer || restRemainingSec > 0 || restTimer.notified) return;
    setRestTimer((prev) => {
      if (!prev || prev.notified) return prev;
      return { ...prev, notified: true };
    });
    if (notificationCapability === "granted" && "Notification" in window) {
      try {
        new Notification("Descanso finalizado", {
          body: `Continua con el siguiente ejercicio. Ultimo completado: ${restTimer.exercise_name}.`,
        });
      } catch {
        // El navegador puede bloquear notificaciones en segundo plano.
      }
    }
  }, [notificationCapability, restRemainingSec, restTimer]);

  async function requestDeviceNotifications() {
    if (!("Notification" in window)) {
      setNotificationCapability("unsupported");
      return;
    }
    if (Notification.permission === "granted") {
      setNotificationCapability("granted");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      setNotificationCapability(permission);
    } catch {
      setNotificationCapability(detectNotificationCapability());
    }
  }

  function onWellnessChange(setter: (value: number) => void, rawValue: string) {
    setter(parseWellnessScore(rawValue));
  }

  function applyRoutine(nextRoutineId: string) {
    setRoutineId(nextRoutineId);
    setError("");
    const routine = sortedRoutines.find((item) => item.id === nextRoutineId);
    if (!routine) {
      setRoutineExercises([]);
      return;
    }
    const draft = routineToDraft(routine);
    setRoutineExercises(draft);
  }

  function startRestForSet(exerciseIndex: number, setIndex: number) {
    const exercise = routineExercises[exerciseIndex];
    if (!exercise) return;
    if (exercise.rest_seconds <= 0) {
      setRestTimer(null);
      return;
    }
    const now = Date.now();
    setNowMs(now);
    setRestTimer({
      exercise_index: exerciseIndex,
      set_index: setIndex,
      exercise_name: exercise.name,
      duration_seconds: exercise.rest_seconds,
      started_at_ms: now,
      ends_at_ms: now + exercise.rest_seconds * 1_000,
      notified: false,
    });
    if (notificationCapability === "default") {
      void requestDeviceNotifications();
    }
  }

  function startSessionStep() {
    if (!selectedRoutine) {
      setError("Selecciona una rutina para comenzar la sesion.");
      return;
    }

    setError("");
    const draft = routineToDraft(selectedRoutine);
    setRoutineExercises(draft);
    setStartLocal(deviceDatetimeLocal());
    setStep("capture_session");
    const now = Date.now();
    setNowMs(now);
    setSessionTimer(createRunningSessionTimer(now));
    setRestTimer(null);
  }

  function goBackToRoutineStep() {
    setStep("pick_routine");
    setSessionTimer(IDLE_SESSION_TIMER);
    setRestTimer(null);
    setError("");
  }

  function startOrResumeSessionTimer() {
    const now = Date.now();
    setNowMs(now);
    setError("");
    setSessionTimer((prev) => resumeSessionTimerState(prev, now));
  }

  function pauseSessionTimer() {
    const now = Date.now();
    setNowMs(now);
    setSessionTimer((prev) => pauseSessionTimerState(prev, now));
  }

  function resetSessionTimer(autostart: boolean) {
    const now = Date.now();
    setNowMs(now);
    setError("");
    setSessionTimer(
      autostart
        ? createRunningSessionTimer(now)
        : {
            started_at_ms: now,
            running_since_ms: null,
            accumulated_ms: 0,
            completed_at_ms: null,
          },
    );
    setRestTimer(null);
  }

  function completeSession() {
    const now = Date.now();
    setNowMs(now);
    setSessionTimer((prev) => completeSessionTimerState(prev, now));
    setRestTimer(null);
  }

  function clearRestTimer() {
    setRestTimer(null);
  }

  function addSet(exIdx: number) {
    setRoutineExercises((prev) =>
      prev.map((entry, i) =>
        i === exIdx
          ? {
              ...entry,
              sets: [
                ...entry.sets,
                {
                  reps: "",
                  load: "",
                  completed: false,
                  effort: "",
                },
              ],
            }
          : entry,
      ),
    );
  }

  function duplicateLastSet(exIdx: number) {
    setRoutineExercises((prev) =>
      prev.map((entry, i) => {
        if (i !== exIdx) return entry;
        const last = entry.sets[entry.sets.length - 1] || EMPTY_SET;
        return { ...entry, sets: [...entry.sets, { ...last }] };
      }),
    );
  }

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

  // Handler unico para futura integracion de comandos por voz.
  function applySessionDraftCommand(command: SessionDraftCommand) {
    setRoutineExercises((prev) =>
      prev.map((entry, exIdx) => {
        if (exIdx !== command.exercise_index) return entry;
        if (command.set_index < 0 || command.set_index >= entry.sets.length) return entry;
        const sets = entry.sets.map((set, setIdx) => {
          if (setIdx !== command.set_index) return set;
          if (command.type === "set_reps") return { ...set, reps: command.value };
          if (command.type === "set_load") return { ...set, load: command.value };
          if (command.type === "set_set_completed") return { ...set, completed: command.value };
          return { ...set, effort: command.value };
        });
        return { ...entry, sets };
      }),
    );

    if (command.type === "set_set_completed") {
      if (command.value) {
        startRestForSet(command.exercise_index, command.set_index);
        return;
      }

      setRestTimer((prev) => {
        if (!prev) return prev;
        if (prev.exercise_index !== command.exercise_index || prev.set_index !== command.set_index) return prev;
        return null;
      });
    }
  }

  function resetRoutineSets() {
    if (!selectedRoutine) return;
    const draft = routineToDraft(selectedRoutine);
    setRoutineExercises(draft);
    setRestTimer(null);
  }

  async function submit() {
    setError("");

    if (!athleteId) {
      setError("No hay atleta activo para registrar la sesion.");
      return;
    }

    if (!selectedRoutine) {
      setError("Selecciona una rutina para registrar la sesion.");
      return;
    }

    if (!startLocal) {
      setError("Falta fecha/hora de inicio.");
      return;
    }

    const now = Date.now();
    const finalizedTimer = sessionTimer.completed_at_ms === null ? completeSessionTimerState(sessionTimer, now) : sessionTimer;
    const elapsedMinutes = Number((computeSessionElapsedMs(finalizedTimer, now) / 60_000).toFixed(2));
    if (!Number.isFinite(elapsedMinutes) || elapsedMinutes <= 0) {
      setError("Inicia la sesion y espera al menos un segundo antes de guardar.");
      return;
    }

    const exercisesOut: Array<{
      name: string;
      sets: Array<{
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
      }>;
      meta: {
        exercise_index: number;
        completed: boolean;
        target_reps_min: number;
        target_reps_max: number;
        target_rest_seconds: number;
      };
    }> = [];
    for (const [exerciseIndex, entry] of routineExercises.entries()) {
      const sets: Array<{
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
      }> = [];
      for (const [setIndex, set] of entry.sets.entries()) {
        const reps = Number(set.reps);
        const loadValue = Number(set.load);
        if (!Number.isFinite(reps) || reps <= 0 || !Number.isFinite(loadValue) || loadValue < 0) continue;

        const parsedEffort = parseSetEffortValue(set.effort, prefs.effortScale);
        if (!parsedEffort.valid) {
          setError(
            `${prefs.effortScale.toUpperCase()} invalido en ${entry.name}, set ${setIndex + 1} (usa ${
              prefs.effortScale === "rir" ? "0-6" : "0-10"
            }).`,
          );
          return;
        }
        if (!parsedEffort.hasValue) {
          setError(`${prefs.effortScale.toUpperCase()} requerido en ${entry.name}, set ${setIndex + 1}.`);
          return;
        }

        sets.push({
          reps,
          load_kg: Number(toKg(loadValue, prefs.weightUnit).toFixed(3)),
          rpe: parsedEffort.rpe ?? undefined,
          rir: parsedEffort.rir ?? undefined,
          meta: {
            set_index: setIndex + 1,
            completed: set.completed,
            effort_scale: prefs.effortScale,
            effort_value: parsedEffort.raw ?? undefined,
          },
        });
      }

      if (sets.length === 0) {
        setError(`Completa al menos 1 set valido en "${entry.name}".`);
        return;
      }

      exercisesOut.push({
        name: entry.name,
        sets,
        meta: {
          exercise_index: exerciseIndex + 1,
          completed: entry.sets.every((set) => set.completed),
          target_reps_min: entry.target_reps_min,
          target_reps_max: entry.target_reps_max,
          target_rest_seconds: entry.rest_seconds,
        },
      });
    }

    const payload = [
      {
        athlete_id: athleteId,
        start_time: toISOZ(startLocal),
        duration_min: elapsedMinutes,
        rpe: sessionRpeAuto ?? undefined,
        modality: "strength",
        exercises: exercisesOut,
        source: "ui_routine",
        meta: {
          note: notes || undefined,
          routine_id: selectedRoutine.id,
          routine_name: selectedRoutine.name,
          effort_summary: {
            scale: prefs.effortScale,
            source: "auto_from_sets",
            computed_session_rpe: sessionRpeAuto,
          },
          weight_unit_input: prefs.weightUnit,
          session_completed_at_utc: finalizedTimer.completed_at_ms ? new Date(finalizedTimer.completed_at_ms).toISOString() : undefined,
          session_elapsed_seconds: Math.floor(computeSessionElapsedMs(finalizedTimer, now) / 1_000),
          session_all_exercises_completed: allSetsCompleted,
          session_all_series_completed: allSetsCompleted,
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
            voice_ready: true,
            supported_commands: [
              "set_reps",
              "set_load",
              "set_set_completed",
              "set_set_effort",
            ],
          },
        },
      },
    ];

    setSessionTimer(finalizedTimer);
    setRestTimer(null);
    setNowMs(now);

    setBusy(true);
    try {
      await ingestSessions(payload);
      nav("/history");
    } catch (cause: unknown) {
      setError(String((cause as { message?: string })?.message || cause));
    } finally {
      setBusy(false);
    }
  }

  const hasRoutines = sortedRoutines.length > 0;
  const hasActiveAthlete = Boolean(athleteId);

  if (step === "pick_routine") {
    return (
      <div className="container stack">
        <header className="titleBlock">
          <h1>Nueva sesion</h1>
          <p>Paso 1/2. Selecciona una rutina para iniciar el registro.</p>
        </header>

        <section className="surface">
          <div className="chipRow">
            <span className="chip">Escala: {prefs.effortScale.toUpperCase()}</span>
            <span className="chip">Carga: {prefs.weightUnit}</span>
            <span className="chip">Rutinas: {sortedRoutines.length}</span>
          </div>

          {error ? (
            <div className="message error" style={{ marginTop: 12 }}>
              {error}
            </div>
          ) : null}

          {!hasRoutines ? (
            <div className="emptyState" style={{ marginTop: 12 }}>
              No hay rutinas creadas. Crea al menos una rutina para registrar sesiones.
              <div className="quickActions" style={{ marginTop: 10 }}>
                <button className="btn primary" onClick={() => nav("/routines")}>
                  Ir a rutinas
                </button>
              </div>
            </div>
          ) : canSwitch && athleteReady && athleteIds.length === 0 ? (
            <div className="emptyState" style={{ marginTop: 12 }}>
              No tienes atletas asignados. Pide a un admin que te asigne al menos uno para poder registrar sesiones.
            </div>
          ) : (
            <div className="stack" style={{ marginTop: 12 }}>
              <div>
                <label className="smallLabel">Rutina</label>
                <select className="input" value={routineId} onChange={(e) => applyRoutine(e.target.value)}>
                  <option value="">Selecciona una rutina...</option>
                  {sortedRoutines.map((routine) => (
                    <option key={routine.id} value={routine.id}>
                      {routine.name} ({routine.exercises.length})
                    </option>
                  ))}
                </select>
              </div>

              <div className="quickActions">
                <button className="btn primary" onClick={startSessionStep} disabled={!selectedRoutine || !hasActiveAthlete}>
                  Continuar a datos de sesion
                </button>
                <button className="btn" onClick={() => nav("/routines")}>
                  Gestionar rutinas
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    );
  }

  const timerStatus = sessionTimerRunning ? "En curso" : sessionTimerCompleted ? "Completada" : sessionTimerStarted ? "Pausada" : "Sin iniciar";
  const timerActionLabel = sessionTimerStarted ? "Reanudar" : "Iniciar";
  const notificationLabel =
    notificationCapability === "unsupported"
      ? "No disponible en este dispositivo"
      : notificationCapability === "granted"
      ? "Activas"
      : notificationCapability === "denied"
      ? "Bloqueadas"
      : "Pendientes";

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Sesion por rutina</h1>
      </header>

      <section className="surface">
        <div className="chipRow">
          <span className="chip">Escala: {prefs.effortScale.toUpperCase()}</span>
          <span className="chip">Carga: {prefs.weightUnit}</span>
          <span className="chip">Rutina: {selectedRoutine?.name || "-"}</span>
        </div>

        {error ? (
          <div className="message error" style={{ marginTop: 12 }}>
            {error}
          </div>
        ) : null}

        <div className="quickActions" style={{ marginTop: 12 }}>
          <button className="btn" onClick={goBackToRoutineStep}>
            Cambiar rutina
          </button>
          <button className="btn" onClick={() => nav("/routines")}>
            Gestionar rutinas
          </button>
          <button className="btn" onClick={resetRoutineSets} disabled={!selectedRoutine}>
            Reiniciar sets
          </button>
        </div>
      </section>

      <section className="surface">
        <div className="sectionHead">
          <h3>Datos de la rutina</h3>
        </div>

        <div className="splitGrid" style={{ marginTop: 10 }}>
          <div>
            <label className="smallLabel">Inicio</label>
            <input
              className="input"
              type="datetime-local"
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
            />
          </div>
        </div>

        <div className="wellnessPanel" style={{ marginTop: 12 }}>
          <div className="sectionHead">
            <h4>Estado diario</h4>
          </div>
          <div className="wellnessStack" style={{ marginTop: 10 }}>
            <div className="wellnessField">
              <div className="wellnessFieldHead">
                <label className="smallLabel">Sueno</label>
                <span className="chip">{`${formatWellnessScore(sleepScore)} / 10 - ${wellnessLabelFromScore(sleepScore)}`}</span>
              </div>
              <input
                className="wellnessSlider"
                type="range"
                min={WELLNESS_MIN_SCORE}
                max={WELLNESS_MAX_SCORE}
                step={WELLNESS_STEP}
                value={sleepScore}
                style={wellnessSliderStyle(sleepScore)}
                onChange={(e) => onWellnessChange(setSleepScore, e.target.value)}
              />
              <div className="wellnessTicks">
                {WELLNESS_TICKS.map((tick) => (
                  <div
                    key={`sleep_tick_${tick}`}
                    className={`wellnessTick ${tick === WELLNESS_MIN_SCORE ? "wellnessTickMin" : tick === WELLNESS_MAX_SCORE ? "wellnessTickMax" : ""}`.trim()}
                    style={{ left: wellnessTickOffset(tick) }}
                  >
                    <span className="wellnessTickMark" aria-hidden="true" />
                    <span>{tick}</span>
                  </div>
                ))}
              </div>
              <div className="wellnessScale">
                {WELLNESS_LABEL_POINTS.map((item) => (
                  <div key={`sleep_label_${item.score}`} className="wellnessScaleItem" style={{ left: wellnessTickOffset(item.score) }}>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>

              <div className="wellnessField">
              <div className="wellnessFieldHead">
                <label className="smallLabel">Estres</label>
                <span className="chip">{`${formatWellnessScore(stressScore)} / 10 - ${stressLabelFromScore(stressScore)}`}</span>
              </div>
              <input
                className="wellnessSlider"
                type="range"
                min={WELLNESS_MIN_SCORE}
                max={WELLNESS_MAX_SCORE}
                step={WELLNESS_STEP}
                value={stressScore}
                style={wellnessSliderStyle(stressScore)}
                onChange={(e) => onWellnessChange(setStressScore, e.target.value)}
              />
              <div className="wellnessTicks">
                {WELLNESS_TICKS.map((tick) => (
                  <div
                    key={`stress_tick_${tick}`}
                    className={`wellnessTick ${tick === WELLNESS_MIN_SCORE ? "wellnessTickMin" : tick === WELLNESS_MAX_SCORE ? "wellnessTickMax" : ""}`.trim()}
                    style={{ left: wellnessTickOffset(tick) }}
                  >
                    <span className="wellnessTickMark" aria-hidden="true" />
                    <span>{tick}</span>
                  </div>
                ))}
              </div>
              <div className="wellnessScale">
                {STRESS_LABEL_POINTS.map((item) => (
                  <div key={`stress_label_${item.score}`} className="wellnessScaleItem" style={{ left: wellnessTickOffset(item.score) }}>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="wellnessField">
              <div className="wellnessFieldHead">
                <label className="smallLabel">Sensaciones</label>
                <span className="chip">{`${formatWellnessScore(sensationScore)} / 10 - ${wellnessLabelFromScore(sensationScore)}`}</span>
              </div>
              <input
                className="wellnessSlider"
                type="range"
                min={WELLNESS_MIN_SCORE}
                max={WELLNESS_MAX_SCORE}
                step={WELLNESS_STEP}
                value={sensationScore}
                style={wellnessSliderStyle(sensationScore)}
                onChange={(e) => onWellnessChange(setSensationScore, e.target.value)}
              />
              <div className="wellnessTicks">
                {WELLNESS_TICKS.map((tick) => (
                  <div
                    key={`sensations_tick_${tick}`}
                    className={`wellnessTick ${tick === WELLNESS_MIN_SCORE ? "wellnessTickMin" : tick === WELLNESS_MAX_SCORE ? "wellnessTickMax" : ""}`.trim()}
                    style={{ left: wellnessTickOffset(tick) }}
                  >
                    <span className="wellnessTickMark" aria-hidden="true" />
                    <span>{tick}</span>
                  </div>
                ))}
              </div>
              <div className="wellnessScale">
                {WELLNESS_LABEL_POINTS.map((item) => (
                  <div key={`sensations_label_${item.score}`} className="wellnessScaleItem" style={{ left: wellnessTickOffset(item.score) }}>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <label className="smallLabel">Comentarios</label>
          <input
            className="input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="comentarios adicionales de la sesion"
          />
        </div>

        <div className="surface" style={{ marginTop: 12, padding: 12 }}>
          <div className="sectionHead">
            <h4>Temporizador de sesion</h4>
          </div>
          <div className="timerValue" style={{ marginTop: 10 }}>
            {formatTimer(sessionElapsedSec)}
          </div>
          <div className="chipRow" style={{ marginTop: 8 }}>
            <span className="chip">Estado: {timerStatus}</span>
            {sessionTimer.completed_at_ms ? <span className="chip">{`Completada: ${new Date(sessionTimer.completed_at_ms).toLocaleTimeString()}`}</span> : null}
          </div>
          <div className="quickActions" style={{ marginTop: 10 }}>
            {sessionTimerRunning ? (
              <button className="btn primary" type="button" onClick={pauseSessionTimer}>
                Pausar temporizador
              </button>
            ) : (
              <button className="btn primary" type="button" onClick={startOrResumeSessionTimer}>
                {timerActionLabel}
              </button>
            )}
            <button className="btn" type="button" onClick={() => resetSessionTimer(true)}>
              Reiniciar
            </button>
            <button className="btn" type="button" onClick={completeSession} disabled={sessionTimerCompleted}>
              Completar sesion
            </button>
          </div>
        </div>

      </section>

      <section className="surface">
        <div className="sectionHead">
          <h3>Ejercicios de rutina</h3>
          <p>
            {selectedRoutine
              ? `Rutina activa: ${selectedRoutine.name}`
              : "Selecciona una rutina para capturar sets en cada ejercicio."}
          </p>
        </div>

        {allSetsCompleted && !sessionTimerCompleted ? (
          <div className="message" style={{ marginTop: 12 }}>
            Terminaste todas las series. Puedes completar la sesion para detener el cronometro.
            <div className="quickActions" style={{ marginTop: 10 }}>
              <button className="btn primary" type="button" onClick={completeSession}>
                Completar sesion
              </button>
            </div>
          </div>
        ) : null}

        {!selectedRoutine ? (
          <div className="emptyState" style={{ marginTop: 12 }}>
            Aun no seleccionaste una rutina.
          </div>
        ) : (
          <div className="stack" style={{ marginTop: 12 }}>
            {routineExercises.map((exercise, exIdx) => (
              <div key={`${selectedRoutine.id}_${exercise.name}_${exIdx}`} className="exerciseCard">
                <div className="hstack" style={{ justifyContent: "space-between" }}>
                  <div>
                    <label className="smallLabel">Ejercicio</label>
                    <strong>{exercise.name}</strong>
                  </div>
                  <span className="chip">Sets: {exercise.sets.length}</span>
                </div>
                <div className="chipRow" style={{ marginTop: 8 }}>
                  <span className="chip">{`Reps objetivo: ${formatRepsRange(exercise.target_reps_min, exercise.target_reps_max)}`}</span>
                  <span className="chip">{`Descanso recomendado: ${formatRestRecommendation(exercise.rest_seconds)}`}</span>
                </div>

                <div className="setGrid">
                  {exercise.sets.map((set, setIdx) => (
                    <div key={setIdx} className="setRowCard">
                      <div className="setRow">
                        <span className="setTag">Set {setIdx + 1}</span>
                        <div className="setFieldMini">
                          <label className="smallLabel">Peso</label>
                          <input
                            className="input setInputMini setInputWeight"
                            value={set.load}
                            onChange={(e) =>
                              applySessionDraftCommand({
                                type: "set_load",
                                exercise_index: exIdx,
                                set_index: setIdx,
                                value: e.target.value,
                              })
                            }
                            placeholder={prefs.weightUnit}
                          />
                        </div>
                        <div className="setFieldMini">
                          <label className="smallLabel">Reps</label>
                          <input
                            className="input setInputMini setInputReps"
                            value={set.reps}
                            onChange={(e) =>
                              applySessionDraftCommand({
                                type: "set_reps",
                                exercise_index: exIdx,
                                set_index: setIdx,
                                value: e.target.value,
                              })
                            }
                            placeholder={formatRepsRange(exercise.target_reps_min, exercise.target_reps_max)}
                          />
                        </div>
                        <div className="setFieldMini">
                          <label className="smallLabel">{prefs.effortScale === "rir" ? "RIR" : "RPE"}</label>
                          <input
                            className="input setInputMini setInputEffort"
                            value={set.effort}
                            onChange={(e) =>
                              applySessionDraftCommand({
                                type: "set_set_effort",
                                exercise_index: exIdx,
                                set_index: setIdx,
                                value: e.target.value,
                              })
                            }
                            placeholder={prefs.effortScale === "rir" ? "0-6" : "0-10"}
                          />
                        </div>
                        <button
                          className={`btn iconBtn setCompleteBtn completeIconBtn ${set.completed ? "active" : ""}`}
                          type="button"
                          aria-pressed={set.completed}
                          onClick={() =>
                            applySessionDraftCommand({
                              type: "set_set_completed",
                              exercise_index: exIdx,
                              set_index: setIdx,
                              value: !set.completed,
                            })
                          }
                          aria-label={set.completed ? "Serie completada" : "Marcar serie completada"}
                          title={set.completed ? "Serie completada" : "Marcar serie completada"}
                        >
                          <svg className="iconGlyph" viewBox="0 0 24 24" aria-hidden="true">
                            <circle cx="12" cy="12" r="9" />
                            <path d="M8.5 12.2L10.8 14.5L15.6 9.7" />
                          </svg>
                        </button>
                        <button
                          className="btn iconBtn trashBtn compactTrashBtn"
                          onClick={() => removeSet(exIdx, setIdx)}
                          disabled={exercise.sets.length <= 1}
                          type="button"
                          aria-label="Eliminar serie"
                          title="Eliminar serie"
                        >
                          <svg className="iconGlyph" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M3 6h18" />
                            <path d="M8 6V4h8v2" />
                            <path d="M19 6l-1 14H6L5 6" />
                            <path d="M10 10v7" />
                            <path d="M14 10v7" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="hstack compact">
                  <button className="btn" onClick={() => addSet(exIdx)}>
                    + Set vacio
                  </button>
                  <button className="btn" onClick={() => duplicateLastSet(exIdx)}>
                    + Duplicar ultimo set
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="surface">
        <div className="chipRow" style={{ marginBottom: 10 }}>
          <span className="chip">{`RPE sesion (auto): ${sessionRpeAuto === null ? "-" : sessionRpeAuto.toFixed(2)}`}</span>
          <span className="chip">{`Calculado desde ${prefs.effortScale.toUpperCase()} por serie`}</span>
        </div>
        <div className="hstack">
          <button className="btn primary" onClick={submit} disabled={busy || !selectedRoutine || !hasActiveAthlete}>
            {busy ? "Guardando..." : "Guardar sesion"}
          </button>
          <button className="btn" onClick={() => nav("/history")} disabled={busy}>
            Cancelar
          </button>
        </div>
      </section>

      {restTimer ? (
        <section className="restFloatBar" aria-live="polite">
          <div className="restFloatTop">
            <strong>Descanso entre series</strong>
            <span className="timerValue restFloatTimer">{formatTimer(restRemainingSec)}</span>
          </div>
          <div className="small">{`${restTimer.exercise_name} - Set ${restTimer.set_index + 1}`}</div>
          <div className="restFloatTrack" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={restProgressPct}>
            <div className="restFloatFill" style={{ width: `${restProgressPct}%` }} />
          </div>
          <div className="restFloatBottom">
            <span className="small">{restRemainingSec > 0 ? "En descanso" : "Listo para la siguiente serie"}</span>
            <div className="hstack compact">
              {notificationCapability !== "unsupported" && notificationCapability !== "granted" ? (
                <button className="btn" type="button" onClick={() => void requestDeviceNotifications()}>
                  Activar notificaciones
                </button>
              ) : null}
              <button className="btn" type="button" onClick={clearRestTimer}>
                Cerrar
              </button>
            </div>
          </div>
          <div className="small">{`Notificaciones: ${notificationLabel}`}</div>
        </section>
      ) : null}
    </div>
  );
}

