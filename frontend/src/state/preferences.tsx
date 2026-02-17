/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type ThemePreference = "light" | "dark";
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
  setTheme: (theme: ThemePreference) => void;
  setEffortScale: (scale: EffortScale) => void;
  setWeightUnit: (unit: WeightUnit) => void;
  setDistanceUnit: (unit: DistanceUnit) => void;
  toggleTheme: () => void;
};

const KEY = "coach_ai_user_prefs_v1";

const DEFAULT_PREFS: UserPreferences = {
  theme: "light",
  effortScale: "rpe",
  weightUnit: "kg",
  distanceUnit: "m",
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function readStoredPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    return {
      theme: parsed.theme === "dark" ? "dark" : "light",
      effortScale: parsed.effortScale === "rir" ? "rir" : "rpe",
      weightUnit: parsed.weightUnit === "lb" ? "lb" : "kg",
      distanceUnit: parsed.distanceUnit === "mi" ? "mi" : "m",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function writeStoredPreferences(next: UserPreferences): void {
  localStorage.setItem(KEY, JSON.stringify(next));
}

function applyTheme(theme: ThemePreference): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<UserPreferences>(() => readStoredPreferences());

  useEffect(() => {
    writeStoredPreferences(prefs);
    applyTheme(prefs.theme);
  }, [prefs]);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      prefs,
      setTheme: (theme) => setPrefs((prev) => ({ ...prev, theme })),
      setEffortScale: (effortScale) => setPrefs((prev) => ({ ...prev, effortScale })),
      setWeightUnit: (weightUnit) => setPrefs((prev) => ({ ...prev, weightUnit })),
      setDistanceUnit: (distanceUnit) => setPrefs((prev) => ({ ...prev, distanceUnit })),
      toggleTheme: () => setPrefs((prev) => ({ ...prev, theme: prev.theme === "dark" ? "light" : "dark" })),
    }),
    [prefs],
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
