import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { ingestSessions } from "../api";
import { dayKeyToDatetimeLocal } from "../lib/dates";
import type { ExerciseCatalogEntry } from "../lib/exerciseCatalog";
import { setSides, setUnilateralName } from "../lib/laterality";
import {
  appendEmptySet,
  applyCommandToExercises,
  duplicateLastSetOf,
  exerciseHasData,
  newExerciseFromCatalog,
  replaceExerciseIdentity,
  resizeSets,
  sameExercise,
  setAthleteNote,
  shiftRestTimerAfterRemoval,
} from "../lib/session/exerciseOps";
import { buildSessionExercises, buildSessionPayload } from "../lib/session/buildPayload";
import {
  deviceDatetimeLocal,
  formatStartLabel,
  normalizeExerciseNameForNotes,
} from "../lib/session/format";
import { parseSetEffortValue, routineToDraft } from "../lib/session/routine";
import {
  completeSessionTimerState,
  computeSessionElapsedMs,
  createRunningSessionTimer,
  IDLE_SESSION_TIMER,
  pauseSessionTimerState,
  resumeSessionTimerState,
} from "../lib/session/sessionTimer";
import type {
  RoutineExerciseDraft,
  SessionDraftCommand,
  SessionStep,
  SessionTimerState,
} from "../lib/session/types";
import { enqueueSessionUpload, isNetworkError } from "../lib/sessionOutbox";
import { loadRoutines } from "../lib/storage";
import type { RoutineTemplate } from "../lib/storage";
import { findCurrentSetTarget } from "../lib/voice/setTarget";
import { useActiveSession } from "../state/activeSession";
import { useAthleteAccess, useAthleteId } from "../state/athlete";
import { usePreferences } from "../state/preferences";
import CloseRoutineModal from "./newSession/CloseRoutineModal";
import ExtrasMenu from "./newSession/ExtrasMenu";
import ExerciseCard from "./newSession/ExerciseCard";
import ExerciseEditModal from "./newSession/ExerciseEditModal";
import type { ExerciseSettings } from "./newSession/ExerciseEditModal";
import PickRoutineStep from "./newSession/PickRoutineStep";
import RestFloatBar from "./newSession/RestFloatBar";
import SessionExercisePicker from "./newSession/SessionExercisePicker";
import SessionTimerCard from "./newSession/SessionTimerCard";
import { useCoachNotes } from "./newSession/useCoachNotes";
import { useRestFinishedNotice, useRestTimer } from "./newSession/useRestTimer";
import { useSessionVoice } from "./newSession/useSessionVoice";
import { useSetRowAnimations } from "./newSession/useSetRowAnimations";
import VoiceDock from "./newSession/VoiceDock";
import WellnessPanel from "./newSession/WellnessPanel";
import "../styles.rutinas.css";
import { errorMessage } from "../lib/errors";
import { useConfirm } from "../lib/useConfirm";

const DEFAULT_SLEEP_SCORE = 7;
const DEFAULT_STRESS_SCORE = 5;
const DEFAULT_SENSATION_SCORE = 7;

export default function NewSession() {
  const { confirm, dialog } = useConfirm();
  const { athleteIds, canSwitch, ready: athleteReady } = useAthleteAccess();
  const [athleteId] = useAthleteId();
  const { prefs } = usePreferences();
  const { draft: activeSessionDraft, saveDraft, clearDraft } = useActiveSession();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const draftForAthlete = activeSessionDraft && activeSessionDraft.athleteId === athleteId ? activeSessionDraft : null;

  // Home enlaza aquí para registrar un día concreto (`?date=YYYY-MM-DD`) y opcionalmente
  // arrancar ya con una rutina (`?routine=<id>`), así se pueden cargar sesiones pasadas.
  const requestedDayKey = useMemo(() => {
    const raw = searchParams.get("date") || "";
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
  }, [searchParams]);
  const requestedRoutineId = useMemo(() => searchParams.get("routine") || "", [searchParams]);

  const [step, setStep] = useState<SessionStep>(() => draftForAthlete?.step ?? "pick_routine");
  const [sessionAthleteId, setSessionAthleteId] = useState<string>(() => draftForAthlete?.athleteId || athleteId);
  const [startLocal, setStartLocal] = useState<string>(() => draftForAthlete?.startLocal ?? "");
  const [notes, setNotes] = useState<string>(() => draftForAthlete?.notes ?? "");
  const [sleepScore, setSleepScore] = useState<number>(() => draftForAthlete?.sleepScore ?? DEFAULT_SLEEP_SCORE);
  const [stressScore, setStressScore] = useState<number>(() => draftForAthlete?.stressScore ?? DEFAULT_STRESS_SCORE);
  const [sensationScore, setSensationScore] = useState<number>(() => draftForAthlete?.sensationScore ?? DEFAULT_SENSATION_SCORE);

  const [routineId, setRoutineId] = useState<string>(() => draftForAthlete?.routineId ?? "");
  const [routines, setRoutines] = useState<RoutineTemplate[]>([]);
  const [routineExercises, setRoutineExercises] = useState<RoutineExerciseDraft[]>(() => draftForAthlete?.routineExercises ?? []);

  const [sessionTimer, setSessionTimer] = useState<SessionTimerState>(() => draftForAthlete?.sessionTimer ?? IDLE_SESSION_TIMER);
  const {
    restTimer,
    setRestTimer,
    nowMs,
    setNowMs,
    notificationCapability,
    restRemainingSec,
    restRemainingSecSigned,
    restProgressPct,
    requestDeviceNotifications,
    clearRestTimer,
  } = useRestTimer(draftForAthlete?.restTimer ?? null);
  const {
    voiceAudit,
    setVoiceAudit,
    setVoiceTranscript,
    voiceTranscript,
    voicePartial,
    voiceUsed,
    setVoiceUsed,
    voiceAssistDesktopEnabled,
    voiceStatus,
    voiceError,
    setVoiceError,
    setVoicePartial,
    voiceDockOpen,
    setVoiceDockOpen,
    clipboardBusy,
    voiceCaptureActive,
    voiceTranscriptDisplay,
    voiceAuditPreview,
    clearVoiceFeedback,
    disarmVoiceRecognizer,
    startVoiceCapture,
    deactivateVoiceCapture,
    toggleVoiceAssistDesktop,
    transcribeClipboardText,
  } = useSessionVoice({
    step,
    initialAudit: draftForAthlete?.voiceAudit ?? [],
    initialUsed: draftForAthlete?.voiceUsed ?? false,
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [closeRoutineOpen, setCloseRoutineOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<{ type: "add" } | { type: "replace"; exIdx: number } | null>(null);
  const [editingExIdx, setEditingExIdx] = useState<number | null>(null);
  const [dataOpen, setDataOpen] = useState(false);
  const {
    uncheckingSetKeys,
    deletingSetKeys,
    hasPendingSetDelete,
    resetSetAnimations,
    handleSetCompletedToggle,
    handleRemoveSetWithAnimation,
  } = useSetRowAnimations({
    routineExercises,
    setRoutineExercises,
    setRestTimer,
    setError,
    applySessionDraftCommand,
  });

  const activeSessionDraftRef = useRef(activeSessionDraft);
  const autoStartedRef = useRef(false);
  useEffect(() => {
    activeSessionDraftRef.current = activeSessionDraft;
  }, [activeSessionDraft]);

  // Deja la captura en blanco (paso 1, sin rutina, temporizadores y voz a cero).
  const resetDraftFields = useCallback((nextSessionAthleteId: string) => {
    resetSetAnimations();
    setRoutineId("");
    setRoutineExercises([]);
    setStep("pick_routine");
    setSessionAthleteId(nextSessionAthleteId);
    setStartLocal("");
    setNotes("");
    setSleepScore(DEFAULT_SLEEP_SCORE);
    setStressScore(DEFAULT_STRESS_SCORE);
    setSensationScore(DEFAULT_SENSATION_SCORE);
    setSessionTimer(IDLE_SESSION_TIMER);
    setRestTimer(null);
    setVoiceAudit([]);
    setVoiceUsed(false);
    clearVoiceFeedback();
  }, [clearVoiceFeedback, resetSetAnimations, setRestTimer, setVoiceAudit, setVoiceUsed]);

  useEffect(() => {
    const resetToIdle = (nextSessionAthleteId: string) => {
      disarmVoiceRecognizer();
      resetDraftFields(nextSessionAthleteId);
      setVoiceTranscript("");
    };

    if (!athleteId) {
      resetToIdle("");
      setRoutines([]);
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
      clearVoiceFeedback();
      setError("");
      return;
    }

    resetToIdle(athleteId);
  }, [
    athleteId,
    clearVoiceFeedback,
    disarmVoiceRecognizer,
    resetDraftFields,
    resetSetAnimations,
    setRestTimer,
    setVoiceAudit,
    setVoiceTranscript,
    setVoiceUsed,
  ]);

  useRestFinishedNotice(restTimer, setRestTimer, restRemainingSec, notificationCapability);

  const sortedRoutines = useMemo(() => [...routines].sort((a, b) => a.name.localeCompare(b.name)), [routines]);
  const selectedRoutine = useMemo(() => sortedRoutines.find((routine) => routine.id === routineId) || null, [routineId, sortedRoutines]);
  const selectedRoutineName = selectedRoutine?.name || "";

  const { coachNotesByExercise, expandedNoteExercise, setExpandedNoteExercise, toggleExerciseNote } =
    useCoachNotes(athleteId, selectedRoutine?.id ?? "");

  function updateExerciseAthleteNote(exIdx: number, value: string) {
    setRoutineExercises((prev) => setAthleteNote(prev, exIdx, value));
  }

  const sessionElapsedMs = useMemo(() => computeSessionElapsedMs(sessionTimer, nowMs), [sessionTimer, nowMs]);
  const sessionElapsedSec = useMemo(() => Math.floor(sessionElapsedMs / 1000), [sessionElapsedMs]);
  const sessionTimerRunning = sessionTimer.running_since_ms !== null && sessionTimer.completed_at_ms === null;
  const sessionTimerCompleted = sessionTimer.completed_at_ms !== null;
  const sessionTimerStarted = sessionTimer.started_at_ms !== null;
  const allSetsCompleted = useMemo(
    () => routineExercises.length > 0 && routineExercises.every((exercise) => exercise.sets.length > 0 && exercise.sets.every((set) => set.completed)),
    [routineExercises],
  );
  const voiceCurrentTarget = useMemo(() => findCurrentSetTarget(routineExercises), [routineExercises]);
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
      setError("Selecciona una rutina para comenzar la sesión.");
      return;
    }

    setRoutineId(routine.id);
    setError("");
    resetSetAnimations();
    const draft = routineToDraft(routine);
    setRoutineExercises(draft);
    setStartLocal(requestedDayKey ? dayKeyToDatetimeLocal(requestedDayKey) : deviceDatetimeLocal());
    setStep("capture_session");
    setSessionAthleteId(athleteId);
    const now = Date.now();
    setNowMs(now);
    setSessionTimer(createRunningSessionTimer(now));
    setRestTimer(null);
    setVoiceAudit([]);
    setVoiceUsed(false);
    clearVoiceFeedback();
  }

  // Un enlace con `?routine=` salta el paso 1, salvo que ya haya una sesión activa en curso.
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (!requestedRoutineId || !athleteId) return;
    if (step !== "pick_routine" || routines.length === 0) return;

    const stored = activeSessionDraftRef.current;
    if (stored && stored.athleteId === athleteId) return;

    const match = routines.find((item) => item.id === requestedRoutineId);
    if (!match) return;

    autoStartedRef.current = true;
    startSessionStep(match.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteId, requestedRoutineId, routines, step]);

  function goBackToRoutineStep() {
    void deactivateVoiceCapture();
    resetSetAnimations();
    setStep("pick_routine");
    setSessionTimer(IDLE_SESSION_TIMER);
    setRestTimer(null);
    clearVoiceFeedback();
    setError("");
  }

  function exitSession() {
    if (step !== "capture_session") return;

    setCloseRoutineOpen(false);
    void deactivateVoiceCapture();
    clearDraft();
    resetDraftFields(athleteId);
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

  function addSet(exIdx: number) {
    if (hasPendingSetDelete) return;
    setRoutineExercises((prev) => appendEmptySet(prev, exIdx));
  }

  function duplicateLastSet(exIdx: number) {
    if (hasPendingSetDelete) return;
    setRoutineExercises((prev) => duplicateLastSetOf(prev, exIdx));
  }

  function addExerciseFromCatalog(entry: ExerciseCatalogEntry) {
    const duplicated = routineExercises.some((item) => sameExercise(item, entry));
    if (duplicated) {
      setError("Ese ejercicio ya está en la sesión.");
      setPickerMode(null);
      return;
    }
    setError("");
    setRoutineExercises((prev) => [...prev, newExerciseFromCatalog(entry)]);
    setPickerMode(null);
  }

  function replaceExerciseFromCatalog(exIdx: number, entry: ExerciseCatalogEntry) {
    const current = routineExercises[exIdx];
    setPickerMode(null);
    if (!current || hasPendingSetDelete) return;
    if (routineExercises.some((item, i) => i !== exIdx && sameExercise(item, entry))) {
      setError("Ese ejercicio ya está en la sesión.");
      return;
    }
    setError("");
    setExpandedNoteExercise(null);
    setRestTimer((prev) => (prev && prev.exercise_index === exIdx ? null : prev));
    setRoutineExercises((prev) => replaceExerciseIdentity(prev, exIdx, entry));
  }

  async function removeExercise(exIdx: number) {
    const current = routineExercises[exIdx];
    if (!current || hasPendingSetDelete) return;
    if (exerciseHasData(current)) {
      const accepted = await confirm({
        title: "Eliminar ejercicio",
        message: `¿Eliminar "${current.name}" con sus series capturadas?`,
        confirmLabel: "Eliminar",
      });
      if (!accepted) return;
    }
    setExpandedNoteExercise(null);
    setRestTimer((prev) => shiftRestTimerAfterRemoval(prev, exIdx));
    setRoutineExercises((prev) => prev.filter((_, i) => i !== exIdx));
  }

  function saveExerciseSettings(exIdx: number, settings: ExerciseSettings) {
    setEditingExIdx(null);
    if (hasPendingSetDelete) return;
    const current = routineExercises[exIdx];
    if (!current) return;
    // La lateralidad se guarda en el nombre: cambiarla cambia el nombre del ejercicio.
    const nextName = setUnilateralName(current.name, settings.unilateral);
    if (
      nextName !== current.name &&
      routineExercises.some((item, i) => i !== exIdx && sameExercise(item, { name: nextName, group: current.group }))
    ) {
      setError("Ya existe ese ejercicio en la sesión con esa lateralidad.");
      return;
    }
    setError("");
    setRoutineExercises((prev) =>
      prev.map((item, i) => {
        if (i !== exIdx) return item;
        const sets = resizeSets(item.sets, settings.sets);
        return {
          ...item,
          name: nextName,
          // Sin lateralidad no hay lados; `completed` ya refleja ambos lados.
          sets: settings.unilateral ? sets : sets.map((set) => ({ ...set, sides: undefined })),
          target_reps_min: settings.reps_min,
          target_reps_max: settings.reps_max,
          rest_seconds: settings.rest_seconds,
        };
      }),
    );
  }

  // Handler central para inputs manuales y comandos por voz.
  function applySessionDraftCommand(command: SessionDraftCommand) {
    const currentEntry = routineExercises[command.exercise_index];
    const currentSet = currentEntry?.sets[command.set_index];
    // Estado final de "completada" tras el comando; null = el comando no cambia ese dato.
    let nextCompleted: boolean | null = null;
    if (command.type === "set_set_completed") nextCompleted = command.value;
    if (command.type === "set_set_side" && currentSet) {
      const sides = { ...setSides(currentSet), [command.side]: command.value };
      nextCompleted = sides.left && sides.right;
    }

    setRoutineExercises((prev) => applyCommandToExercises(prev, command));

    if (nextCompleted === null) return;
    // El descanso empieza cuando la serie queda completa (ambos lados) y se cancela si deja de estarlo.
    if (nextCompleted) {
      if (command.type === "set_set_completed" || !currentSet?.completed) startRestForSet(command.exercise_index, command.set_index);
      return;
    }
    setRestTimer((prev) => {
      if (!prev) return prev;
      if (prev.exercise_index !== command.exercise_index || prev.set_index !== command.set_index) return prev;
      return null;
    });
  }

  async function submit(): Promise<boolean> {
    setError("");

    if (!athleteId) {
      setError("No hay atleta activo para registrar la sesión.");
      return false;
    }

    if (!selectedRoutine) {
      setError("Selecciona una rutina para registrar la sesión.");
      return false;
    }

    if (!startLocal) {
      setError("Falta fecha/hora de inicio.");
      return false;
    }

    const now = Date.now();
    const finalizedTimer = sessionTimer.completed_at_ms === null ? completeSessionTimerState(sessionTimer, now) : sessionTimer;
    const elapsedMinutes = Number((computeSessionElapsedMs(finalizedTimer, now) / 60_000).toFixed(2));
    if (!Number.isFinite(elapsedMinutes) || elapsedMinutes <= 0) {
      setError("Inicia la sesión y espera al menos un segundo antes de guardar.");
      return false;
    }

    const built = buildSessionExercises(routineExercises, prefs.effortScale, prefs.weightUnit);
    if ("error" in built) {
      setError(built.error);
      return false;
    }
    const exercisesOut = built.exercises;
    if (exercisesOut.length === 0) {
      setError("Captura al menos un set con reps y carga antes de guardar.");
      return false;
    }

    const payload = buildSessionPayload({
      athleteId,
      startLocal,
      elapsedMinutes,
      sessionRpeAuto,
      exercises: exercisesOut,
      notes,
      routine: selectedRoutine,
      effortScale: prefs.effortScale,
      weightUnit: prefs.weightUnit,
      finalizedTimer,
      nowMs: now,
      allSetsCompleted,
      sleepScore,
      stressScore,
      sensationScore,
      voiceAssistDesktopEnabled,
      voiceUsed,
      voiceAudit,
    });

    setSessionTimer(finalizedTimer);
    setRestTimer(null);
    setNowMs(now);

    setBusy(true);
    try {
      resetSetAnimations();
      await ingestSessions(payload);
      await deactivateVoiceCapture();
      // Salir de capture_session antes de limpiar: si no, el efecto de autoguardado
      // (que depende del borrador) lo vuelve a escribir y la barra de sesión se queda.
      setStep("pick_routine");
      clearDraft();
      nav("/home");
      return true;
    } catch (cause: unknown) {
      if (isNetworkError(cause)) {
        // Sin conexión: la sesión queda en cola local y se sube al reconectar.
        enqueueSessionUpload(payload);
        await deactivateVoiceCapture();
        setStep("pick_routine");
        clearDraft();
        nav("/home");
        return true;
      }
      setError(errorMessage(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const hasActiveAthlete = Boolean(athleteId);

  if (step === "pick_routine") {
    return (
      <PickRoutineStep
        routines={sortedRoutines}
        routineId={routineId}
        requestedDayKey={requestedDayKey}
        error={error}
        hasActiveAthlete={hasActiveAthlete}
        noAthletesAssigned={canSwitch && athleteReady && athleteIds.length === 0}
        onStartRoutine={startSessionStep}
        onGoToTraining={() => nav("/training")}
      />
    );
  }

  return (
    <div className="container stack">
      {dialog}
      <header className="titleBlock">
        <h1>Sesión por rutina</h1>
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
          <ExtrasMenu
            onChangeRoutine={goBackToRoutineStep}
            onCloseRoutine={() => setCloseRoutineOpen(true)}
          />
        </div>
      </section>

      <div className="sessionStartText">{formatStartLabel(startLocal)}</div>

      <SessionTimerCard
        sessionTimer={sessionTimer}
        elapsedSec={sessionElapsedSec}
        running={sessionTimerRunning}
        completed={sessionTimerCompleted}
        started={sessionTimerStarted}
        onPause={pauseSessionTimer}
        onResume={startOrResumeSessionTimer}
      />

      <section className="surface dataSection">
        <button
          type="button"
          className="dataSectionToggle"
          aria-expanded={dataOpen}
          onClick={() => setDataOpen((prev) => !prev)}
        >
          <span>
            <strong>Datos de la rutina</strong>
            <span className="small">{` · Sueño ${sleepScore} · Estrés ${stressScore} · Sensación ${sensationScore}`}</span>
          </span>
          <span aria-hidden="true">{dataOpen ? "▲" : "▼"}</span>
        </button>

        {dataOpen ? (
          <>
            <WellnessPanel
              sleepScore={sleepScore}
              stressScore={stressScore}
              sensationScore={sensationScore}
              onSleepChange={setSleepScore}
              onStressChange={setStressScore}
              onSensationChange={setSensationScore}
            />

            <div style={{ marginTop: 12 }}>
              <label className="smallLabel">Comentarios</label>
              <input
                className="input"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="comentarios adicionales de la sesión"
              />
            </div>
          </>
        ) : null}
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

        {!selectedRoutine ? (
          <div className="emptyState" style={{ marginTop: 12 }}>
            Aún no seleccionaste una rutina.
          </div>
        ) : (
          <div className="stack" style={{ marginTop: 12 }}>
            {routineExercises.map((exercise, exIdx) => (
              <ExerciseCard
                key={`${selectedRoutine.id}_${exercise.name}_${exIdx}`}
                exercise={exercise}
                exIdx={exIdx}
                exerciseNotes={coachNotesByExercise[normalizeExerciseNameForNotes(exercise.name)] || []}
                noteExpanded={expandedNoteExercise === exIdx}
                weightUnit={prefs.weightUnit}
                effortScale={prefs.effortScale}
                uncheckingSetKeys={uncheckingSetKeys}
                deletingSetKeys={deletingSetKeys}
                hasPendingSetDelete={hasPendingSetDelete}
                onToggleNote={toggleExerciseNote}
                onAthleteNoteChange={updateExerciseAthleteNote}
                onCommand={applySessionDraftCommand}
                onToggleSetCompleted={handleSetCompletedToggle}
                onToggleSetSide={(exIdx, setIdx, side, value) =>
                  applySessionDraftCommand({ type: "set_set_side", exercise_index: exIdx, set_index: setIdx, side, value })
                }
                onRemoveSet={handleRemoveSetWithAnimation}
                onAddSet={addSet}
                onDuplicateLastSet={duplicateLastSet}
                onEditExercise={setEditingExIdx}
                onReplaceExercise={(idx) => setPickerMode({ type: "replace", exIdx: idx })}
                onRemoveExercise={removeExercise}
              />
            ))}
            <button className="btn" type="button" onClick={() => setPickerMode({ type: "add" })} disabled={hasPendingSetDelete}>
              + Agregar ejercicio
            </button>
          </div>
        )}
      </section>

      <section className="surface">
        <div className="chipRow" style={{ marginBottom: 10 }}>
          <span className="chip">{`RPE sesión (auto): ${sessionRpeAuto === null ? "-" : sessionRpeAuto.toFixed(2)}`}</span>
          <span className="chip">{`Calculado desde ${prefs.effortScale.toUpperCase()} por serie`}</span>
        </div>
        {error ? (
          <div className="message error" style={{ marginBottom: 10 }}>
            {error}
          </div>
        ) : null}

        <div className="hstack">
          <button className="btn primary" onClick={() => void submit()} disabled={busy || !selectedRoutine || !hasActiveAthlete}>
            {busy ? "Completando..." : "Completar sesión"}
          </button>
          <button className="btn" onClick={() => nav("/home")} disabled={busy}>
            Salir
          </button>
          <button className="btn trashBtn" type="button" onClick={() => setCloseRoutineOpen(true)} disabled={busy}>
            Cerrar sin guardar
          </button>
        </div>

        {!hasActiveAthlete ? <div className="small">No hay atleta activo: selecciona uno para poder guardar.</div> : null}
        {hasActiveAthlete && !selectedRoutine ? <div className="small">Selecciona una rutina para poder guardar.</div> : null}
      </section>

      <VoiceDock
        open={voiceDockOpen}
        voiceStatus={voiceStatus}
        captureActive={voiceCaptureActive}
        assistEnabled={voiceAssistDesktopEnabled}
        clipboardBusy={clipboardBusy}
        currentTarget={voiceCurrentTarget}
        transcript={voiceTranscript}
        partial={voicePartial}
        transcriptDisplay={voiceTranscriptDisplay}
        error={voiceError}
        auditPreview={voiceAuditPreview}
        onOpen={() => setVoiceDockOpen(true)}
        onClose={() => setVoiceDockOpen(false)}
        onToggleAssist={toggleVoiceAssistDesktop}
        onStart={() => void startVoiceCapture()}
        onStop={() => void deactivateVoiceCapture()}
        onTranscribeClipboard={() => void transcribeClipboardText()}
        onClear={() => {
          setVoiceTranscript("");
          setVoicePartial("");
          setVoiceError("");
        }}
      />

      {pickerMode ? (
        <SessionExercisePicker
          title={pickerMode.type === "add" ? "Agregar ejercicio" : "Reemplazar ejercicio"}
          hint={
            pickerMode.type === "add"
              ? `En la sesión: ${routineExercises.length}`
              : `Reemplaza: ${routineExercises[pickerMode.exIdx]?.name ?? ""}`
          }
          addedCount={routineExercises.length}
          isAdded={(entry) => routineExercises.some((item) => sameExercise(item, entry))}
          onPick={(entry) =>
            pickerMode.type === "add" ? addExerciseFromCatalog(entry) : replaceExerciseFromCatalog(pickerMode.exIdx, entry)
          }
          onClose={() => setPickerMode(null)}
        />
      ) : null}

      {editingExIdx !== null && routineExercises[editingExIdx] ? (
        <ExerciseEditModal
          exercise={routineExercises[editingExIdx]}
          onSave={(settings) => saveExerciseSettings(editingExIdx, settings)}
          onClose={() => setEditingExIdx(null)}
        />
      ) : null}

      {closeRoutineOpen ? (
        <CloseRoutineModal
          error={error}
          busy={busy}
          canSave={Boolean(selectedRoutine) && hasActiveAthlete}
          onComplete={() => {
            void submit().then((saved) => {
              if (saved) setCloseRoutineOpen(false);
            });
          }}
          onCancelRoutine={exitSession}
          onBack={() => setCloseRoutineOpen(false)}
        />
      ) : null}

      {restTimer ? (
        <RestFloatBar
          restTimer={restTimer}
          remainingSecSigned={restRemainingSecSigned}
          progressPct={restProgressPct}
          notificationCapability={notificationCapability}
          onRequestNotifications={() => void requestDeviceNotifications()}
          onClose={clearRestTimer}
        />
      ) : null}
    </div>
  );
}
