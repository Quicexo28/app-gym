/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  authGuest,
  authGoogle,
  authLogin,
  authRegister,
  backendPlanToLabel,
  getMe,
  setApiToken,
  type AuthResponse,
  type AuthUser,
  type PlanLabel,
} from "../api";

type AuthSession = {
  token: string;
  user: AuthUser;
};

type AuthContextValue = {
  ready: boolean;
  session: AuthSession | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  planLabel: PlanLabel | null;
  login: (identifier: string, password: string) => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<void>;
  loginAsGuest: () => Promise<void>;
  register: (email: string, password: string, phoneNumber?: string) => Promise<void>;
  refreshMe: () => Promise<void>;
  logout: () => void;
};

const KEY = "coach_ai_auth_v1";
const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (!parsed?.token || !parsed.user) return null;
    return {
      token: parsed.token,
      user: parsed.user,
    };
  } catch {
    return null;
  }
}

function persistSession(session: AuthSession | null): void {
  if (!session) {
    localStorage.removeItem(KEY);
    return;
  }
  localStorage.setItem(KEY, JSON.stringify(session));
}

function toSession(payload: AuthResponse): AuthSession {
  return {
    token: payload.token.access_token,
    user: payload.user,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(() => readStoredSession());
  const [ready, setReady] = useState(false);

  const syncSession = useCallback((next: AuthSession | null) => {
    setSession(next);
    persistSession(next);
    setApiToken(next?.token ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      const existing = readStoredSession();
      if (!existing) {
        syncSession(null);
        if (!cancelled) setReady(true);
        return;
      }

      syncSession(existing);
      try {
        const user = await getMe();
        if (cancelled) return;
        syncSession({ token: existing.token, user });
      } catch {
        if (cancelled) return;
        syncSession(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    };

    boot();
    return () => {
      cancelled = true;
    };
  }, [syncSession]);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const payload = await authLogin(identifier, password);
      syncSession(toSession(payload));
    },
    [syncSession],
  );

  const loginWithGoogle = useCallback(
    async (idToken: string) => {
      const payload = await authGoogle(idToken);
      syncSession(toSession(payload));
    },
    [syncSession],
  );

  const loginAsGuest = useCallback(async () => {
    const payload = await authGuest();
    syncSession(toSession(payload));
  }, [syncSession]);

  const register = useCallback(
    async (email: string, password: string, phoneNumber?: string) => {
      const payload = await authRegister(email, password, phoneNumber);
      syncSession(toSession(payload));
    },
    [syncSession],
  );

  const refreshMe = useCallback(async () => {
    if (!session?.token) return;
    const user = await getMe();
    syncSession({ token: session.token, user });
  }, [session?.token, syncSession]);

  const logout = useCallback(() => {
    syncSession(null);
  }, [syncSession]);

  const value = useMemo<AuthContextValue>(() => {
    const user = session?.user ?? null;
    return {
      ready,
      session,
      user,
      isAuthenticated: !!session?.token,
      isAdmin: user?.role === "admin",
      planLabel: user ? backendPlanToLabel(user.plan) : null,
      login,
      loginWithGoogle,
      loginAsGuest,
      register,
      refreshMe,
      logout,
    };
  }, [ready, session, login, loginWithGoogle, loginAsGuest, register, refreshMe, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return ctx;
}
