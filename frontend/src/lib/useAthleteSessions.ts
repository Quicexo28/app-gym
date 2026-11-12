import { useEffect, useState } from "react";

import { getSessions, type SessionRecord } from "../api";

// Sesiones del atleta activo para las pantallas de Cargas. Se recarga al cambiar de atleta
// y descarta la respuesta si el efecto se cancela antes de que llegue.
export function useAthleteSessions(athleteId: string) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!athleteId) {
        setSessions([]);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const items = await getSessions(athleteId);
        if (!cancelled) setSessions(items);
      } catch (cause: unknown) {
        if (!cancelled) setError(String((cause as { message?: string })?.message || cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  return { sessions, loading, error };
}
