import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { ingestSessions, listCoachNotes, markCoachNoteRead } from "../api";
import type { CoachNote } from "../api";
import { dayKeyToDatetimeLocal } from "../lib/dates";
import { buildSessionExercises, buildSessionPayload } from "../lib/session/buildPayload";
import {
  deviceDatetimeLocal,
  formatStartLabel,
  normalizeExerciseNameForNotes,
} from "../lib/session/format";
import { EMPTY_SET, parseSetEffortValue, routineToDraft } from "../lib/session/routine";
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
import ExerciseCard from "./newSession/ExerciseCard";
import PickRoutineStep from "./newSession/PickRoutineStep";
import RestFloatBar from "./newSession/RestFloatBar";
import SessionTimerCard from "./newSession/SessionTimerCard";
import { useRestFinishedNotice, useRestTimer } from "./newSession/useRestTimer";
import { useSessionVoice } from "./newSession/useSessionVoice";
import { useSetRowAnimations } from "./newSession/useSetRowAnimations";
import VoiceDock from "./newSession/VoiceDock";
import WellnessPanel from "./newSession/WellnessPanel";
import "../styles.rutinas.css";

export default function NewSession() {
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
  const [sleepScore, setSleepScore] = useState<number>(() => draftForAthlete?.sleepScore ?? 7);
  const [stressScore, setStressScore] = useState<number>(() => draftForAthlete?.stressScore ?? 5);
  const [sensationScore, setSensationScore] = useState<number>(() => draftForAthlete?.sensationScore ?? 7);

  const [routineId, setRoutineId] = useState<string>(() => draftForAthlete?.routineId ?? "");
  const [routines, setRoutines] = useState<RoutineTemplate[]>([]);
  const [routineExercises, setRoutineExercises] = useState<RoutineExerciseDraft[]>(() => draftForAthlete?.routineExercises ?? []);
  const [coachNotesByExercise, setCoachNotesByExercise] = useState<Record<string, CoachNote[]>>({});
  const [expandedNoteExercise, setExpandedNoteExercise] = useState<number | null>(null);

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
  const [extrasMenuOpen, setExtrasMenuOpen] = useState(false);
  const [closeRoutineOpen, setCloseRoutineOpen] = useState(false);
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

  useEffect(() => {
    const resetToIdle = (nextSessionAthleteId: string) => {
      disarmVoiceRecognizer();
      resetSetAnimations();
      setRoutineId("");
      setRoutineExercises([]);
      setStep("pick_routine");
      setSessionAthleteId(nextSessionAthleteId);
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
      clearVoiceFeedback();
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

  // Indicaciones del entrenador para los ejercicios de esta rutina - se cargan
  // una vez al elegir rutina, no por set (ver notepad icon en cada exerciseCard).
  useEffect(() => {
    if (!athleteId || !selectedRoutine) {
      setCoachNotesByExercise({});
      return;
    }
    let cancelled = false;
    listCoachNotes({ athlete_id: athleteId, routine_id: selectedRoutine.id })
      .then((notes) => {
        if (cancelled) return;
        const grouped: Record<string, CoachNote[]> = {};
        for (const note of notes) {
          const key = note.exercise_name_normalized || "";
          (grouped[key] ||= []).push(note);
        }
        setCoachNotesByExercise(grouped);
      })
      .catch(() => {
        if (!cancelled) setCoachNotesByExercise({});
      });
    return () => {
      cancelled = true;
    };
  }, [athleteId, selectedRoutine]);

  function updateExerciseAthleteNote(exIdx: number, value: string) {
    setRoutineExercises((prev) => prev.map((entry, i) => (i === exIdx ? { ...entry, athleteNote: value } : entry)));
  }

  function handleToggleExerciseNote(exIdx: number, notes: CoachNote[]) {
    setExpandedNoteExercise((prev) => (prev === exIdx ? null : exIdx));
    const unread = notes.filter((note) => !note.read_at_utc);
    if (unread.length === 0) return;
    const nowIso = new Date().toISOString();
    setCoachNotesByExercise((prev) => {
      const next = { ...prev };
      for (const note of unread) {
        const key = note.exercise_name_normalized || "";
        next[key] = (next[key] || []).map((item) => (item.id === note.id ? { ...item, read_at_utc: nowIso } : item));
      }
      return next;
    });
    for (const note of unread) {
      void markCoachNoteRead(note.id).catch(() => {});
    }
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

  useEffect(() => {
    if (!extrasMenuOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExtrasMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [extrasMenuOpen]);

  function goBackToRoutineStep() {
    setExtrasMenuOpen(false);
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

    setExtrasMenuOpen(false);
    setCloseRoutineOpen(false);
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
    setVoiceUsed(false);
    clearVoiceFeedback();
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
      setError(String((cause as { message?: string })?.message || cause));
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
          <div className="extrasMenu">
            <button
              type="button"
              className="menuBtn"
              aria-label="Funciones extra"
              aria-haspopup="menu"
              aria-expanded={extrasMenuOpen}
              onClick={() => setExtrasMenuOpen((prev) => !prev)}
            >
              <span className="menuBtnBars" aria-hidden="true" />
            </button>

            {extrasMenuOpen ? (
              <>
                <div className="extrasMenuBackdrop" onClick={() => setExtrasMenuOpen(false)} />
                <div className="extrasMenuPanel" role="menu" aria-label="Funciones extra">
                  <button className="extrasMenuItem" type="button" role="menuitem" onClick={goBackToRoutineStep}>
                    Cambiar rutina
                  </button>
                  <button
                    className="extrasMenuItem danger"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setExtrasMenuOpen(false);
                      setCloseRoutineOpen(true);
                    }}
                  >
                    Cerrar rutina
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </section>

      <div className="sessionStartText">{formatStartLabel(startLocal)}</div>

      <section className="surface">
        <div className="sectionHead">
          <h3>Datos de la rutina</h3>
        </div>

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

        <SessionTimerCard
          sessionTimer={sessionTimer}
          elapsedSec={sessionElapsedSec}
          running={sessionTimerRunning}
          completed={sessionTimerCompleted}
          started={sessionTimerStarted}
          onPause={pauseSessionTimer}
          onResume={startOrResumeSessionTimer}
        />

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
                onToggleNote={handleToggleExerciseNote}
                onAthleteNoteChange={updateExerciseAthleteNote}
                onCommand={applySessionDraftCommand}
                onToggleSetCompleted={handleSetCompletedToggle}
                onRemoveSet={handleRemoveSetWithAnimation}
                onAddSet={addSet}
                onDuplicateLastSet={duplicateLastSet}
              />
            ))}
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
            Cancelar
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
