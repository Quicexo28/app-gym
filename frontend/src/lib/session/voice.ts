import type { OfflineRecognizerState } from "../voice/types";

export const MAX_VOICE_AUDIT_ENTRIES = 50;

export const ENABLE_OFFLINE_VOICE_CAPTURE =
  ((import.meta.env.VITE_ENABLE_OFFLINE_VOICE_CAPTURE as string | undefined)?.trim().toLowerCase() ?? "") === "true";

export const VOICE_ENGINE = "vosk-browser@0.0.8";

export const VOICE_MODEL_ID = "vosk-model-small-es-0.42";

export const VOICE_MODEL_URL = `/models/${VOICE_MODEL_ID}.zip`;

export const VOICE_LANGUAGE = "es-ES";

export const VOICE_WAKE_PHRASE = "alzo";

export const VOICE_ASSIST_DESKTOP_KEY = "coach_ai_voice_assist_desktop_v1";

export function readVoiceAssistDesktopPreference(): boolean {
  if (typeof window === "undefined") return true;
  const raw = window.localStorage.getItem(VOICE_ASSIST_DESKTOP_KEY);
  if (raw === "0") return false;
  if (raw === "1") return true;
  return true;
}

export function voiceStatusLabel(status: OfflineRecognizerState): string {
  if (status === "inactive") return "Inactiva";
  if (status === "loading") return "Cargando modelo";
  if (status === "listening") return "Escuchando";
  if (status === "error") return "Error";
  return "Armada";
}

export function normalizeTranscriptText(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function clampVoiceConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

export function describeMicrophoneError(cause: unknown): string {
  const payload = cause as { name?: string; message?: string };
  const name = String(payload?.name ?? "");
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Permiso de microfono denegado en el navegador.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No se detecto un microfono disponible.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "El microfono esta ocupado por otra aplicación.";
  }
  if (name === "SecurityError") {
    return "La captura de microfono requiere HTTPS o localhost.";
  }
  const message = String(payload?.message ?? "");
  return message || String(cause);
}

export function appendVoiceTranscript(previous: string, chunk: string): string {
  const normalizedChunk = normalizeTranscriptText(chunk);
  if (!normalizedChunk) return previous;
  if (!previous) return normalizedChunk;
  if (previous.toLowerCase().endsWith(normalizedChunk.toLowerCase())) return previous;
  return `${previous} ${normalizedChunk}`.trim();
}
