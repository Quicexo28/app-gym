/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { setApiViewScopes, type AuthUser, type ViewScopes } from "../api";
import { useAuth } from "./auth";
import { loadJSON, loadString, removeKey, saveJSON } from "../lib/storage";

type ViewScopesContextValue = {
  ready: boolean;
  /** Vista admin encendida (solo rol admin). */
  adminView: boolean;
  /** Vista coach encendida (plan coach, o rol coach/admin). */
  coachView: boolean;
  canAdminView: boolean;
  canCoachView: boolean;
  setAdminView: (on: boolean) => void;
  setCoachView: (on: boolean) => void;
};

const KEY = "coach_ai_view_scopes_v1";
const LEGACY_KEY = "coach_ai_view_mode_v1";
const OFF: ViewScopes = { admin: false, coach: false };

const ViewScopesContext = createContext<ViewScopesContextValue | null>(null);

function readStoredScopes(): ViewScopes {
  const stored = loadJSON<Partial<ViewScopes> | null>(KEY, null);
  if (stored && typeof stored === "object") {
    return { admin: stored.admin === true, coach: stored.coach === true };
  }

  // Migración del enum de vista anterior (admin | coach | user_plus | user_normal).
  const legacy = loadString(LEGACY_KEY)?.trim().toLowerCase();
  removeKey(LEGACY_KEY);
  if (legacy === "admin") return { admin: true, coach: false };
  if (legacy === "coach") return { admin: false, coach: true };
  return OFF;
}

function persistScopes(scopes: ViewScopes | null): void {
  if (!scopes) {
    removeKey(KEY);
    return;
  }
  saveJSON(KEY, scopes);
}

function canAdminViewFor(user: AuthUser): boolean {
  return user.can_admin_view ?? user.role === "admin";
}

function canCoachViewFor(user: AuthUser): boolean {
  return user.can_coach_view ?? (user.plan === "coach" || user.role === "coach" || user.role === "admin");
}

/** Recorta lo guardado a lo que la cuenta permite; el backend hace el mismo recorte. */
function clampScopes(scopes: ViewScopes, user: AuthUser): ViewScopes {
  return {
    admin: scopes.admin && canAdminViewFor(user),
    coach: scopes.coach && canCoachViewFor(user),
  };
}

export function ViewScopesProvider({ children }: { children: ReactNode }) {
  const { ready: authReady, isAuthenticated, user } = useAuth();
  const [scopes, setScopes] = useState<ViewScopes>(OFF);
  const [capabilities, setCapabilities] = useState({ admin: false, coach: false });
  const [ready, setReady] = useState(false);

  const syncWithUser = useCallback((nextUser: AuthUser | null) => {
    if (!nextUser) {
      setCapabilities({ admin: false, coach: false });
      setScopes(OFF);
      persistScopes(null);
      setApiViewScopes(OFF);
      setReady(true);
      return;
    }

    const next = clampScopes(readStoredScopes(), nextUser);
    setCapabilities({ admin: canAdminViewFor(nextUser), coach: canCoachViewFor(nextUser) });
    setScopes(next);
    persistScopes(next);
    setApiViewScopes(next);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!authReady) return;
    const targetUser = isAuthenticated ? user : null;
    Promise.resolve().then(() => syncWithUser(targetUser));
  }, [authReady, isAuthenticated, user, syncWithUser]);

  const applyScopes = useCallback(
    (next: ViewScopes) => {
      setScopes(next);
      persistScopes(next);
      setApiViewScopes(next);
    },
    [],
  );

  const setAdminView = useCallback(
    (on: boolean) => {
      if (on && !capabilities.admin) return;
      applyScopes({ admin: on, coach: scopes.coach });
    },
    [applyScopes, capabilities.admin, scopes.coach],
  );

  const setCoachView = useCallback(
    (on: boolean) => {
      if (on && !capabilities.coach) return;
      applyScopes({ admin: scopes.admin, coach: on });
    },
    [applyScopes, capabilities.coach, scopes.admin],
  );

  const value = useMemo<ViewScopesContextValue>(
    () => ({
      ready,
      adminView: scopes.admin,
      coachView: scopes.coach,
      canAdminView: capabilities.admin,
      canCoachView: capabilities.coach,
      setAdminView,
      setCoachView,
    }),
    [capabilities.admin, capabilities.coach, ready, scopes.admin, scopes.coach, setAdminView, setCoachView],
  );

  return <ViewScopesContext.Provider value={value}>{children}</ViewScopesContext.Provider>;
}

export function useViewScopes(): ViewScopesContextValue {
  const ctx = useContext(ViewScopesContext);
  if (!ctx) {
    throw new Error("useViewScopes must be used inside ViewScopesProvider");
  }
  return ctx;
}
