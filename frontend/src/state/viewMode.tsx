/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { setApiViewMode, type AuthUser, type ViewMode } from "../api";
import { useAuth } from "./auth";

type ViewModeContextValue = {
  ready: boolean;
  viewMode: ViewMode;
  allowedModes: ViewMode[];
  canSwitchMode: boolean;
  setViewMode: (mode: ViewMode) => void;
};

const KEY = "coach_ai_view_mode_v1";
const ViewModeContext = createContext<ViewModeContextValue | null>(null);

function readStoredMode(): ViewMode | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (value === "admin" || value === "coach" || value === "user_plus" || value === "user_normal") {
    return value;
  }
  return null;
}

function persistMode(value: ViewMode | null): void {
  if (!value) {
    localStorage.removeItem(KEY);
    return;
  }
  localStorage.setItem(KEY, value);
}

function allowedModesForUser(user: AuthUser): ViewMode[] {
  if (Array.isArray(user.allowed_view_modes) && user.allowed_view_modes.length > 0) {
    return user.allowed_view_modes;
  }

  if (user.role === "admin") return ["admin", "coach", "user_plus", "user_normal"];
  if (user.role === "coach") return ["coach", "user_plus"];
  return user.plan === "free" ? ["user_normal"] : ["user_plus"];
}

export function viewModeLabel(mode: ViewMode): string {
  if (mode === "admin") return "Admin";
  if (mode === "coach") return "Coach";
  if (mode === "user_plus") return "Usuario Plus";
  return "Usuario Normal";
}

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const { ready: authReady, isAuthenticated, user } = useAuth();
  const [viewMode, setViewModeState] = useState<ViewMode>("user_normal");
  const [allowedModes, setAllowedModes] = useState<ViewMode[]>(["user_normal"]);
  const [ready, setReady] = useState(false);

  const syncWithUser = useCallback((nextUser: AuthUser | null) => {
    if (!nextUser) {
      setAllowedModes(["user_normal"]);
      setViewModeState("user_normal");
      persistMode(null);
      setApiViewMode(null);
      setReady(true);
      return;
    }

    const allowed = allowedModesForUser(nextUser);
    const preferred = readStoredMode();
    const nextMode = preferred && allowed.includes(preferred) ? preferred : allowed[0];
    setAllowedModes(allowed);
    setViewModeState(nextMode);
    persistMode(nextMode);
    setApiViewMode(nextMode);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!authReady) return;
    const targetUser = isAuthenticated ? user : null;
    Promise.resolve().then(() => syncWithUser(targetUser));
  }, [authReady, isAuthenticated, user, syncWithUser]);

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      if (!allowedModes.includes(mode)) return;
      setViewModeState(mode);
      persistMode(mode);
      setApiViewMode(mode);
    },
    [allowedModes],
  );

  const value = useMemo<ViewModeContextValue>(
    () => ({
      ready,
      viewMode,
      allowedModes,
      canSwitchMode: allowedModes.length > 1,
      setViewMode,
    }),
    [ready, viewMode, allowedModes, setViewMode],
  );

  return <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>;
}

export function useViewMode(): ViewModeContextValue {
  const ctx = useContext(ViewModeContext);
  if (!ctx) {
    throw new Error("useViewMode must be used inside ViewModeProvider");
  }
  return ctx;
}
