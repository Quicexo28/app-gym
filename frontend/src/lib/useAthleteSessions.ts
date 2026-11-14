import { getSessions, type SessionRecord } from "../api";
import { useAsyncLoad } from "./useAsyncLoad";

const NO_SESSIONS: SessionRecord[] = [];

// Sesiones del atleta activo para las pantallas de Cargas. Se recarga al cambiar de atleta
// y descarta la respuesta si el efecto se cancela antes de que llegue.
export function useAthleteSessions(athleteId: string) {
  const { data, loading, error } = useAsyncLoad(() => getSessions(athleteId), [athleteId], {
    skip: !athleteId,
    resetOnError: false,
  });
  return { sessions: data ?? NO_SESSIONS, loading, error };
}
