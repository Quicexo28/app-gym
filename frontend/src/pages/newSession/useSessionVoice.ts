import { useCallback, useEffect, useRef, useState } from "react";

import type { OfflineVoskRecognizer as OfflineVoskRecognizerClass } from "../../lib/voice/offlineRecognizer";
import type { OfflineRecognizerFinalTranscript, OfflineRecognizerState } from "../../lib/voice/types";
import {
  appendVoiceTranscript,
  clampVoiceConfidence,
  describeMicrophoneError,
  ENABLE_OFFLINE_VOICE_CAPTURE,
  MAX_VOICE_AUDIT_ENTRIES,
  normalizeTranscriptText,
  readVoiceAssistDesktopPreference,
  writeVoiceAssistDesktopPreference,
  VOICE_MODEL_URL,
} from "../../lib/session/voice";
import type { SessionStep } from "../../lib/session/types";
import type { ActiveSessionVoiceCommandAudit } from "../../state/activeSession";
import { errorMessage } from "../../lib/errors";

type UseSessionVoiceArgs = {
  step: SessionStep;
  initialAudit: ActiveSessionVoiceCommandAudit[];
  initialUsed: boolean;
};

// Estado y acciones de la asistencia por voz (micrófono offline y portapapeles) de la sesión.
export function useSessionVoice({ step, initialAudit, initialUsed }: UseSessionVoiceArgs) {
  const [voiceAudit, setVoiceAudit] = useState<ActiveSessionVoiceCommandAudit[]>(initialAudit);
  const [voiceTranscript, setVoiceTranscript] = useState<string>("");
  const [voiceUsed, setVoiceUsed] = useState<boolean>(initialUsed);
  const [voiceAssistDesktopEnabled, setVoiceAssistDesktopEnabled] = useState<boolean>(() => readVoiceAssistDesktopPreference());
  const [voiceStatus, setVoiceStatus] = useState<OfflineRecognizerState>("inactive");
  const [voiceError, setVoiceError] = useState<string>("");
  const [voicePartial, setVoicePartial] = useState<string>("");
  // El dock de voz arranca plegado: antes flotaba siempre abierto y tapaba la
  // columna de RPE de cada serie.
  const [voiceDockOpen, setVoiceDockOpen] = useState<boolean>(false);
  const [clipboardBusy, setClipboardBusy] = useState(false);

  const voiceRecognizerRef = useRef<OfflineVoskRecognizerClass | null>(null);
  const voiceStartingRef = useRef(false);
  const voiceStatusPulseTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    writeVoiceAssistDesktopPreference(voiceAssistDesktopEnabled);
  }, [voiceAssistDesktopEnabled]);

  const appendVoiceAuditEntry = useCallback((entry: ActiveSessionVoiceCommandAudit) => {
    setVoiceAudit((prev) => {
      const next = [...prev, entry];
      if (next.length <= MAX_VOICE_AUDIT_ENTRIES) return next;
      return next.slice(next.length - MAX_VOICE_AUDIT_ENTRIES);
    });
  }, []);

  const transcribeClipboardText = useCallback(async () => {
    setVoiceError("");
    if (!voiceAssistDesktopEnabled) {
      setVoiceError("La asistencia por voz esta desactivada.");
      return;
    }
    if (!("clipboard" in navigator) || typeof navigator.clipboard.readText !== "function") {
      setVoiceError("Este navegador no permite leer el portapapeles.");
      return;
    }

    setClipboardBusy(true);
    try {
      const clipboardText = await navigator.clipboard.readText();
      const normalized = normalizeTranscriptText(clipboardText);
      if (!normalized) {
        setVoiceError("El portapapeles no contiene texto para transcribir.");
        return;
      }

      setVoiceUsed(true);
      setVoiceTranscript((previous) => appendVoiceTranscript(previous, normalized));
      setVoicePartial("");
      appendVoiceAuditEntry({
        timestamp_ms: Date.now(),
        transcript_normalized: normalized,
        intent: "none",
        exercise_index: null,
        set_index: null,
        exercise_name: null,
        value_text: null,
        confidence: 1,
        applied: false,
        reason: "Transcripción manual desde portapapeles.",
      });
    } catch (cause: unknown) {
      const message = errorMessage(cause);
      setVoiceError(`No pude leer el portapapeles: ${message}`);
      setVoiceStatus("error");
    } finally {
      setClipboardBusy(false);
    }
  }, [appendVoiceAuditEntry, voiceAssistDesktopEnabled]);

  const startVoiceCaptureInner = useCallback(async () => {
    setVoiceError("");
    if (!voiceAssistDesktopEnabled) {
      setVoiceError("La asistencia por voz esta desactivada.");
      return;
    }
    if (!ENABLE_OFFLINE_VOICE_CAPTURE) {
      setVoiceError("La feature VITE_ENABLE_OFFLINE_VOICE_CAPTURE esta en false.");
      return;
    }
    if (!("mediaDevices" in navigator) || typeof navigator.mediaDevices?.getUserMedia !== "function") {
      setVoiceError("Este navegador no permite acceso al microfono.");
      setVoiceStatus("error");
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
      return;
    }

    let voiceModule: typeof import("../../lib/voice/offlineRecognizer");
    try {
      voiceModule = await import("../../lib/voice/offlineRecognizer");
    } catch (cause: unknown) {
      const message = errorMessage(cause);
      setVoiceError(`No pude cargar el motor de voz: ${message}`);
      setVoiceStatus("error");
      return;
    }

    if (!voiceModule.browserSupportsOfflineRecognizer()) {
      setVoiceError("Este navegador no soporta captura de microfono offline para voz.");
      setVoiceStatus("error");
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
          },
          onFinalTranscript: (result: OfflineRecognizerFinalTranscript) => {
            const normalized = normalizeTranscriptText(result.text);
            if (!normalized) return;
            setVoiceUsed(true);
            setVoiceTranscript((previous) => appendVoiceTranscript(previous, normalized));
            setVoicePartial("");
            appendVoiceAuditEntry({
              timestamp_ms: Date.now(),
              transcript_normalized: normalized,
              intent: "none",
              exercise_index: null,
              set_index: null,
              exercise_name: null,
              value_text: null,
              confidence: clampVoiceConfidence(result.confidence),
              applied: false,
              reason: "Transcripción por microfono (sin aplicar comando).",
            });
          },
          onError: (message) => {
            setVoiceError(message);
            setVoiceStatus("error");
          },
        },
      });
      voiceRecognizerRef.current = recognizer;
    }

    try {
      await recognizer.arm();
    } catch (cause: unknown) {
      const message = errorMessage(cause);
      setVoiceError(`No se pudo iniciar la escucha: ${message}`);
      setVoiceStatus("error");
    }
  }, [appendVoiceAuditEntry, voiceAssistDesktopEnabled]);

  // Evita que un doble clic cree dos recognizers mientras los await del arranque siguen en curso.
  const startVoiceCapture = useCallback(async () => {
    if (voiceStartingRef.current) return;
    voiceStartingRef.current = true;
    try {
      await startVoiceCaptureInner();
    } finally {
      voiceStartingRef.current = false;
    }
  }, [startVoiceCaptureInner]);

  const deactivateVoiceCapture = useCallback(async () => {
    if (voiceStatusPulseTimeoutRef.current !== null) {
      window.clearTimeout(voiceStatusPulseTimeoutRef.current);
      voiceStatusPulseTimeoutRef.current = null;
    }
    const recognizer = voiceRecognizerRef.current;
    if (!recognizer) {
      setVoiceStatus("inactive");
      setVoicePartial("");
      return;
    }

    try {
      await recognizer.disarm();
      setVoiceError("");
    } catch (cause: unknown) {
      const message = errorMessage(cause);
      setVoiceError(message);
      setVoiceStatus("error");
    }
  }, []);

  const toggleVoiceAssistDesktop = useCallback(() => {
    if (voiceAssistDesktopEnabled) {
      void deactivateVoiceCapture();
      setVoiceError("");
    }
    setVoiceAssistDesktopEnabled((prev) => !prev);
  }, [deactivateVoiceCapture, voiceAssistDesktopEnabled]);

  useEffect(() => {
    if (step === "capture_session") return;
    void deactivateVoiceCapture();
  }, [deactivateVoiceCapture, step]);

  useEffect(
    () => () => {
      if (voiceStatusPulseTimeoutRef.current !== null) {
        window.clearTimeout(voiceStatusPulseTimeoutRef.current);
        voiceStatusPulseTimeoutRef.current = null;
      }
      const recognizer = voiceRecognizerRef.current;
      voiceRecognizerRef.current = null;
      if (!recognizer) return;
      void recognizer.dispose();
    },
    [],
  );

  // Limpia el estado visible de voz sin tocar la transcripción ni la auditoría.
  const clearVoiceFeedback = useCallback(() => {
    setVoiceError("");
    setVoicePartial("");
    setVoiceStatus("inactive");
  }, []);

  // Desarma el reconocedor activo (si existe) sin esperar el resultado.
  const disarmVoiceRecognizer = useCallback(() => {
    if (voiceRecognizerRef.current) {
      void voiceRecognizerRef.current.disarm();
    }
  }, []);

  const voiceCaptureActive = voiceStatus === "armed" || voiceStatus === "listening";
  const voiceTranscriptDisplay = (() => {
    const partial = normalizeTranscriptText(voicePartial);
    if (!partial) return voiceTranscript;
    return appendVoiceTranscript(voiceTranscript, partial);
  })();
  const voiceAuditPreview = [...voiceAudit].slice(Math.max(0, voiceAudit.length - 8)).reverse();

  return {
    voiceAudit,
    setVoiceAudit,
    voiceTranscript,
    setVoiceTranscript,
    voiceUsed,
    setVoiceUsed,
    voiceAssistDesktopEnabled,
    voiceStatus,
    voiceError,
    setVoiceError,
    voicePartial,
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
  };
}
