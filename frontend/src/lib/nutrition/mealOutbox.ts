import { ApiError, createDietEntry, type MealEntryCreatePayload } from "../../api";
import { isNetworkError } from "../sessionOutbox";
import { loadJSON, saveJSON, uid } from "../storage";

/**
 * Cola local de comidas pendientes de subir (soporte offline), mismo patron
 * que `lib/sessionOutbox.ts`.
 *
 * A diferencia de las sesiones, el backend de `POST /diet/entries` NO
 * deduplicaba por naturaleza: reintentar el mismo payload creaba una comida
 * repetida en el diario del usuario. Para que reintentar sea seguro, cada
 * entrada encolada lleva un `client_ref` generado UNA VEZ, AL ENCOLAR (no al
 * enviar) — así todos los reintentos del mismo registro viajan con el mismo
 * ref, y el backend devuelve la entrada ya creada en vez de duplicarla
 * (doc `modulo-dieta.md` #7 criterio 6).
 */

export type MealOutboxEntry = {
  id: string;
  payload: MealEntryCreatePayload;
  created_at_ms: number;
  attempts: number;
  last_error?: string;
};

const KEY = "coach_ai_meal_outbox_v1";
const MAX_ATTEMPTS = 20;

export const MEAL_OUTBOX_CHANGED_EVENT = "coach-ai:meal-outbox-changed";

let flushing = false;

function readOutbox(): MealOutboxEntry[] {
  const raw = loadJSON<unknown>(KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is MealOutboxEntry =>
      !!entry && typeof entry === "object" && "id" in entry && "payload" in entry,
  );
}

/** Token vencido o sin permiso: reintentable después de volver a iniciar sesión. */
function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

function writeOutbox(entries: MealOutboxEntry[]): void {
  saveJSON(KEY, entries);
  window.dispatchEvent(new CustomEvent(MEAL_OUTBOX_CHANGED_EVENT));
}

export function mealOutboxCount(): number {
  return readOutbox().length;
}

/** Encola una comida para subir después. El `client_ref` se fija aquí, una sola vez. */
export function enqueueMealEntry(payload: MealEntryCreatePayload): void {
  const entries = readOutbox();
  entries.push({
    id: uid("mealoutbox"),
    payload: { ...payload, client_ref: uid("meal") },
    created_at_ms: Date.now(),
    attempts: 0,
  });
  writeOutbox(entries);
}

/**
 * Intenta subir todo lo pendiente. Se detiene al primer fallo de red
 * (sin conexión: no tiene sentido seguir). Errores del servidor (4xx/5xx)
 * incrementan attempts y no bloquean el resto de la cola.
 */
export async function flushMealOutbox(): Promise<{ uploaded: number; remaining: number }> {
  if (flushing) return { uploaded: 0, remaining: mealOutboxCount() };
  flushing = true;
  let uploaded = 0;

  try {
    const entries = readOutbox();
    if (entries.length === 0) return { uploaded: 0, remaining: 0 };

    const keep: MealOutboxEntry[] = [];
    for (const [index, entry] of entries.entries()) {
      try {
        await createDietEntry(entry.payload);
        uploaded += 1;
      } catch (error: unknown) {
        if (isNetworkError(error) || isAuthError(error)) {
          // Sin red o sesión vencida: conservar esta y todas las siguientes tal
          // cual. Gastar intentos con un 401 termina descartando comidas que el
          // usuario si registro, solo porque el token expiro.
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
          console.error("Comida descartada del outbox tras demasiados intentos", entry, error);
        }
      }
    }

    // Releer por si se encolo algo durante el flush.
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

/** Instala flush automático al reconectar y al volver a la pestana. Idempotente. */
export function installMealOutboxAutoFlush(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;

  window.addEventListener("online", () => {
    void flushMealOutbox();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine && mealOutboxCount() > 0) {
      void flushMealOutbox();
    }
  });
}
