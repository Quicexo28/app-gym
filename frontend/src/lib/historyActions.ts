// Operaciones de borrado del historial, todas en un solo lugar. Cada una borra y devuelve
// cómo restaurar lo borrado. El diálogo, el aviso de deshacer y los errores los pone
// `useHistoryDelete`; las pantallas solo describen qué borrar.

import {
  createDietEntry,
  deleteDietEntry,
  deleteSession,
  getDietEntries,
  ingestSessions,
  type SessionHistoryItem,
} from "../api";
import { mealEntryToCreatePayload } from "./nutrition/dietApi";
import { errorMessage } from "./errors";

export type DeleteOutcome = {
  /** Cómo devolver lo que sí se borró. null si no se borró nada. */
  restore: (() => Promise<void>) | null;
  /** Texto de aviso si algo no se pudo borrar. */
  warning?: string;
};


function sessionToPayload(item: SessionHistoryItem) {
  return {
    athlete_id: item.athlete_id,
    start_time: item.start_time,
    duration_min: item.duration_min,
    rpe: item.rpe,
    modality: item.modality,
    exercises: item.exercises,
    source: item.source,
    meta: item.meta,
  };
}

/** Borra una o varias sesiones. Restaurar las vuelve a guardar con sus mismos datos. */
export async function deleteSessions(sessions: SessionHistoryItem[]): Promise<DeleteOutcome> {
  const deleted: SessionHistoryItem[] = [];
  let failure = "";
  for (const session of sessions) {
    try {
      await deleteSession(session.id);
      deleted.push(session);
    } catch (cause: unknown) {
      failure = errorMessage(cause);
    }
  }
  const failed = sessions.length - deleted.length;
  return {
    restore: deleted.length ? async () => void (await ingestSessions(deleted.map(sessionToPayload))) : null,
    warning: failed ? `No se pudieron borrar ${failed} de ${sessions.length} sesiones: ${failure}` : undefined,
  };
}

/** Borra todos los registros de comida de un día. Restaurar los crea otra vez. */
export async function deleteDietDay(athleteId: string, day: string): Promise<DeleteOutcome> {
  const { items } = await getDietEntries(athleteId, day);
  const deleted: typeof items = [];
  for (const entry of items) {
    try {
      await deleteDietEntry(entry.id);
      deleted.push(entry);
    } catch {
      // Se cuenta abajo como no borrado.
    }
  }
  const failed = items.length - deleted.length;
  return {
    restore: deleted.length
      ? async () => {
          for (const entry of deleted) await createDietEntry(mealEntryToCreatePayload(entry));
        }
      : null,
    warning: failed ? `No se pudieron borrar ${failed} de ${items.length} registros.` : undefined,
  };
}
