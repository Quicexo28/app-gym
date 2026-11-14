/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { loadJSON, saveJSON } from "../lib/storage";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
export type EffortScale = "rpe" | "rir";
export type WeightUnit = "kg" | "lb";
export type DistanceUnit = "m" | "mi";

export type UserPreferences = {
  theme: ThemePreference;
  effortScale: EffortScale;
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
};

type PreferencesContextValue = {
  prefs: UserPreferences;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
  setEffortScale: (scale: EffortScale) => void;
  setWeightUnit: (unit: WeightUnit) => void;
  setDistanceUnit: (unit: DistanceUnit) => void;
  toggleTheme: () => void;
};

const KEY = "coach_ai_user_prefs_v1";
const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";
const THEME_CYCLE: ThemePreference[] = ["system", "light", "dark"];

const DEFAULT_PREFS: UserPreferences = {
  theme: "system",
  effortScale: "rpe",
  weightUnit: "kg",
  distanceUnit: "m",
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function readStoredPreferences(): UserPreferences {
  const parsed = loadJSON<Partial<UserPreferences> | null>(KEY, null);
  if (!parsed || typeof parsed !== "object") return DEFAULT_PREFS;
  const parsedTheme: ThemePreference =
    parsed.theme === "dark" || parsed.theme === "light" || parsed.theme === "system" ? parsed.theme : "system";
  return {
    theme: parsedTheme,
    effortScale: parsed.effortScale === "rir" ? "rir" : "rpe",
    weightUnit: parsed.weightUnit === "lb" ? "lb" : "kg",
    distanceUnit: parsed.distanceUnit === "mi" ? "mi" : "m",
  };
}

function writeStoredPreferences(next: UserPreferences): void {
  saveJSON(KEY, next);
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }
  return window.matchMedia(DARK_SCHEME_QUERY).matches ? "dark" : "light";
}

function resolveTheme(preference: ThemePreference, systemTheme: ResolvedTheme): ResolvedTheme {
  if (preference === "system") return systemTheme;
  return preference;
}

function applyTheme(preference: ThemePreference, resolved: ResolvedTheme): void {
  document.documentElement.setAttribute("data-theme", resolved);
  document.documentElement.setAttribute("data-theme-preference", preference);
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<UserPreferences>(() => readStoredPreferences());
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme());
  const resolvedTheme = useMemo<ResolvedTheme>(() => resolveTheme(prefs.theme, systemTheme), [prefs.theme, systemTheme]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(DARK_SCHEME_QUERY);

    const syncFromSystem = () => setSystemTheme(media.matches ? "dark" : "light");
    syncFromSystem();

    const listener = (event: MediaQueryListEvent) => setSystemTheme(event.matches ? "dark" : "light");
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    writeStoredPreferences(prefs);
  }, [prefs]);

  useEffect(() => {
    applyTheme(prefs.theme, resolvedTheme);
  }, [prefs.theme, resolvedTheme]);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      prefs,
      resolvedTheme,
      setTheme: (theme) => setPrefs((prev) => ({ ...prev, theme })),
      setEffortScale: (effortScale) => setPrefs((prev) => ({ ...prev, effortScale })),
      setWeightUnit: (weightUnit) => setPrefs((prev) => ({ ...prev, weightUnit })),
      setDistanceUnit: (distanceUnit) => setPrefs((prev) => ({ ...prev, distanceUnit })),
      toggleTheme: () =>
        setPrefs((prev) => {
          const idx = THEME_CYCLE.indexOf(prev.theme);
          const nextTheme = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
          return { ...prev, theme: nextTheme };
        }),
    }),
    [prefs, resolvedTheme],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    throw new Error("usePreferences must be used inside PreferencesProvider");
  }
  return ctx;
}
