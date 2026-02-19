/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { getAccessibleAthletes } from "../api";
import { useAuth } from "./auth";

type AthleteContextValue = {
  ready: boolean;
  athleteId: string;
  athleteIds: string[];
  canSwitch: boolean;
  error: string;
  setAthleteId: (id: string) => void;
  refresh: () => Promise<void>;
};

const KEY = "coach_ai_active_athlete_id_v2";
const AthleteContext = createContext<AthleteContextValue | null>(null);

function readStoredAthleteId(): string | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  const value = raw.trim();
  return value || null;
}

function persistAthleteId(value: string | null): void {
  if (!value) {
    localStorage.removeItem(KEY);
    return;
  }
  localStorage.setItem(KEY, value);
}

export function AthleteProvider({ children }: { children: ReactNode }) {
  const { ready: authReady, isAuthenticated } = useAuth();

  const [athleteId, setAthleteIdState] = useState<string>("");
  const [athleteIds, setAthleteIds] = useState<string[]>([]);
  const [canSwitch, setCanSwitch] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const applySelection = useCallback((nextAthleteIds: string[], nextCanSwitch: boolean) => {
    if (nextAthleteIds.length === 0) {
      setAthleteIdState("");
      persistAthleteId(null);
      return;
    }

    const stored = readStoredAthleteId();
    if (nextCanSwitch && stored && nextAthleteIds.includes(stored)) {
      setAthleteIdState(stored);
      persistAthleteId(stored);
      return;
    }

    const first = nextAthleteIds[0];
    setAthleteIdState(first);
    persistAthleteId(first);
  }, []);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setAthleteIds([]);
      setAthleteIdState("");
      setCanSwitch(false);
      setError("");
      setLoading(false);
      persistAthleteId(null);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await getAccessibleAthletes();
      const ids = (res.athlete_ids || []).map((value) => String(value).trim()).filter(Boolean);
      setAthleteIds(ids);
      setCanSwitch(Boolean(res.can_switch));
      applySelection(ids, Boolean(res.can_switch));
    } catch (cause: unknown) {
      setAthleteIds([]);
      setAthleteIdState("");
      setCanSwitch(false);
      setError(String((cause as { message?: string })?.message || cause));
      persistAthleteId(null);
    } finally {
      setLoading(false);
    }
  }, [applySelection, isAuthenticated]);

  useEffect(() => {
    if (!authReady) return;
    void refresh();
  }, [authReady, refresh]);

  const setAthleteId = useCallback(
    (id: string) => {
      if (!canSwitch) return;
      const next = id.trim();
      if (!next || !athleteIds.includes(next)) return;
      setAthleteIdState(next);
      persistAthleteId(next);
    },
    [athleteIds, canSwitch],
  );

  const value = useMemo<AthleteContextValue>(
    () => ({
      ready: authReady && !loading,
      athleteId,
      athleteIds,
      canSwitch,
      error,
      setAthleteId,
      refresh,
    }),
    [authReady, loading, athleteId, athleteIds, canSwitch, error, setAthleteId, refresh],
  );

  return <AthleteContext.Provider value={value}>{children}</AthleteContext.Provider>;
}

export function useAthleteAccess(): AthleteContextValue {
  const ctx = useContext(AthleteContext);
  if (!ctx) throw new Error("useAthleteAccess must be used inside AthleteProvider");
  return ctx;
}

export function useAthleteId(): [string, (id: string) => void] {
  const ctx = useAthleteAccess();
  return [ctx.athleteId, ctx.setAthleteId];
}

