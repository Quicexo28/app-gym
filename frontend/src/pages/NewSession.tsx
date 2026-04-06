import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";

import { getVoiceTrainingConfig, ingestSessions } from "../api";
import HoloVoiceAssistantOverlay from "../components/HoloVoiceAssistantOverlay";
import { loadRoutines } from "../lib/storage";
import type { RoutineExerciseTemplate, RoutineTemplate } from "../lib/storage";
import {
  IDLE_SESSION_TIMER,
  TICK_MS,
  completeSessionTimerState,
  computeSessionElapsedMs,
  createRunningSessionTimer,
  detectNotificationCapability,
  formatTimer,
  pauseSessionTimerState,
  resumeSessionTimerState,
  type NotificationCapability,
  type RestTimerState,
  type SessionTimerState,
} from "../lib/session/timers";
import { useSessionClock } from "../lib/session/useSessionClock";
import { parseVoiceCommand, parseVoiceCommandBatch, parseVoiceSetTuple, type ParsedVoiceCommandBatch, type ParsedVoiceSetTuple } from "../lib/voice/commandParser";
import type { OfflineVoskRecognizer as OfflineVoskRecognizerClass } from "../lib/voice/offlineRecognizer";
import { findCurrentSetTarget } from "../lib/voice/setTarget";
import {
  applyVoicePhraseCorrections,
  loadVoiceTrainingProfile,
  saveVoiceTrainingProfile,
  type VoiceTrainingProfile,
} from "../lib/voice/training";
import type { OfflineRecognizerFinalTranscript, OfflineRecognizerState, ParsedVoiceCommand } from "../lib/voice/types";
import { extractWakePhraseFromCandidates } from "../lib/voice/wakePhrase";
import { toKg } from "../lib/units";
import type { ActiveSessionVoiceCommandAudit } from "../state/activeSession";
import { useActiveSession } from "../state/activeSession";
import { useAthleteAccess, useAthleteId } from "../state/athlete";
import { usePreferences } from "../state/preferences";
import { useUndo } from "../state/undo";

type SetRow = { reps: string; load: string; completed: boolean; effort: string };
type RoutineExerciseDraft = { name: string; target_reps_min: number; target_reps_max: number; rest_seconds: number; sets: SetRow[] };
type SessionStep = "pick_routine" | "capture_session";


type SessionDraftCommand =
  | { type: "set_reps"; exercise_index: number; set_index: number; value: string }
  | { type: "set_load"; exercise_index: number; set_index: number; value: string }
  | { type: "set_set_completed"; exercise_index: number; set_index: number; value: boolean }
  | { type: "set_set_effort"; exercise_index: number; set_index: number; value: string };

type VoiceTranscriptSource = "microphone";

type VoiceApplyOutcome = {
  applied: boolean;
  reason: string;
  intent: ActiveSessionVoiceCommandAudit["intent"];
  exercise_index: number | null;
  set_index: number | null;
  exercise_name: string | null;
  value_text: string | null;
  response_text: string | null;
};

type VoiceOrbMode = "docked_idle" | "focus_listening" | "error" | "muted";

type PendingSetDelete = {
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
const UNCHECK_SET_ANIMATION_MS = 700;
const DELETE_SET_ANIMATION_MS = 1_500;
const DELETE_SET_UNDO_TIMEOUT_MS = 7_000;
const MAX_VOICE_AUDIT_ENTRIES = 50;
const ENABLE_OFFLINE_VOICE_CAPTURE =
  ((import.meta.env.VITE_ENABLE_OFFLINE_VOICE_CAPTURE as string | undefined)?.trim().toLowerCase() ?? "") === "true";
const VOICE_ENGINE = "vosk-browser@0.0.8";
const VOICE_MODEL_ID = "vosk-model-small-es-0.42";
const VOICE_MODEL_URL = `/models/${VOICE_MODEL_ID}.zip`;
const VOICE_LANGUAGE = "es-ES";
const VOICE_WAKE_PHRASE = "prueba";
const VOICE_ASSIST_DESKTOP_KEY = "coach_ai_voice_assist_desktop_v1";
const MAX_WAKE_PHRASE_HINTS = 5;
const VOICE_WAKE_COMMAND_WINDOW_MS = 12_000;
const VOICE_ORB_COMMAND_FOCUS_MS = 900;
const VOICE_ORB_WAKE_BUFFER_MS = 1_200;
const VOICE_ASSISTANT_RESPONSE_MS = 2_400;
const VOICE_WAKE_PARTIAL_FOCUS_COOLDOWN_MS = 1_100;
const VOICE_ORB_DEPLOY_MIN_GAP_MS = 420;
const VOICE_WAKE_SOUND_COOLDOWN_MS = 1_200;

type VoiceSfxCue = "listen_start" | "listen_stop";

function readVoiceAssistDesktopPreference(): boolean {
  if (typeof window === "undefined") return true;
  const raw = window.localStorage.getItem(VOICE_ASSIST_DESKTOP_KEY);
  if (raw === "0") return false;
  if (raw === "1") return true;
  return true;
}

function normalizeWakePhrase(raw: string): string {
  return normalizeTranscriptText(raw).toLowerCase();
}

function buildWakePhraseCandidates(wakeAliases: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawWakePhrase of [VOICE_WAKE_PHRASE, ...wakeAliases]) {
    const wakePhrase = normalizeWakePhrase(rawWakePhrase);
    if (!wakePhrase || seen.has(wakePhrase)) continue;
    seen.add(wakePhrase);
    out.push(wakePhrase);
  }
  if (out.length === 0) return [VOICE_WAKE_PHRASE];
  return out;
}

function wakePhraseHintList(wakePhrases: string[]): string {
  return wakePhrases.slice(0, MAX_WAKE_PHRASE_HINTS).join(", ");
}

function normalizeTranscriptText(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clampVoiceConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function getVoiceSfxAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  const browserWindow = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return browserWindow.AudioContext ?? browserWindow.webkitAudioContext ?? null;
}

function scheduleVoiceSfxTone(
  context: AudioContext,
  options: {
    startAtS: number;
    durationMs: number;
    frequencyStartHz: number;
    frequencyEndHz?: number;
    gain: number;
    waveType?: OscillatorType;
  },
): number {
  const startAtS = options.startAtS;
  const durationS = Math.max(0.02, options.durationMs / 1000);
  const endAtS = startAtS + durationS;

  const oscillator = context.createOscillator();
  oscillator.type = options.waveType ?? "sine";
  oscillator.frequency.setValueAtTime(Math.max(40, options.frequencyStartHz), startAtS);
  if (typeof options.frequencyEndHz === "number" && Number.isFinite(options.frequencyEndHz)) {
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, options.frequencyEndHz), endAtS);
  }

  const gainNode = context.createGain();
  gainNode.gain.setValueAtTime(0.0001, startAtS);
  gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0002, options.gain), startAtS + Math.min(0.02, durationS * 0.45));
  gainNode.gain.exponentialRampToValueAtTime(0.0001, endAtS);

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);

  oscillator.start(startAtS);
  oscillator.stop(endAtS + 0.02);

  return endAtS;
}

function describeMicrophoneError(cause: unknown): string {
  const payload = cause as { name?: string; message?: string };
  const name = String(payload?.name ?? "");
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Permiso de microfono denegado en el navegador.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No se detecto un microfono disponible.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "El microfono esta ocupado por otra aplicacion.";
  }
  if (name === "SecurityError") {
    return "La captura de microfono requiere HTTPS o localhost.";
  }
  const message = String(payload?.message ?? "");
  return message || String(cause);
}

function appendVoiceTranscript(previous: string, chunk: string): string {
  const normalizedChunk = normalizeTranscriptText(chunk);
  if (!normalizedChunk) return previous;
  if (!previous) return normalizedChunk;
  if (previous.toLowerCase().endsWith(normalizedChunk.toLowerCase())) return previous;
  return `${previous} ${normalizedChunk}`.trim();
}

function formatVoiceNumericText(value: number, maxDecimals = 2): string {
  const rounded = Number(value.toFixed(maxDecimals));
  return String(rounded);
}

function toISOZ(datetimeLocal: string): string {
  const d = new Date(datetimeLocal);
  return d.toISOString();
}

function deviceDatetimeLocal(): string {
  const now = new Date();
  const timezoneOffsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
}

function formatRepsRange(min: number, max: number): string {
  if (min === max) return String(min);
  return `${min}-${max}`;
}

function formatRestRecommendation(restSeconds: number): string {
  if (restSeconds <= 0) return "Sin descanso";
  return `${restSeconds}s`;
}

function formatExerciseNameForCard(name: string): string {
  return name.replace(/\s*>\s*/g, " - ");
}

function setRowAnimationKey(exerciseIndex: number, setIndex: number): string {
  return `${exerciseIndex}:${setIndex}`;
}

function defaultSetForExercise(): SetRow {
  return {
    reps: "",
    load: "",
    completed: false,
    effort: "",
  };
}

function pickNearbySetValue(exercise: RoutineExerciseDraft, setIndex: number, key: "load" | "reps" | "effort"): string {
  for (let index = setIndex - 1; index >= 0; index -= 1) {
    const value = exercise.sets[index]?.[key]?.trim() || "";
    if (value) return value;
  }
  for (let index = setIndex + 1; index < exercise.sets.length; index += 1) {
    const value = exercise.sets[index]?.[key]?.trim() || "";
    if (value) return value;
  }
  return "";
}

function fillSetSuggestionsOnComplete(
  set: SetRow,
  exercise: RoutineExerciseDraft,
  setIndex: number,
  effortScale: "rpe" | "rir",
): SetRow {
  const suggestedReps = String(Math.max(1, Math.round(exercise.target_reps_min || 1)));
  const suggestedLoad = pickNearbySetValue(exercise, setIndex, "load");
  const suggestedEffort = effortScale === "rir" ? "2" : "8";
  const nearbyEffort = pickNearbySetValue(exercise, setIndex, "effort");

  return {
    ...set,
    reps: set.reps.trim() || suggestedReps,
    load: set.load.trim() || suggestedLoad,
    effort: set.effort.trim() || nearbyEffort || suggestedEffort,
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

function invertWellnessScore(score: number): number {
  return WELLNESS_MAX_SCORE + WELLNESS_MIN_SCORE - clampWellnessScore(score);
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

function stressSliderValue(score: number): number {
  return Number(invertWellnessScore(score).toFixed(1));
}

function parseStressScore(rawValue: string): number {
  return Number(invertWellnessScore(parseWellnessScore(rawValue)).toFixed(1));
}

function stressTickOffset(score: number): string {
  return wellnessTickOffset(invertWellnessScore(score));
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
  const { registerUndo } = useUndo();
  const { draft: activeSessionDraft, saveDraft, clearDraft } = useActiveSession();
  const nav = useNavigate();
  const draftForAthlete = activeSessionDraft && activeSessionDraft.athleteId === athleteId ? activeSessionDraft : null;

  const [step, setStep] = useState<SessionStep>(() => draftForAthlete?.step ?? "pick_routine");
  const [sessionAthleteId, setSessionAthleteId] = useState<string>(() => draftForAthlete?.athleteId || athleteId);
  const [startLocal, setStartLocal] = useState<string>(() => draftForAthlete?.startLocal ?? "");
  const [notes, setNotes] = useState<string>(() => draftForAthlete?.notes ?? "");
  const [sleepScore, setSleepScore] = useState<number>(() => draftForAthlete?.sleepScore ?? 7);
  const [stressScore, setStressScore] = useState<number>(() => draftForAthlete?.stressScore ?? 5);
  const [sensationScore, setSensationScore] = useState<number>(() => draftForAthlete?.sensationScore ?? 7);

  const [routineId, setRoutineId] = useState<string>(() => draftForAthlete?.routineId ?? "");
  const [routines, setRoutines] = useState<RoutineTemplate[]>([]);
  const [routineExercises, setRoutineExercises] = useState<RoutineExerciseDraft[]>(() => draftForAthlete?.routineExercises ?? []);

  const [sessionTimer, setSessionTimer] = useState<SessionTimerState>(() => draftForAthlete?.sessionTimer ?? IDLE_SESSION_TIMER);
  const [restTimer, setRestTimer] = useState<RestTimerState | null>(() => draftForAthlete?.restTimer ?? null);
  const [nowMs, setNowMs] = useSessionClock(TICK_MS);
  const [notificationCapability, setNotificationCapability] = useState<NotificationCapability>(() => detectNotificationCapability());
  const [voiceAudit, setVoiceAudit] = useState<ActiveSessionVoiceCommandAudit[]>(() => draftForAthlete?.voiceAudit ?? []);
  const [voiceTranscript, setVoiceTranscript] = useState<string>("");
  const [voiceUsed, setVoiceUsed] = useState<boolean>(() => draftForAthlete?.voiceUsed ?? false);
  const [voiceAssistDesktopEnabled, setVoiceAssistDesktopEnabled] = useState<boolean>(() => readVoiceAssistDesktopPreference());
  const [voiceStatus, setVoiceStatus] = useState<OfflineRecognizerState>("inactive");
  const [voiceError, setVoiceError] = useState<string>("");
  const [voicePartial, setVoicePartial] = useState<string>("");
  const [voiceTrainingProfile, setVoiceTrainingProfile] = useState<VoiceTrainingProfile>(() => loadVoiceTrainingProfile());
  const [voiceOrbMode, setVoiceOrbMode] = useState<VoiceOrbMode>(() =>
    readVoiceAssistDesktopPreference() ? "docked_idle" : "muted",
  );
  const [voiceOrbFocusedUntilMs, setVoiceOrbFocusedUntilMs] = useState<number | null>(null);
  const [, setVoiceOrbWakeAnimationTick] = useState(0);
  const [voiceAssistantResponse, setVoiceAssistantResponse] = useState<string>("");
  const [voiceAssistantResponseUntilMs, setVoiceAssistantResponseUntilMs] = useState<number | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [uncheckingSetKeys, setUncheckingSetKeys] = useState<string[]>([]);
  const [deletingSetKeys, setDeletingSetKeys] = useState<string[]>([]);

  const restTimeoutRef = useRef<number | null>(null);
  const uncheckTimeoutsRef = useRef<number[]>([]);
  const deleteTimeoutsRef = useRef<number[]>([]);
  const pendingSetDeletesRef = useRef<Map<string, PendingSetDelete>>(new Map());
  const nextSetDeleteIdRef = useRef(1);
  const activeSessionDraftRef = useRef(activeSessionDraft);
  const routineExercisesRef = useRef(routineExercises);
  const restTimerRef = useRef(restTimer);
  const prefsRef = useRef(prefs);
  const processVoiceTranscriptRef = useRef<(rawTranscript: string, confidence: number, source: VoiceTranscriptSource) => void>(
    () => undefined,
  );
  const voiceRecognizerRef = useRef<OfflineVoskRecognizerClass | null>(null);
  const voiceTrainingProfileRef = useRef<VoiceTrainingProfile>(voiceTrainingProfile);
  const voiceStatusPulseTimeoutRef = useRef<number | null>(null);
  const voiceSfxAudioContextRef = useRef<AudioContext | null>(null);
  const voiceWakeSoundLastAtMsRef = useRef(0);
  const voiceAutoStartInFlightRef = useRef(false);
  const pendingWakeRef = useRef<{ phrase: string; expiresAtMs: number } | null>(null);
  const voicePartialWakeFocusRef = useRef<{ lastFocusAtMs: number; lastWakeText: string }>({
    lastFocusAtMs: 0,
    lastWakeText: "",
  });
  const voiceOrbLastDeployAtMsRef = useRef(0);
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

  useEffect(() => {
    activeSessionDraftRef.current = activeSessionDraft;
  }, [activeSessionDraft]);

  useEffect(() => {
    routineExercisesRef.current = routineExercises;
  }, [routineExercises]);

  useEffect(() => {
    restTimerRef.current = restTimer;
  }, [restTimer]);

  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  useEffect(() => {
    voiceTrainingProfileRef.current = voiceTrainingProfile;
  }, [voiceTrainingProfile]);

  useEffect(() => {
    if (!athleteId) {
      setVoiceTrainingProfile(loadVoiceTrainingProfile());
      return;
    }
    let cancelled = false;
    getVoiceTrainingConfig()
      .then((profile) => {
        if (cancelled) return;
        setVoiceTrainingProfile(profile);
        saveVoiceTrainingProfile(profile);
      })
      .catch(() => {
        if (cancelled) return;
        setVoiceTrainingProfile(loadVoiceTrainingProfile());
      });
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(VOICE_ASSIST_DESKTOP_KEY, voiceAssistDesktopEnabled ? "1" : "0");
  }, [voiceAssistDesktopEnabled]);

  useEffect(() => {
    if (!athleteId) {
      if (voiceRecognizerRef.current) {
        void voiceRecognizerRef.current.disarm();
      }
      resetSetAnimations();
      setRoutines([]);
      setRoutineId("");
      setRoutineExercises([]);
      setStep("pick_routine");
      setSessionAthleteId("");
      setStartLocal("");
      setNotes("");
      setSleepScore(7);
      setStressScore(5);
      setSensationScore(7);
      setSessionTimer(IDLE_SESSION_TIMER);
      setRestTimer(null);
      setVoiceAudit([]);
      setVoiceTranscript("");
      setVoiceUsed(false);
      setVoiceError("");
      setVoicePartial("");
      setVoiceAssistantResponse("");
      setVoiceAssistantResponseUntilMs(null);
      pendingWakeRef.current = null;
      setVoiceStatus("inactive");
      setVoiceOrbFocusedUntilMs(null);
      setVoiceOrbMode(readVoiceAssistDesktopPreference() ? "docked_idle" : "muted");
      return;
    }

    setRoutines(loadRoutines(athleteId));
    const stored = activeSessionDraftRef.current;
    if (stored && stored.athleteId === athleteId) {
      resetSetAnimations();
      setRoutineId(stored.routineId);
      setRoutineExercises(stored.routineExercises);
      setStep(stored.step);
      setSessionAthleteId(stored.athleteId);
      setStartLocal(stored.startLocal);
      setNotes(stored.notes);
      setSleepScore(stored.sleepScore);
      setStressScore(stored.stressScore);
      setSensationScore(stored.sensationScore);
      setSessionTimer(stored.sessionTimer);
      setRestTimer(stored.restTimer);
      setVoiceAudit(stored.voiceAudit);
      setVoiceTranscript("");
      setVoiceUsed(stored.voiceUsed);
      setVoiceError("");
      setVoicePartial("");
      setVoiceAssistantResponse("");
      setVoiceAssistantResponseUntilMs(null);
      pendingWakeRef.current = null;
      setVoiceStatus("inactive");
      setVoiceOrbFocusedUntilMs(null);
      setVoiceOrbMode(readVoiceAssistDesktopPreference() ? "docked_idle" : "muted");
      setError("");
      return;
    }

    if (voiceRecognizerRef.current) {
      void voiceRecognizerRef.current.disarm();
    }
    resetSetAnimations();
    setRoutineId("");
    setRoutineExercises([]);
    setStep("pick_routine");
    setSessionAthleteId(athleteId);
    setStartLocal("");
    setNotes("");
    setSleepScore(7);
    setStressScore(5);
    setSensationScore(7);
    setSessionTimer(IDLE_SESSION_TIMER);
    setRestTimer(null);
    setVoiceAudit([]);
    setVoiceTranscript("");
    setVoiceUsed(false);
    setVoiceError("");
    setVoicePartial("");
    setVoiceAssistantResponse("");
    setVoiceAssistantResponseUntilMs(null);
    pendingWakeRef.current = null;
    setVoiceStatus("inactive");
    setVoiceOrbFocusedUntilMs(null);
    setVoiceOrbMode(readVoiceAssistDesktopPreference() ? "docked_idle" : "muted");
  }, [athleteId, resetSetAnimations]);

  const sortedRoutines = useMemo(() => [...routines].sort((a, b) => a.name.localeCompare(b.name)), [routines]);
  const selectedRoutine = useMemo(() => sortedRoutines.find((routine) => routine.id === routineId) || null, [routineId, sortedRoutines]);
  const selectedRoutineName = selectedRoutine?.name || "";
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
  const hasPendingSetDelete = deletingSetKeys.length > 0;

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
      routineName: selectedRoutineName || activeSessionDraft?.routineName || "",
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
    activeSessionDraft?.routineName,
    athleteId,
    clearDraft,
    notes,
    restTimer,
    routineExercises,
    routineId,
    saveDraft,
    sessionAthleteId,
    selectedRoutineName,
    sensationScore,
    sessionTimer,
    sleepScore,
    startLocal,
    step,
    stressScore,
    voiceAudit,
    voiceUsed,
  ]);

  useEffect(
    () => () => {
      clearAnimationTimeouts();
    },
    [clearAnimationTimeouts],
  );

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
  }, [restTimer, setNowMs]);

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

  const appendVoiceAuditEntry = useCallback((entry: ActiveSessionVoiceCommandAudit) => {
    setVoiceAudit((prev) => {
      const next = [...prev, entry];
      if (next.length <= MAX_VOICE_AUDIT_ENTRIES) return next;
      return next.slice(next.length - MAX_VOICE_AUDIT_ENTRIES);
    });
  }, []);

  function registerVoiceUndoForSet(
    exerciseIndex: number,
    setIndex: number,
    exerciseName: string,
    previousSetSnapshot: SetRow,
    previousRestTimer: RestTimerState | null,
  ): void {
    registerUndo({
      message: `Voz: revertir cambio en ${formatExerciseNameForCard(exerciseName)} set ${setIndex + 1}.`,
      onUndo: async () => {
        setRoutineExercises((prev) =>
          prev.map((entry, exIndex) => {
            if (exIndex !== exerciseIndex) return entry;
            if (setIndex < 0 || setIndex >= entry.sets.length) return entry;
            return {
              ...entry,
              sets: entry.sets.map((set, currentSetIndex) => (currentSetIndex === setIndex ? { ...previousSetSnapshot } : set)),
            };
          }),
        );
        setRestTimer(previousRestTimer ? { ...previousRestTimer } : null);
        setError("");
      },
    });
  }

  function applyVoiceCommandWithUndo(parsedCommand: ParsedVoiceCommand): VoiceApplyOutcome {
    const exercises = routineExercisesRef.current;
    const target = findCurrentSetTarget(exercises);
    if (!target) {
      return {
        applied: false,
        reason: "No hay sets pendientes para aplicar comando por voz.",
        intent: parsedCommand.intent,
        exercise_index: null,
        set_index: null,
        exercise_name: null,
        value_text: parsedCommand.valueText,
        response_text: null,
      };
    }

    const exercise = exercises[target.exerciseIndex];
    const targetSet = exercise?.sets[target.setIndex];
    if (!exercise || !targetSet) {
      return {
        applied: false,
        reason: "No pude resolver el set actual para aplicar comando.",
        intent: parsedCommand.intent,
        exercise_index: target.exerciseIndex,
        set_index: target.setIndex,
        exercise_name: target.exerciseName,
        value_text: parsedCommand.valueText,
        response_text: null,
      };
    }

    let command: SessionDraftCommand;
    let valueText: string | null = parsedCommand.valueText;
    let responseText: string | null = null;

    if (parsedCommand.intent === "set_set_completed") {
      if (targetSet.completed) {
        return {
          applied: false,
          reason: "El set actual ya estaba marcado como completado.",
            intent: parsedCommand.intent,
            exercise_index: target.exerciseIndex,
            set_index: target.setIndex,
            exercise_name: target.exerciseName,
            value_text: "true",
            response_text: null,
        };
      }
      command = {
        type: "set_set_completed",
        exercise_index: target.exerciseIndex,
        set_index: target.setIndex,
        value: true,
      };
      valueText = "true";
      responseText = "Serie registrada.";
    } else if (parsedCommand.intent === "set_reps") {
      if (typeof parsedCommand.value !== "number" || !Number.isFinite(parsedCommand.value)) {
        return {
          applied: false,
          reason: "No pude leer un valor valido para repeticiones.",
            intent: parsedCommand.intent,
            exercise_index: target.exerciseIndex,
            set_index: target.setIndex,
            exercise_name: target.exerciseName,
            value_text: null,
            response_text: null,
        };
      }
      const repsValue = Math.round(parsedCommand.value);
      if (repsValue <= 0) {
        return {
          applied: false,
          reason: "Las repeticiones deben ser mayores a cero.",
            intent: parsedCommand.intent,
            exercise_index: target.exerciseIndex,
            set_index: target.setIndex,
            exercise_name: target.exerciseName,
            value_text: String(repsValue),
            response_text: null,
        };
      }
      valueText = String(repsValue);
      command = {
        type: "set_reps",
        exercise_index: target.exerciseIndex,
        set_index: target.setIndex,
        value: valueText,
      };
      responseText = `Repeticiones asignadas en ${valueText}.`;
    } else if (parsedCommand.intent === "set_load") {
      if (typeof parsedCommand.value !== "number" || !Number.isFinite(parsedCommand.value) || parsedCommand.value < 0) {
        return {
          applied: false,
          reason: "No pude leer una carga valida para el set actual.",
            intent: parsedCommand.intent,
            exercise_index: target.exerciseIndex,
            set_index: target.setIndex,
            exercise_name: target.exerciseName,
            value_text: null,
            response_text: null,
        };
      }
      valueText = formatVoiceNumericText(parsedCommand.value, 2);
      command = {
        type: "set_load",
        exercise_index: target.exerciseIndex,
        set_index: target.setIndex,
        value: valueText,
      };
      responseText = `Peso ajustado en ${valueText} ${prefsRef.current.weightUnit}.`;
    } else {
      if (typeof parsedCommand.value !== "number" || !Number.isFinite(parsedCommand.value)) {
        return {
          applied: false,
          reason: `No pude leer un valor valido para ${prefsRef.current.effortScale.toUpperCase()}.`,
            intent: parsedCommand.intent,
            exercise_index: target.exerciseIndex,
            set_index: target.setIndex,
            exercise_name: target.exerciseName,
            value_text: null,
            response_text: null,
        };
      }
      const maxEffort = prefsRef.current.effortScale === "rir" ? 6 : 10;
      if (parsedCommand.value < 0 || parsedCommand.value > maxEffort) {
        return {
          applied: false,
          reason: `${prefsRef.current.effortScale.toUpperCase()} fuera de rango (0-${maxEffort}).`,
            intent: parsedCommand.intent,
            exercise_index: target.exerciseIndex,
            set_index: target.setIndex,
            exercise_name: target.exerciseName,
            value_text: formatVoiceNumericText(parsedCommand.value, 2),
            response_text: null,
        };
      }
      valueText = formatVoiceNumericText(parsedCommand.value, 2);
      command = {
        type: "set_set_effort",
        exercise_index: target.exerciseIndex,
        set_index: target.setIndex,
        value: valueText,
      };
      responseText = `${prefsRef.current.effortScale.toUpperCase()} asignado en ${valueText}.`;
    }

    const previousSetSnapshot = { ...targetSet };
    const previousRestTimer = restTimerRef.current ? { ...restTimerRef.current } : null;
    applySessionDraftCommand(command);
    setError("");

    registerVoiceUndoForSet(
      target.exerciseIndex,
      target.setIndex,
      target.exerciseName,
      previousSetSnapshot,
      previousRestTimer,
    );

    return {
      applied: true,
      reason: `Comando aplicado al set actual (${formatExerciseNameForCard(target.exerciseName)} set ${target.setIndex + 1}).`,
      intent: parsedCommand.intent,
      exercise_index: target.exerciseIndex,
      set_index: target.setIndex,
      exercise_name: target.exerciseName,
      value_text: valueText,
      response_text: responseText,
    };
  }

  function applyVoiceTupleWithUndo(tuple: ParsedVoiceSetTuple): VoiceApplyOutcome {
    const exercises = routineExercisesRef.current;
    const target = findCurrentSetTarget(exercises);
    if (!target) {
      return {
        applied: false,
        reason: "No hay sets pendientes para aplicar comando compacto.",
        intent: "set_bundle",
        exercise_index: null,
        set_index: null,
        exercise_name: null,
        value_text: tuple.valueText,
        response_text: null,
      };
    }

    const exercise = exercises[target.exerciseIndex];
    const targetSet = exercise?.sets[target.setIndex];
    if (!exercise || !targetSet) {
      return {
        applied: false,
        reason: "No pude resolver el set actual para el comando compacto.",
        intent: "set_bundle",
        exercise_index: target.exerciseIndex,
        set_index: target.setIndex,
        exercise_name: target.exerciseName,
        value_text: tuple.valueText,
        response_text: null,
      };
    }

    if (tuple.load < 0 || tuple.reps <= 0) {
      return {
        applied: false,
        reason: "Comando compacto invalido: carga>=0 y reps>0.",
        intent: "set_bundle",
        exercise_index: target.exerciseIndex,
        set_index: target.setIndex,
        exercise_name: target.exerciseName,
        value_text: tuple.valueText,
        response_text: null,
      };
    }

    const maxEffort = prefsRef.current.effortScale === "rir" ? 6 : 10;
    if (tuple.effort < 0 || tuple.effort > maxEffort) {
      return {
        applied: false,
        reason: `Comando compacto invalido: ${prefsRef.current.effortScale.toUpperCase()} fuera de rango (0-${maxEffort}).`,
        intent: "set_bundle",
        exercise_index: target.exerciseIndex,
        set_index: target.setIndex,
        exercise_name: target.exerciseName,
        value_text: tuple.valueText,
        response_text: null,
      };
    }

    const loadText = formatVoiceNumericText(tuple.load, 2);
    const repsText = String(Math.round(tuple.reps));
    const effortText = formatVoiceNumericText(tuple.effort, 2);
    const shouldComplete = tuple.complete;
    const previousSetSnapshot = { ...targetSet };
    const previousRestTimer = restTimerRef.current ? { ...restTimerRef.current } : null;

    setRoutineExercises((prev) =>
      prev.map((entry, exIndex) => {
        if (exIndex !== target.exerciseIndex) return entry;
        if (target.setIndex < 0 || target.setIndex >= entry.sets.length) return entry;
        return {
          ...entry,
          sets: entry.sets.map((set, currentSetIndex) =>
            currentSetIndex === target.setIndex
              ? {
                  ...set,
                  load: loadText,
                  reps: repsText,
                  effort: effortText,
                  completed: shouldComplete ? true : set.completed,
                }
              : set,
          ),
        };
      }),
    );
    if (shouldComplete && !targetSet.completed) {
      startRestForSet(target.exerciseIndex, target.setIndex);
    }
    setError("");

    registerVoiceUndoForSet(
      target.exerciseIndex,
      target.setIndex,
      target.exerciseName,
      previousSetSnapshot,
      previousRestTimer,
    );

    return {
      applied: true,
      reason: `Comando compacto aplicado (${loadText} ${prefsRef.current.weightUnit}, ${repsText} reps, ${prefsRef.current.effortScale.toUpperCase()} ${effortText}${shouldComplete ? ", completar set" : ""}).`,
      intent: "set_bundle",
      exercise_index: target.exerciseIndex,
      set_index: target.setIndex,
      exercise_name: target.exerciseName,
      value_text: `${loadText} ${prefsRef.current.weightUnit} | ${repsText} reps | ${prefsRef.current.effortScale.toUpperCase()} ${effortText}${
        shouldComplete ? " | completar" : ""
      }`,
      response_text: `Peso ajustado en ${loadText} ${prefsRef.current.weightUnit}. Repeticiones asignadas en ${repsText}. ${prefsRef.current.effortScale.toUpperCase()} asignado en ${effortText}.${shouldComplete ? " Serie registrada." : ""}`,
    };
  }

  function applyVoiceBatchWithUndo(batch: ParsedVoiceCommandBatch): VoiceApplyOutcome {
    const exercises = routineExercisesRef.current;
    const target = findCurrentSetTarget(exercises);
    if (!target) {
      return {
        applied: false,
        reason: "No hay sets pendientes para aplicar comando multiple.",
        intent: "set_bundle",
        exercise_index: null,
        set_index: null,
        exercise_name: null,
        value_text: batch.valueText,
        response_text: null,
      };
    }

    const exercise = exercises[target.exerciseIndex];
    const targetSet = exercise?.sets[target.setIndex];
    if (!exercise || !targetSet) {
      return {
        applied: false,
        reason: "No pude resolver el set actual para comando multiple.",
        intent: "set_bundle",
        exercise_index: target.exerciseIndex,
        set_index: target.setIndex,
        exercise_name: target.exerciseName,
        value_text: batch.valueText,
        response_text: null,
      };
    }

    const nextSet: SetRow = { ...targetSet };
    let changed = false;
    const responseParts: string[] = [];

    for (const command of batch.commands) {
      if (command.intent === "set_set_completed") {
        if (!nextSet.completed) {
          nextSet.completed = true;
          changed = true;
          responseParts.push("Serie registrada.");
        }
        continue;
      }

      if (command.intent === "set_load") {
        if (typeof command.value !== "number" || !Number.isFinite(command.value) || command.value < 0) {
          return {
            applied: false,
            reason: "Valor invalido de carga en comando multiple.",
            intent: "set_bundle",
            exercise_index: target.exerciseIndex,
            set_index: target.setIndex,
            exercise_name: target.exerciseName,
            value_text: batch.valueText,
            response_text: null,
          };
        }
        const loadText = formatVoiceNumericText(command.value, 2);
        if (nextSet.load !== loadText) {
          nextSet.load = loadText;
          changed = true;
          responseParts.push(`Peso ajustado en ${loadText} ${prefsRef.current.weightUnit}.`);
        }
        continue;
      }

      if (command.intent === "set_reps") {
        if (typeof command.value !== "number" || !Number.isFinite(command.value)) {
          return {
            applied: false,
            reason: "Valor invalido de repeticiones en comando multiple.",
            intent: "set_bundle",
            exercise_index: target.exerciseIndex,
            set_index: target.setIndex,
            exercise_name: target.exerciseName,
            value_text: batch.valueText,
            response_text: null,
          };
        }
        const repsValue = Math.round(command.value);
        if (repsValue <= 0) {
          return {
            applied: false,
            reason: "Las repeticiones deben ser mayores a cero.",
            intent: "set_bundle",
            exercise_index: target.exerciseIndex,
            set_index: target.setIndex,
            exercise_name: target.exerciseName,
            value_text: batch.valueText,
            response_text: null,
          };
        }
        const repsText = String(repsValue);
        if (nextSet.reps !== repsText) {
          nextSet.reps = repsText;
          changed = true;
          responseParts.push(`Repeticiones asignadas en ${repsText}.`);
        }
        continue;
      }

      if (command.intent === "set_set_effort") {
        if (typeof command.value !== "number" || !Number.isFinite(command.value)) {
          return {
            applied: false,
            reason: `Valor invalido de ${prefsRef.current.effortScale.toUpperCase()} en comando multiple.`,
            intent: "set_bundle",
            exercise_index: target.exerciseIndex,
            set_index: target.setIndex,
            exercise_name: target.exerciseName,
            value_text: batch.valueText,
            response_text: null,
          };
        }
        const maxEffort = prefsRef.current.effortScale === "rir" ? 6 : 10;
        if (command.value < 0 || command.value > maxEffort) {
          return {
            applied: false,
            reason: `${prefsRef.current.effortScale.toUpperCase()} fuera de rango (0-${maxEffort}).`,
            intent: "set_bundle",
            exercise_index: target.exerciseIndex,
            set_index: target.setIndex,
            exercise_name: target.exerciseName,
            value_text: batch.valueText,
            response_text: null,
          };
        }
        const effortText = formatVoiceNumericText(command.value, 2);
        if (nextSet.effort !== effortText) {
          nextSet.effort = effortText;
          changed = true;
          responseParts.push(`${prefsRef.current.effortScale.toUpperCase()} asignado en ${effortText}.`);
        }
      }
    }

    if (!changed) {
      return {
        applied: false,
        reason: "El comando multiple no genero cambios en el set actual.",
        intent: "set_bundle",
        exercise_index: target.exerciseIndex,
        set_index: target.setIndex,
        exercise_name: target.exerciseName,
        value_text: batch.valueText,
        response_text: null,
      };
    }

    const previousSetSnapshot = { ...targetSet };
    const previousRestTimer = restTimerRef.current ? { ...restTimerRef.current } : null;
    setRoutineExercises((prev) =>
      prev.map((entry, exIndex) => {
        if (exIndex !== target.exerciseIndex) return entry;
        if (target.setIndex < 0 || target.setIndex >= entry.sets.length) return entry;
        return {
          ...entry,
          sets: entry.sets.map((set, currentSetIndex) => (currentSetIndex === target.setIndex ? { ...nextSet } : set)),
        };
      }),
    );
    if (!targetSet.completed && nextSet.completed) {
      startRestForSet(target.exerciseIndex, target.setIndex);
    }
    setError("");

    registerVoiceUndoForSet(
      target.exerciseIndex,
      target.setIndex,
      target.exerciseName,
      previousSetSnapshot,
      previousRestTimer,
    );

    return {
      applied: true,
      reason: `Comando multiple aplicado al set actual (${formatExerciseNameForCard(target.exerciseName)} set ${target.setIndex + 1}).`,
      intent: "set_bundle",
      exercise_index: target.exerciseIndex,
      set_index: target.setIndex,
      exercise_name: target.exerciseName,
      value_text: batch.valueText,
      response_text: responseParts.length > 0 ? responseParts.join(" ") : "Set actualizado.",
    };
  }

  const focusVoiceOrb = useCallback((durationMs: number) => {
    const expiresAtMs = Date.now() + Math.max(200, durationMs);
    setVoiceOrbFocusedUntilMs(expiresAtMs);
    setVoiceOrbMode("focus_listening");
  }, []);

  const syncVoiceOrbDeployWithWake = useCallback(
    (durationMs: number): boolean => {
      const now = Date.now();
      let deployed = false;
      if (now - voiceOrbLastDeployAtMsRef.current >= VOICE_ORB_DEPLOY_MIN_GAP_MS) {
        voiceOrbLastDeployAtMsRef.current = now;
        setVoiceOrbWakeAnimationTick((prev) => prev + 1);
        deployed = true;
      }
      focusVoiceOrb(durationMs);
      return deployed;
    },
    [focusVoiceOrb],
  );

  const syncVoiceOrbFromPartialWake = useCallback(
    (partialTranscript: string): boolean => {
      if (!partialTranscript || !voiceAssistDesktopEnabled) return false;
      const normalizedPartial = normalizeTranscriptText(partialTranscript);
      if (!normalizedPartial) return false;

      const trainingProfile = voiceTrainingProfileRef.current;
      const wakeCandidates = buildWakePhraseCandidates(trainingProfile.wake_aliases);
      const wake = extractWakePhraseFromCandidates(normalizedPartial, wakeCandidates);
      if (!wake.detected) return false;

      const now = Date.now();
      const previous = voicePartialWakeFocusRef.current;
      const sameWakeText = previous.lastWakeText === wake.normalizedText;
      if (sameWakeText && now - previous.lastFocusAtMs < VOICE_WAKE_COMMAND_WINDOW_MS) return false;
      if (!sameWakeText && now - previous.lastFocusAtMs < VOICE_WAKE_PARTIAL_FOCUS_COOLDOWN_MS) return false;

      voicePartialWakeFocusRef.current = {
        lastFocusAtMs: now,
        lastWakeText: wake.normalizedText,
      };
      return syncVoiceOrbDeployWithWake(VOICE_WAKE_COMMAND_WINDOW_MS + VOICE_ORB_WAKE_BUFFER_MS);
    },
    [syncVoiceOrbDeployWithWake, voiceAssistDesktopEnabled],
  );

  const emitVoiceAssistantResponse = useCallback((message: string, durationMs = VOICE_ASSISTANT_RESPONSE_MS) => {
    if (!message.trim()) return;
    setVoiceAssistantResponse(message.trim());
    setVoiceAssistantResponseUntilMs(Date.now() + Math.max(800, durationMs));
  }, []);

  const playVoiceSfxCue = useCallback((cue: VoiceSfxCue) => {
    const AudioContextCtor = getVoiceSfxAudioContextCtor();
    if (!AudioContextCtor) return;

    let context = voiceSfxAudioContextRef.current;
    if (!context || context.state === "closed") {
      context = new AudioContextCtor();
      voiceSfxAudioContextRef.current = context;
    }

    const playPattern = () => {
      const nowS = context.currentTime + 0.01;
      if (cue === "listen_start") {
        const nextS = scheduleVoiceSfxTone(context, {
          startAtS: nowS,
          durationMs: 58,
          frequencyStartHz: 760,
          frequencyEndHz: 980,
          gain: 0.03,
          waveType: "triangle",
        });
        scheduleVoiceSfxTone(context, {
          startAtS: nextS + 0.02,
          durationMs: 72,
          frequencyStartHz: 940,
          frequencyEndHz: 1220,
          gain: 0.04,
          waveType: "sine",
        });
        return;
      }

      const nextS = scheduleVoiceSfxTone(context, {
        startAtS: nowS,
        durationMs: 66,
        frequencyStartHz: 980,
        frequencyEndHz: 760,
        gain: 0.03,
        waveType: "triangle",
      });
      scheduleVoiceSfxTone(context, {
        startAtS: nextS + 0.012,
        durationMs: 86,
        frequencyStartHz: 740,
        frequencyEndHz: 520,
        gain: 0.032,
        waveType: "sine",
      });
    };

    if (context.state === "suspended") {
      void context.resume().then(playPattern).catch(() => undefined);
      return;
    }
    playPattern();
  }, []);

  const playWakeSfxCue = useCallback(() => {
    if (!voiceAssistDesktopEnabled || !ENABLE_OFFLINE_VOICE_CAPTURE) return;
    const now = Date.now();
    if (now - voiceWakeSoundLastAtMsRef.current < VOICE_WAKE_SOUND_COOLDOWN_MS) return;
    voiceWakeSoundLastAtMsRef.current = now;
    playVoiceSfxCue("listen_start");
  }, [playVoiceSfxCue, voiceAssistDesktopEnabled]);

  function processVoiceTranscript(rawTranscript: string, confidence: number, source: VoiceTranscriptSource): void {
    const normalized = normalizeTranscriptText(rawTranscript);
    if (!normalized) return;

    const now = Date.now();
    const trainingProfile = voiceTrainingProfileRef.current;
    const correctedTranscript = applyVoicePhraseCorrections(normalized, trainingProfile.phrase_corrections);
    const wakeCandidates = buildWakePhraseCandidates(trainingProfile.wake_aliases);
    const wake = extractWakePhraseFromCandidates(correctedTranscript, wakeCandidates);
    const activePendingWake = pendingWakeRef.current && pendingWakeRef.current.expiresAtMs >= now ? pendingWakeRef.current : null;

    setVoiceUsed(true);
    setVoiceTranscript(correctedTranscript);
    setVoicePartial("");

    let commandText = "";
    let transcriptForAudit = correctedTranscript;
    let wakePhraseForAudit = wake.detectedWakePhrase || activePendingWake?.phrase || VOICE_WAKE_PHRASE;

    if (wake.detected) {
      if (!wake.normalizedCommandText) {
        const expiresAtMs = now + VOICE_WAKE_COMMAND_WINDOW_MS;
        pendingWakeRef.current = {
          phrase: wake.detectedWakePhrase || VOICE_WAKE_PHRASE,
          expiresAtMs,
        };
        voicePartialWakeFocusRef.current = {
          lastFocusAtMs: now,
          lastWakeText: wake.normalizedText,
        };
        const wakeActivated = syncVoiceOrbDeployWithWake(VOICE_WAKE_COMMAND_WINDOW_MS + VOICE_ORB_WAKE_BUFFER_MS);
        if (wakeActivated) {
          playWakeSfxCue();
        }
        emitVoiceAssistantResponse("Te escucho.");
        appendVoiceAuditEntry({
          timestamp_ms: now,
          transcript_normalized: wake.normalizedText,
          intent: "none",
          exercise_index: null,
          set_index: null,
          exercise_name: null,
          value_text: null,
          confidence: clampVoiceConfidence(confidence),
          applied: false,
          reason: `Wake detectada ("${wake.detectedWakePhrase || VOICE_WAKE_PHRASE}"). Esperando comando por ${Math.round(
            VOICE_WAKE_COMMAND_WINDOW_MS / 1000,
          )}s.`,
        });
        return;
      }
      voicePartialWakeFocusRef.current = {
        lastFocusAtMs: now,
        lastWakeText: wake.normalizedText,
      };
      const wakeActivated = syncVoiceOrbDeployWithWake(VOICE_ORB_COMMAND_FOCUS_MS + 280);
      if (wakeActivated) {
        playWakeSfxCue();
      }
      commandText = wake.normalizedCommandText;
      transcriptForAudit = wake.normalizedText;
      pendingWakeRef.current = null;
    } else if (activePendingWake) {
      commandText = correctedTranscript;
      wakePhraseForAudit = activePendingWake.phrase;
      pendingWakeRef.current = null;
    } else {
      pendingWakeRef.current = null;
      appendVoiceAuditEntry({
        timestamp_ms: now,
        transcript_normalized: wake.normalizedText,
        intent: "none",
        exercise_index: null,
        set_index: null,
        exercise_name: null,
        value_text: null,
        confidence: clampVoiceConfidence(confidence),
        applied: false,
        reason: `Ignorado (${source}): falta wake phrase (${wakePhraseHintList(wakeCandidates)}).`,
      });
      return;
    }

    const tupleParsed = parseVoiceSetTuple(commandText);
    if (tupleParsed.status === "matched") {
      const outcome = applyVoiceTupleWithUndo(tupleParsed.tuple);
      const combinedConfidence = clampVoiceConfidence(confidence * tupleParsed.tuple.parserConfidence);
      appendVoiceAuditEntry({
        timestamp_ms: now,
        transcript_normalized: transcriptForAudit,
        intent: outcome.intent,
        exercise_index: outcome.exercise_index,
        set_index: outcome.set_index,
        exercise_name: outcome.exercise_name,
        value_text: outcome.value_text,
        confidence: combinedConfidence,
        applied: outcome.applied,
        reason: `${outcome.reason} (wake: ${wakePhraseForAudit})`,
      });
      emitVoiceAssistantResponse(outcome.response_text || "Comando aplicado.");
      focusVoiceOrb(VOICE_ORB_COMMAND_FOCUS_MS);
      return;
    }

    const batchParsed = parseVoiceCommandBatch(commandText, {
      extraKeywords: trainingProfile.custom_keywords,
      allowImplicitLoad: true,
    });
    if (batchParsed.status === "matched") {
      const outcome = applyVoiceBatchWithUndo(batchParsed.batch);
      const combinedConfidence = clampVoiceConfidence(confidence * batchParsed.batch.parserConfidence);
      appendVoiceAuditEntry({
        timestamp_ms: now,
        transcript_normalized: transcriptForAudit,
        intent: outcome.intent,
        exercise_index: outcome.exercise_index,
        set_index: outcome.set_index,
        exercise_name: outcome.exercise_name,
        value_text: outcome.value_text,
        confidence: combinedConfidence,
        applied: outcome.applied,
        reason: `${outcome.reason} (wake: ${wakePhraseForAudit})`,
      });
      emitVoiceAssistantResponse(outcome.response_text || "Comando aplicado.");
      focusVoiceOrb(VOICE_ORB_COMMAND_FOCUS_MS);
      return;
    }

    const parsed = parseVoiceCommand(commandText, {
      extraKeywords: trainingProfile.custom_keywords,
      allowImplicitLoad: true,
    });

    if (parsed.status === "no_match") {
      appendVoiceAuditEntry({
        timestamp_ms: now,
        transcript_normalized: transcriptForAudit,
        intent: "none",
        exercise_index: null,
        set_index: null,
        exercise_name: null,
        value_text: null,
        confidence: clampVoiceConfidence(confidence),
        applied: false,
        reason: `${parsed.reason} (wake: ${wakePhraseForAudit})`,
      });
      emitVoiceAssistantResponse("No entendi el comando.");
      focusVoiceOrb(VOICE_ORB_COMMAND_FOCUS_MS);
      return;
    }

    const outcome = applyVoiceCommandWithUndo(parsed.command);
    const combinedConfidence = clampVoiceConfidence(confidence * parsed.command.parserConfidence);
    appendVoiceAuditEntry({
      timestamp_ms: now,
      transcript_normalized: transcriptForAudit,
      intent: outcome.intent,
      exercise_index: outcome.exercise_index,
      set_index: outcome.set_index,
      exercise_name: outcome.exercise_name,
      value_text: outcome.value_text,
      confidence: combinedConfidence,
      applied: outcome.applied,
      reason: `${outcome.reason} (wake: ${wakePhraseForAudit})`,
    });
    emitVoiceAssistantResponse(outcome.response_text || (outcome.applied ? "Comando aplicado." : "No pude aplicar el comando."));
    focusVoiceOrb(VOICE_ORB_COMMAND_FOCUS_MS);
  }

  processVoiceTranscriptRef.current = processVoiceTranscript;

  useEffect(() => {
    if (voiceOrbFocusedUntilMs === null) return;
    const delayMs = Math.max(0, voiceOrbFocusedUntilMs - Date.now());
    const timeoutId = window.setTimeout(() => {
      setVoiceOrbFocusedUntilMs(null);
      setVoiceOrbMode((current) => (current === "focus_listening" ? "docked_idle" : current));
    }, delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [voiceOrbFocusedUntilMs]);

  useEffect(() => {
    if (voiceAssistantResponseUntilMs === null) return;
    const delayMs = Math.max(0, voiceAssistantResponseUntilMs - Date.now());
    const timeoutId = window.setTimeout(() => {
      setVoiceAssistantResponse("");
      setVoiceAssistantResponseUntilMs(null);
    }, delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [voiceAssistantResponseUntilMs]);

  const startVoiceCapture = useCallback(async () => {
    setVoiceError("");
    pendingWakeRef.current = null;
    voicePartialWakeFocusRef.current = { lastFocusAtMs: 0, lastWakeText: "" };
    voiceOrbLastDeployAtMsRef.current = 0;
    voiceWakeSoundLastAtMsRef.current = 0;
    if (voiceStatus === "loading" || voiceStatus === "armed" || voiceStatus === "listening") {
      return;
    }
    if (!voiceAssistDesktopEnabled) {
      setVoiceError("La asistencia por voz esta desactivada.");
      setVoiceOrbMode("muted");
      return;
    }
    if (!ENABLE_OFFLINE_VOICE_CAPTURE) {
      setVoiceError("La feature VITE_ENABLE_OFFLINE_VOICE_CAPTURE esta en false.");
      setVoiceOrbMode("error");
      return;
    }
    if (!("mediaDevices" in navigator) || typeof navigator.mediaDevices?.getUserMedia !== "function") {
      setVoiceError("Este navegador no permite acceso al microfono.");
      setVoiceStatus("error");
      setVoiceOrbMode("error");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
      stream.getTracks().forEach((track) => track.stop());
    } catch (cause: unknown) {
      setVoiceError(`No se pudo obtener permiso de microfono: ${describeMicrophoneError(cause)}`);
      setVoiceStatus("error");
      setVoiceOrbMode("error");
      return;
    }

    let voiceModule: typeof import("../lib/voice/offlineRecognizer");
    try {
      voiceModule = await import("../lib/voice/offlineRecognizer");
    } catch (cause: unknown) {
      const message = String((cause as { message?: string })?.message || cause);
      setVoiceError(`No pude cargar el motor de voz: ${message}`);
      setVoiceStatus("error");
      setVoiceOrbMode("error");
      return;
    }

    if (!voiceModule.browserSupportsOfflineRecognizer()) {
      setVoiceError("Este navegador no soporta captura de microfono offline para voz.");
      setVoiceStatus("error");
      setVoiceOrbMode("error");
      return;
    }

    let recognizer = voiceRecognizerRef.current;
    if (!recognizer) {
      recognizer = new voiceModule.OfflineVoskRecognizer({
        modelUrl: VOICE_MODEL_URL,
        callbacks: {
          onStateChange: (state) => setVoiceStatus(state),
          onPartialTranscript: (partial) => {
            const normalized = normalizeTranscriptText(partial);
            setVoicePartial(normalized);
            const wakeActivated = syncVoiceOrbFromPartialWake(normalized);
            if (wakeActivated) {
              playWakeSfxCue();
            }
          },
          onFinalTranscript: (result: OfflineRecognizerFinalTranscript) => {
            processVoiceTranscriptRef.current(result.text, clampVoiceConfidence(result.confidence), "microphone");
          },
          onError: (message) => {
            setVoiceError(message);
            setVoiceStatus("error");
            setVoiceOrbMode("error");
          },
        },
      });
      voiceRecognizerRef.current = recognizer;
    }

    try {
      await recognizer.arm();
      setVoiceOrbMode((current) => (current === "focus_listening" ? current : "docked_idle"));
    } catch (cause: unknown) {
      const message = String((cause as { message?: string })?.message || cause);
      setVoiceError(`No se pudo iniciar la escucha: ${message}`);
      setVoiceStatus("error");
      setVoiceOrbMode("error");
    }
  }, [playWakeSfxCue, syncVoiceOrbFromPartialWake, voiceAssistDesktopEnabled, voiceStatus]);

  const deactivateVoiceCapture = useCallback(async () => {
    if (voiceStatusPulseTimeoutRef.current !== null) {
      window.clearTimeout(voiceStatusPulseTimeoutRef.current);
      voiceStatusPulseTimeoutRef.current = null;
    }
    voicePartialWakeFocusRef.current = { lastFocusAtMs: 0, lastWakeText: "" };
    voiceOrbLastDeployAtMsRef.current = 0;
    voiceWakeSoundLastAtMsRef.current = 0;
    const recognizer = voiceRecognizerRef.current;
    if (!recognizer) {
      setVoiceStatus("inactive");
      setVoicePartial("");
      pendingWakeRef.current = null;
      setVoiceOrbFocusedUntilMs(null);
      setVoiceOrbMode(voiceAssistDesktopEnabled ? "docked_idle" : "muted");
      return;
    }

    try {
      await recognizer.disarm();
      setVoiceError("");
      pendingWakeRef.current = null;
      setVoiceOrbFocusedUntilMs(null);
      setVoiceOrbMode(voiceAssistDesktopEnabled ? "docked_idle" : "muted");
    } catch (cause: unknown) {
      const message = String((cause as { message?: string })?.message || cause);
      setVoiceError(message);
      setVoiceStatus("error");
      setVoiceOrbMode("error");
    }
  }, [voiceAssistDesktopEnabled]);

  const toggleVoiceAssistDesktop = useCallback(() => {
    if (voiceAssistDesktopEnabled) {
      void deactivateVoiceCapture();
      setVoiceError("");
      pendingWakeRef.current = null;
      setVoiceOrbFocusedUntilMs(null);
      setVoiceOrbMode("muted");
      setVoiceAssistantResponse("Asistente silenciado.");
      setVoiceAssistantResponseUntilMs(Date.now() + VOICE_ASSISTANT_RESPONSE_MS);
    } else {
      setVoiceOrbMode("docked_idle");
      setVoiceAssistantResponse("Asistente reactivado.");
      setVoiceAssistantResponseUntilMs(Date.now() + VOICE_ASSISTANT_RESPONSE_MS);
    }
    setVoiceAssistDesktopEnabled((prev) => !prev);
  }, [deactivateVoiceCapture, voiceAssistDesktopEnabled]);

  useEffect(() => {
    if (step === "capture_session") return;
    voiceAutoStartInFlightRef.current = false;
    pendingWakeRef.current = null;
    void deactivateVoiceCapture();
  }, [deactivateVoiceCapture, step]);

  useEffect(() => {
    if (step !== "capture_session") return;
    if (!ENABLE_OFFLINE_VOICE_CAPTURE) {
      voiceAutoStartInFlightRef.current = false;
      pendingWakeRef.current = null;
      void deactivateVoiceCapture();
      return;
    }
    if (!voiceAssistDesktopEnabled) {
      voiceAutoStartInFlightRef.current = false;
      pendingWakeRef.current = null;
      void deactivateVoiceCapture();
      return;
    }
    if (voiceStatus !== "inactive") return;
    if (voiceAutoStartInFlightRef.current) return;

    voiceAutoStartInFlightRef.current = true;
    void startVoiceCapture().finally(() => {
      voiceAutoStartInFlightRef.current = false;
    });
  }, [deactivateVoiceCapture, startVoiceCapture, step, voiceAssistDesktopEnabled, voiceStatus]);

  useEffect(
    () => () => {
      if (voiceStatusPulseTimeoutRef.current !== null) {
        window.clearTimeout(voiceStatusPulseTimeoutRef.current);
        voiceStatusPulseTimeoutRef.current = null;
      }
      const sfxAudioContext = voiceSfxAudioContextRef.current;
      voiceSfxAudioContextRef.current = null;
      if (sfxAudioContext) {
        void sfxAudioContext.close().catch(() => undefined);
      }
      const recognizer = voiceRecognizerRef.current;
      voiceRecognizerRef.current = null;
      if (!recognizer) return;
      void recognizer.dispose();
    },
    [],
  );

  function onWellnessChange(setter: (value: number) => void, rawValue: string) {
    setter(parseWellnessScore(rawValue));
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

  function startSessionStep(nextRoutineId?: string) {
    const routine = nextRoutineId ? sortedRoutines.find((item) => item.id === nextRoutineId) || null : selectedRoutine;
    if (!routine) {
      setError("Selecciona una rutina para comenzar la sesion.");
      return;
    }

    setRoutineId(routine.id);
    setError("");
    resetSetAnimations();
    const draft = routineToDraft(routine);
    setRoutineExercises(draft);
    setStartLocal(deviceDatetimeLocal());
    setStep("capture_session");
    setSessionAthleteId(athleteId);
    const now = Date.now();
    setNowMs(now);
    setSessionTimer(createRunningSessionTimer(now));
    setRestTimer(null);
    setVoiceAudit([]);
    setVoiceTranscript("");
    setVoiceUsed(false);
    setVoiceError("");
    setVoicePartial("");
    setVoiceAssistantResponse("");
    setVoiceAssistantResponseUntilMs(null);
    pendingWakeRef.current = null;
    setVoiceStatus("inactive");
    setVoiceOrbFocusedUntilMs(null);
    setVoiceOrbMode(voiceAssistDesktopEnabled ? "docked_idle" : "muted");
  }

  function goBackToRoutineStep() {
    void deactivateVoiceCapture();
    resetSetAnimations();
    setStep("pick_routine");
    setSessionTimer(IDLE_SESSION_TIMER);
    setRestTimer(null);
    setVoiceError("");
    setVoicePartial("");
    setVoiceAssistantResponse("");
    setVoiceAssistantResponseUntilMs(null);
    pendingWakeRef.current = null;
    setVoiceStatus("inactive");
    setVoiceOrbFocusedUntilMs(null);
    setVoiceOrbMode(voiceAssistDesktopEnabled ? "docked_idle" : "muted");
    setError("");
  }

  function exitSession() {
    if (step !== "capture_session") return;
    const confirmed = window.confirm("Seguro que quieres cerrar la sesion activa? Se perderan los cambios no guardados.");
    if (!confirmed) return;

    void deactivateVoiceCapture();
    clearDraft();
    resetSetAnimations();
    setStep("pick_routine");
    setSessionAthleteId(athleteId);
    setRoutineId("");
    setRoutineExercises([]);
    setStartLocal("");
    setNotes("");
    setSleepScore(7);
    setStressScore(5);
    setSensationScore(7);
    setSessionTimer(IDLE_SESSION_TIMER);
    setRestTimer(null);
    setVoiceAudit([]);
    setVoiceTranscript("");
    setVoiceUsed(false);
    setVoiceError("");
    setVoicePartial("");
    setVoiceAssistantResponse("");
    setVoiceAssistantResponseUntilMs(null);
    pendingWakeRef.current = null;
    setVoiceStatus("inactive");
    setVoiceOrbFocusedUntilMs(null);
    setVoiceOrbMode(voiceAssistDesktopEnabled ? "docked_idle" : "muted");
    setNowMs(Date.now());
    setError("");
    nav("/home");
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
    if (hasPendingSetDelete) return;
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
    if (hasPendingSetDelete) return;
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

  // Handler central para inputs manuales y comandos por voz.
  function applySessionDraftCommand(command: SessionDraftCommand) {
    setRoutineExercises((prev) =>
      prev.map((entry, exIdx) => {
        if (exIdx !== command.exercise_index) return entry;
        if (command.set_index < 0 || command.set_index >= entry.sets.length) return entry;
        const sets = entry.sets.map((set, setIdx) => {
          if (setIdx !== command.set_index) return set;
          if (command.type === "set_reps") return { ...set, reps: command.value };
          if (command.type === "set_load") return { ...set, load: command.value };
          if (command.type === "set_set_completed") {
            if (!command.value) return { ...set, completed: false };
            return {
              ...fillSetSuggestionsOnComplete(set, entry, command.set_index, prefs.effortScale),
              completed: true,
            };
          }
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
    resetSetAnimations();
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

    const voiceAuditCommands = voiceAudit.slice(-MAX_VOICE_AUDIT_ENTRIES);
    const appliedVoiceCommands = voiceAuditCommands.filter((entry) => entry.applied).length;
    const rejectedVoiceCommands = voiceAuditCommands.length - appliedVoiceCommands;
    const wakePhrases = buildWakePhraseCandidates(voiceTrainingProfile.wake_aliases);

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
            voice_ready: ENABLE_OFFLINE_VOICE_CAPTURE,
            voice: {
              enabled: ENABLE_OFFLINE_VOICE_CAPTURE && voiceAssistDesktopEnabled,
              mode: "wake_phrase_armed",
              engine: VOICE_ENGINE,
              model_id: VOICE_MODEL_ID,
              language: VOICE_LANGUAGE,
              wake_phrase: wakePhrases[0] || VOICE_WAKE_PHRASE,
              wake_aliases: wakePhrases.slice(1),
              wake_command_window_ms: VOICE_WAKE_COMMAND_WINDOW_MS,
              ui_overlay: "jarvis_orb_v1",
              ui_mode: "dock_to_focus_on_wake",
              offline_only: true,
            },
            supported_commands: [
              "set_reps",
              "set_load",
              "set_set_completed",
              "set_set_effort",
              "set_bundle",
            ],
          },
          voice_capture: {
            summary: {
              used: voiceUsed,
              total_commands: voiceAuditCommands.length,
              applied_commands: appliedVoiceCommands,
              rejected_commands: rejectedVoiceCommands,
              phrase_corrections: voiceTrainingProfile.phrase_corrections.length,
            },
            commands: voiceAuditCommands,
          },
        },
      },
    ];

    setSessionTimer(finalizedTimer);
    setRestTimer(null);
    setNowMs(now);

    setBusy(true);
    try {
      resetSetAnimations();
      await ingestSessions(payload);
      await deactivateVoiceCapture();
      clearDraft();
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
            <div className="routinePickGrid" style={{ marginTop: 12 }}>
              {sortedRoutines.map((routine) => {
                const totalSets = routine.exercises.reduce(
                  (acc, exercise) => acc + Math.max(1, Math.round(exercise.target_sets || 1)),
                  0,
                );
                const averageRestSeconds =
                  routine.exercises.length > 0
                    ? Math.round(
                        routine.exercises.reduce((acc, exercise) => acc + Math.max(0, Math.round(exercise.rest_seconds || 0)), 0) /
                          routine.exercises.length,
                      )
                    : 0;
                const previewNames = routine.exercises
                  .slice(0, 3)
                  .map((exercise) => formatExerciseNameForCard(exercise.name))
                  .filter(Boolean)
                  .join(" - ");
                const hiddenCount = Math.max(0, routine.exercises.length - 3);

                return (
                  <article key={routine.id} className={`routinePickCard ${routine.id === routineId ? "active" : ""}`.trim()}>
                    <div className="hstack" style={{ justifyContent: "space-between" }}>
                      <strong>{routine.name}</strong>
                      <span className="chip">{`${routine.exercises.length} ejercicio${routine.exercises.length === 1 ? "" : "s"}`}</span>
                    </div>
                    <div className="chipRow">
                      <span className="chip">{`${totalSets} series objetivo`}</span>
                      <span className="chip">{`Descanso prom: ${formatRestRecommendation(averageRestSeconds)}`}</span>
                    </div>
                    <div className="small">
                      {previewNames || "Sin ejercicios"}
                      {hiddenCount > 0 ? ` (+${hiddenCount})` : ""}
                    </div>
                    <div className="routinePickActions">
                      <button className="btn primary routineStartBtn" onClick={() => startSessionStep(routine.id)} disabled={!hasActiveAthlete}>
                        Iniciar rutina
                      </button>
                      <button className="btn routineGotoBtn" onClick={() => nav("/routines")}>
                        Ir a rutinas
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    );
  }

  const timerStatus = sessionTimerRunning ? "En curso" : sessionTimerCompleted ? "Completada" : sessionTimerStarted ? "Pausada" : "Sin iniciar";
  const timerActionLabel = sessionTimerStarted ? "Reanudar" : "Iniciar";
  const voiceWakePhrases = buildWakePhraseCandidates(voiceTrainingProfile.wake_aliases);
  const voiceWakeDisplay = wakePhraseHintList(voiceWakePhrases);
  const voiceTranscriptDisplay = (() => {
    const partial = normalizeTranscriptText(voicePartial);
    if (!partial) return voiceTranscript;
    return appendVoiceTranscript(voiceTranscript, partial);
  })();
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
          <button className="btn trashBtn" type="button" onClick={exitSession}>
            Cerrar sesion
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
                value={stressSliderValue(stressScore)}
                style={wellnessSliderStyle(stressSliderValue(stressScore))}
                onChange={(e) => setStressScore(parseStressScore(e.target.value))}
              />
              <div className="wellnessTicks">
                {WELLNESS_TICKS.map((tick) => (
                  <div
                    key={`stress_tick_${tick}`}
                    className={`wellnessTick ${tick === WELLNESS_MAX_SCORE ? "wellnessTickMin" : tick === WELLNESS_MIN_SCORE ? "wellnessTickMax" : ""}`.trim()}
                    style={{ left: stressTickOffset(tick) }}
                  >
                    <span className="wellnessTickMark" aria-hidden="true" />
                    <span>{tick}</span>
                  </div>
                ))}
              </div>
              <div className="wellnessScale">
                {STRESS_LABEL_POINTS.map((item) => (
                  <div key={`stress_label_${item.score}`} className="wellnessScaleItem" style={{ left: stressTickOffset(item.score) }}>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="wellnessField">
              <div className="wellnessFieldHead">
                <label className="smallLabel">Sensaciones/Motivacion</label>
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
                    <strong>{formatExerciseNameForCard(exercise.name)}</strong>
                  </div>
                  <span className="chip">Sets: {exercise.sets.length}</span>
                </div>
                <div className="chipRow" style={{ marginTop: 8 }}>
                  <span className="chip">{`Reps objetivo: ${formatRepsRange(exercise.target_reps_min, exercise.target_reps_max)}`}</span>
                  <span className="chip">{`Descanso recomendado: ${formatRestRecommendation(exercise.rest_seconds)}`}</span>
                </div>

                <div className="setGrid">
                  {exercise.sets.map((set, setIdx) => {
                    const setKey = setRowAnimationKey(exIdx, setIdx);
                    const isUnchecking = uncheckingSetKeys.includes(setKey);
                    const isDeleting = deletingSetKeys.includes(setKey);

                    return (
                    <div
                      key={setIdx}
                      className={`setRowCard ${set.completed ? "completedSetRow" : ""} ${isUnchecking ? "uncheckingSetRow" : ""} ${
                        isDeleting ? "deletingSetRow" : ""
                      }`.trim()}
                    >
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
                          onClick={() => handleSetCompletedToggle(exIdx, setIdx, set.completed)}
                          disabled={isDeleting || isUnchecking}
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
                          onClick={() => handleRemoveSetWithAnimation(exIdx, setIdx)}
                          disabled={exercise.sets.length <= 1 || hasPendingSetDelete || isUnchecking || isDeleting}
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
                  )})}
                </div>

                <div className="hstack compact">
                  <button className="btn" onClick={() => addSet(exIdx)} disabled={hasPendingSetDelete}>
                    + Set vacio
                  </button>
                  <button className="btn" onClick={() => duplicateLastSet(exIdx)} disabled={hasPendingSetDelete}>
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
          <button className="btn" type="button" onClick={toggleVoiceAssistDesktop} disabled={!ENABLE_OFFLINE_VOICE_CAPTURE}>
            {voiceAssistDesktopEnabled ? "Silenciar voz" : "Reactivar voz"}
          </button>
        </div>
      </section>

      {ENABLE_OFFLINE_VOICE_CAPTURE ? (
        <HoloVoiceAssistantOverlay
          mode={voiceOrbMode}
          status={voiceStatus}
          wakeLabel={voiceWakeDisplay}
          transcript={voiceTranscriptDisplay}
          response={voiceAssistantResponse}
          error={voiceError}
        />
      ) : null}

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

