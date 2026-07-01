import { ApiError, ingestSessions } from "../api";
import { loadJSON, saveJSON, uid } from "./storage";

/**
 * Cola local de sesiones pendientes de subir (soporte offline).
 * El backend deduplica por (athlete_id, start_time), así que reintentar
 * el mismo payload es seguro.
 */

export type OutboxEntry = {
  id: string;
  payload: unknown;
  created_at_ms: number;
  attempts: number;
  last_error?: string;
};

const KEY = "coach_ai_session_outbox_v1";
const MAX_ATTEMPTS = 20;

export const OUTBOX_CHANGED_EVENT = "coach-ai:session-outbox-changed";

let flushing = false;

function readOutbox(): OutboxEntry[] {
  const raw = loadJSON<unknown>(KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is OutboxEntry =>
      !!entry && typeof entry === "object" && "id" in entry && "payload" in entry,
  );
}

function writeOutbox(entries: OutboxEntry[]): void {
  saveJSON(KEY, entries);
  window.dispatchEvent(new CustomEvent(OUTBOX_CHANGED_EVENT));
}

export function outboxCount(): number {
  return readOutbox().length;
}

export function enqueueSessionUpload(payload: unknown): void {
  const entries = readOutbox();
  entries.push({
    id: uid("outbox"),
    payload,
    created_at_ms: Date.now(),
    attempts: 0,
  });
  writeOutbox(entries);
}

/** true si el error es de red (sin respuesta del servidor) y conviene reintentar luego. */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof ApiError) return false;
  return true;
}

/**
 * Intenta subir todo lo pendiente. Se detiene al primer fallo de red
 * (sin conexión: no tiene sentido seguir). Errores del servidor (4xx/5xx)
 * incrementan attempts y no bloquean el resto de la cola.
 */
export async function flushSessionOutbox(): Promise<{ uploaded: number; remaining: number }> {
  if (flushing) return { uploaded: 0, remaining: outboxCount() };
  flushing = true;
  let uploaded = 0;

  try {
    const entries = readOutbox();
    if (entries.length === 0) return { uploaded: 0, remaining: 0 };

    const keep: OutboxEntry[] = [];
    for (const [index, entry] of entries.entries()) {
      try {
        await ingestSessions(entry.payload);
        uploaded += 1;
      } catch (error: unknown) {
        if (isNetworkError(error)) {
          // Sin red: conservar esta y todas las siguientes tal cual.
          keep.push(entry, ...entries.slice(index + 1));
          break;
        }
        const attempts = entry.attempts + 1;
        if (attempts < MAX_ATTEMPTS) {
          keep.push({
            ...entry,
            attempts,
            last_error: error instanceof Error ? error.message : String(error),
          });
        } else {
          console.error("Sesión descartada del outbox tras demasiados intentos", entry, error);
        }
      }
    }

    // Releer por si se encoló algo durante el flush.
    const fresh = readOutbox();
    const processedIds = new Set(entries.map((e) => e.id));
    const appended = fresh.filter((e) => !processedIds.has(e.id));
    writeOutbox([...keep, ...appended]);

    return { uploaded, remaining: keep.length + appended.length };
  } finally {
    flushing = false;
  }
}

let listenersInstalled = false;

/** Instala flush automático al reconectar y al volver a la pestaña. Idempotente. */
export function installSessionOutboxAutoFlush(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;

  window.addEventListener("online", () => {
    void flushSessionOutbox();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine && outboxCount() > 0) {
      void flushSessionOutbox();
    }
  });
}
