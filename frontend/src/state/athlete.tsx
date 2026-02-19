/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { AccessibleAthletesResponse, AccessibleSubject } from "../api";
import { getAccessibleAthletes } from "../api";
import { useAuth } from "./auth";
import { useViewMode } from "./viewMode";

type AthleteContextValue = {
  ready: boolean;
  athleteId: string;
  athleteIds: string[];
  subjects: AccessibleSubject[];
  activeSubject: AccessibleSubject | null;
  selfAthleteId: string;
  canSwitch: boolean;
  error: string;
  setAthleteId: (id: string) => void;
  refresh: () => Promise<void>;
};

const KEY = "coach_ai_active_subject_id_v1";
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
  const { ready: modeReady, viewMode } = useViewMode();

  const [athleteId, setAthleteIdState] = useState<string>("");
  const [athleteIds, setAthleteIds] = useState<string[]>([]);
  const [subjects, setSubjects] = useState<AccessibleSubject[]>([]);
  const [selfAthleteId, setSelfAthleteId] = useState<string>("");
  const [canSwitch, setCanSwitch] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const normalizeSubjects = useCallback((res: AccessibleAthletesResponse): AccessibleSubject[] => {
    const normalized = (res.subjects || [])
      .map((item) => ({
        id: String(item.id || "").trim(),
        label: String(item.label || "").trim(),
        kind: (item.kind === "assigned" ? "assigned" : "self") as "self" | "assigned",
      }))
      .filter((item) => item.id);
    if (normalized.length > 0) {
      return normalized;
    }

    const fallbackIds = (res.athlete_ids || []).map((value) => String(value || "").trim()).filter(Boolean);
    let fallbackAssignedIdx = 0;
    return fallbackIds.map((id, idx) => {
      const kind = idx === 0 ? "self" : "assigned";
      if (kind === "assigned") fallbackAssignedIdx += 1;
      return {
        id,
        label: kind === "self" ? "Mi perfil" : `Atleta ${fallbackAssignedIdx}`,
        kind,
      };
    });
  }, []);

  const applySelection = useCallback((nextSubjects: AccessibleSubject[], serverDefault: string | null) => {
    if (nextSubjects.length === 0) {
      setAthleteIdState("");
      persistAthleteId(null);
      return;
    }

    const ids = nextSubjects.map((item) => item.id);
    const stored = readStoredAthleteId();
    if (stored && ids.includes(stored)) {
      setAthleteIdState(stored);
      persistAthleteId(stored);
      return;
    }

    if (serverDefault && ids.includes(serverDefault)) {
      setAthleteIdState(serverDefault);
      persistAthleteId(serverDefault);
      return;
    }

    const self = nextSubjects.find((item) => item.kind === "self");
    if (self) {
      setAthleteIdState(self.id);
      persistAthleteId(self.id);
      return;
    }

    const first = ids[0];
    setAthleteIdState(first);
    persistAthleteId(first);
  }, []);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setAthleteIds([]);
      setSubjects([]);
      setSelfAthleteId("");
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
      const nextSubjects = normalizeSubjects(res);
      const ids = nextSubjects.map((subject) => subject.id);
      const self = nextSubjects.find((subject) => subject.kind === "self") || null;

      setSubjects(nextSubjects);
      setAthleteIds(ids);
      setSelfAthleteId(self?.id || "");
      setCanSwitch(Boolean(res.can_switch ?? ids.length > 1));
      applySelection(nextSubjects, res.active_subject_id || null);
    } catch (cause: unknown) {
      setAthleteIds([]);
      setSubjects([]);
      setSelfAthleteId("");
      setAthleteIdState("");
      setCanSwitch(false);
      setError(String((cause as { message?: string })?.message || cause));
      persistAthleteId(null);
    } finally {
      setLoading(false);
    }
  }, [applySelection, isAuthenticated, normalizeSubjects]);

  useEffect(() => {
    if (!authReady || !modeReady) return;
    void refresh();
  }, [authReady, modeReady, refresh, viewMode]);

  const setAthleteId = useCallback(
    (id: string) => {
      const next = id.trim();
      if (!next || !athleteIds.includes(next)) return;
      setAthleteIdState(next);
      persistAthleteId(next);
    },
    [athleteIds],
  );

  const activeSubject = useMemo(
    () => subjects.find((subject) => subject.id === athleteId) || null,
    [subjects, athleteId],
  );

  const value = useMemo<AthleteContextValue>(
    () => ({
      ready: authReady && modeReady && !loading,
      athleteId,
      athleteIds,
      subjects,
      activeSubject,
      selfAthleteId,
      canSwitch,
      error,
      setAthleteId,
      refresh,
    }),
    [
      activeSubject,
      athleteId,
      athleteIds,
      authReady,
      canSwitch,
      error,
      loading,
      modeReady,
      refresh,
      selfAthleteId,
      setAthleteId,
      subjects,
    ],
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
