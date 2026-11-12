import { Capacitor, registerPlugin } from "@capacitor/core";

// Estado minimo que pinta la Live Activity (iOS 16.2+). Son fechas, no textos
// formateados: con la pantalla bloqueada el JS esta congelado y los contadores
// los dibuja SwiftUI solos.
export type SessionLiveActivityState = {
  routineName: string;
  exerciseName: string;
  /** Serie en curso (1-based) y total de series del ejercicio actual. */
  setNumber: number;
  setTotal: number;
  setsDone: number;
  setsAll: number;
  /** Cronometro corriendo: instante virtual de inicio (now - transcurrido). null si esta en pausa. */
  elapsedAnchorMs: number | null;
  /** Transcurrido congelado cuando esta en pausa. */
  elapsedPausedMs: number;
  /** Fin del descanso en curso; null si no hay. */
  restEndsAtMs: number | null;
};

type SessionLiveActivityPlugin = {
  sync(state: SessionLiveActivityState): Promise<void>;
  end(): Promise<void>;
};

const SessionLiveActivity = registerPlugin<SessionLiveActivityPlugin>("SessionLiveActivity");

function supported(): boolean {
  return Capacitor.getPlatform() === "ios";
}

// Crea la actividad si no existe y la actualiza si ya existe.
export async function syncSessionLiveActivity(state: SessionLiveActivityState): Promise<void> {
  if (!supported()) return;
  try {
    await SessionLiveActivity.sync(state);
  } catch (err) {
    // Actividades desactivadas por el usuario, iOS < 16.2 o plugin ausente: la sesion sigue igual.
    console.warn("Live Activity no disponible", err);
  }
}

export async function endSessionLiveActivity(): Promise<void> {
  if (!supported()) return;
  try {
    await SessionLiveActivity.end();
  } catch {
    // Nada que cerrar.
  }
}
