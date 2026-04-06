import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  createDefaultVoiceTrainingProfile,
  loadVoiceTrainingProfile,
  saveVoiceTrainingProfile,
  VOICE_TRAINABLE_INTENT_LABELS,
  VOICE_TRAINABLE_INTENTS,
  type VoicePhraseCorrection,
  type VoiceTrainingProfile,
} from "../lib/voice/training";
import {
  adminSwitchPlan,
  deleteMyAccount,
  getAdminGamificationConfig,
  getVoiceTrainingConfig,
  ingestSessions,
  labelToBackendPlan,
  updateVoiceTrainingConfig,
  updateAdminGamificationConfig,
  type GamificationConfig,
  type GamificationTier,
  type PlanLabel,
  type Role,
} from "../api";
import { parseExerciseImportFile, type LegacyImportMode } from "../lib/legacyImport";
import { loadRoutines, saveRoutines } from "../lib/storage";
import type { OfflineVoskRecognizer as OfflineVoskRecognizerClass } from "../lib/voice/offlineRecognizer";
import type { OfflineRecognizerState, VoiceCommandIntent } from "../lib/voice/types";
import { normalizeVoiceTranscript } from "../lib/voice/wakePhrase";
import { useAthleteAccess } from "../state/athlete";
import { useExerciseCatalog } from "../state/exerciseCatalog";
import { useAuth } from "../state/auth";
import { usePreferences } from "../state/preferences";
import type { NavModuleId } from "../state/preferences";
import { useUndo } from "../state/undo";
import { useViewMode } from "../state/viewMode";

type Option<T extends string> = {
  label: string;
  value: T;
  hint: string;
};
type TierBucketKey = "streak_tiers" | "planning_days_tiers";
type LiftTierKey = "back_squat" | "bench_press" | "deadlift";

const LIFT_TIER_LABELS: Record<LiftTierKey, string> = {
  back_squat: "Sentadilla posterior libre",
  bench_press: "Press banca plano",
  deadlift: "Peso muerto convencional",
};

const NAV_MODULE_OPTIONS: Array<{ id: NavModuleId; label: string; hint: string }> = [
  { id: "session", label: "Nueva sesión", hint: "Registro rápido" },
  { id: "history", label: "Historial", hint: "Ver sesiones" },
  { id: "planning", label: "Planificación", hint: "Ciclos y progreso" },
  { id: "routines", label: "Rutinas", hint: "Plantillas" },
  { id: "measurements", label: "Medidas", hint: "Seguimiento corporal" },
  { id: "exercises", label: "Ejercicios", hint: "Catálogo" },
  { id: "achievements", label: "Logros", hint: "Motivación" },
  { id: "users", label: "Usuarios", hint: "Gestión coach/admin" },
];

const SESSION_IMPORT_SAMPLE = [
  {
    athlete_id: "a1",
    start_time: "2024-01-01T10:00:00Z",
    duration_min: 60,
    rpe: 7,
    modality: "strength",
    exercises: [{ name: "Bench Press", sets: [{ reps: 8, load_kg: 60 }] }],
    source: "manual",
    meta: { note: "baseline" },
  },
];

const ENABLE_OFFLINE_VOICE_CAPTURE =
  ((import.meta.env.VITE_ENABLE_OFFLINE_VOICE_CAPTURE as string | undefined)?.trim().toLowerCase() ?? "") === "true";
const VOICE_MODEL_ID = "vosk-model-small-es-0.42";
const VOICE_MODEL_URL = `/models/${VOICE_MODEL_ID}.zip`;

type VoiceCalibrationStep = {
  id: string;
  title: string;
  expected: string;
};

type VoiceCalibrationCapture = {
  step_id: string;
  step_index: number;
  expected: string;
  heard: string;
  matched: boolean;
  corrections: VoicePhraseCorrection[];
};

const VOICE_CALIBRATION_STEPS: VoiceCalibrationStep[] = [
  { id: "wake_only", title: "Wake base", expected: "prueba" },
  { id: "load", title: "Carga", expected: "prueba peso ciento veintitres" },
  { id: "reps", title: "Reps", expected: "prueba reps ocho" },
  { id: "effort", title: "Esfuerzo", expected: "prueba arroba diez" },
  { id: "tuple", title: "Comando compacto", expected: "prueba ciento veintitres por ocho arroba diez" },
  { id: "complete", title: "Completar serie", expected: "prueba completar serie" },
];

function keywordsToMultiline(keywords: string[]): string {
  return keywords.join("\n");
}

function multilineToKeywords(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/\r?\n|,/g)) {
    const keyword = line.trim();
    if (!keyword || seen.has(keyword)) continue;
    seen.add(keyword);
    out.push(keyword);
  }
  return out;
}

type VoiceTrainingDraft = Record<VoiceCommandIntent, string> & {
  wake_aliases: string;
  phrase_corrections: string;
};

function phraseCorrectionsToMultiline(corrections: VoicePhraseCorrection[]): string {
  return corrections.map((entry) => `${entry.from} => ${entry.to}`).join("\n");
}

function multilineToPhraseCorrections(raw: string): VoicePhraseCorrection[] {
  const out: VoicePhraseCorrection[] = [];
  const seen = new Set<string>();
  for (const line of raw.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.split(/\s*=>\s*/g);
    if (match.length < 2) continue;
    const from = normalizeVoiceTranscript(match[0] || "");
    const to = normalizeVoiceTranscript(match.slice(1).join(" => "));
    if (!from || !to || from === to) continue;
    const key = `${from}=>${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from, to });
  }
  return out;
}

function mergePhraseCorrections(
  base: VoicePhraseCorrection[],
  extra: VoicePhraseCorrection[],
): VoicePhraseCorrection[] {
  const out: VoicePhraseCorrection[] = [];
  const seen = new Set<string>();
  for (const entry of [...base, ...extra]) {
    const from = normalizeVoiceTranscript(entry.from);
    const to = normalizeVoiceTranscript(entry.to);
    if (!from || !to || from === to) continue;
    const key = `${from}=>${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from, to });
  }
  return out;
}

function buildCalibrationCorrections(expected: string, heard: string): VoicePhraseCorrection[] {
  const expectedNormalized = normalizeVoiceTranscript(expected);
  const heardNormalized = normalizeVoiceTranscript(heard);
  if (!expectedNormalized || !heardNormalized || expectedNormalized === heardNormalized) return [];

  const suggestions: VoicePhraseCorrection[] = [{ from: heardNormalized, to: expectedNormalized }];
  const expectedTokens = expectedNormalized.split(/\s+/).filter(Boolean);
  const heardTokens = heardNormalized.split(/\s+/).filter(Boolean);
  const maxLen = Math.min(expectedTokens.length, heardTokens.length);
  for (let index = 0; index < maxLen; index += 1) {
    const from = heardTokens[index];
    const to = expectedTokens[index];
    if (!from || !to || from === to) continue;
    if (from.length < 3 || to.length < 3) continue;
    suggestions.push({ from, to });
  }
  return mergePhraseCorrections([], suggestions);
}

function collectCalibrationSuggestions(captures: VoiceCalibrationCapture[]): VoicePhraseCorrection[] {
  const suggestions = captures.flatMap((entry) => entry.corrections);
  return mergePhraseCorrections([], suggestions);
}

function buildVoiceTrainingProfileFromDraft(draft: VoiceTrainingDraft, current: VoiceTrainingProfile): VoiceTrainingProfile {
  return {
    ...current,
    custom_keywords: {
      set_reps: multilineToKeywords(draft.set_reps),
      set_load: multilineToKeywords(draft.set_load),
      set_set_effort: multilineToKeywords(draft.set_set_effort),
      set_set_completed: multilineToKeywords(draft.set_set_completed),
    },
    wake_aliases: multilineToKeywords(draft.wake_aliases),
    phrase_corrections: multilineToPhraseCorrections(draft.phrase_corrections),
  };
}

function calibrationStatusLabel(status: OfflineRecognizerState): string {
  if (status === "inactive") return "Inactiva";
  if (status === "loading") return "Cargando modelo";
  if (status === "listening") return "Escuchando";
  if (status === "error") return "Error";
  return "Armada";
}

function trainingProfileToDraft(profile: VoiceTrainingProfile): VoiceTrainingDraft {
  return {
    set_reps: keywordsToMultiline(profile.custom_keywords.set_reps),
    set_load: keywordsToMultiline(profile.custom_keywords.set_load),
    set_set_effort: keywordsToMultiline(profile.custom_keywords.set_set_effort),
    set_set_completed: keywordsToMultiline(profile.custom_keywords.set_set_completed),
    wake_aliases: keywordsToMultiline(profile.wake_aliases),
    phrase_corrections: phraseCorrectionsToMultiline(profile.phrase_corrections),
  };
}

function OptionRow<T extends string>({
  label,
  description,
  options,
  value,
  onChange,
}: {
  label: string;
  description: string;
  options: Option<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <section className="surface">
      <div className="sectionHead">
        <h3>{label}</h3>
        <p>{description}</p>
      </div>
      <div className="pillGroup">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`pill ${value === opt.value ? "active" : ""}`}
            onClick={() => onChange(opt.value)}
          >
            <span>{opt.label}</span>
            <small>{opt.hint}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function cloneGamificationConfig(config: GamificationConfig): GamificationConfig {
  return {
    streak_gap_tolerance_days: config.streak_gap_tolerance_days,
    streak_tiers: config.streak_tiers.map((tier) => ({ ...tier })),
    planning_days_tiers: config.planning_days_tiers.map((tier) => ({ ...tier })),
    lift_tiers: {
      back_squat: config.lift_tiers.back_squat.map((tier) => ({ ...tier })),
      bench_press: config.lift_tiers.bench_press.map((tier) => ({ ...tier })),
      deadlift: config.lift_tiers.deadlift.map((tier) => ({ ...tier })),
    },
    relative_strength_tiers: {
      back_squat: config.relative_strength_tiers.back_squat.map((tier) => ({ ...tier })),
      bench_press: config.relative_strength_tiers.bench_press.map((tier) => ({ ...tier })),
      deadlift: config.relative_strength_tiers.deadlift.map((tier) => ({ ...tier })),
    },
    trilogy_achievement: config.trilogy_achievement,
    trilogy_medal: config.trilogy_medal,
    trilogy_emblem_png: config.trilogy_emblem_png || null,
  };
}

function nextTierThreshold(tiers: GamificationTier[]): number {
  if (tiers.length === 0) return 1;
  return Math.max(...tiers.map((tier) => Number(tier.threshold) || 0)) + 1;
}

function readPngAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const isPng = file.type === "image/png" || file.name.toLowerCase().endsWith(".png");
    if (!isPng) {
      reject(new Error("Solo se permiten archivos PNG para emblemas."));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer el PNG seleccionado."));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result.startsWith("data:image/png;base64,")) {
        reject(new Error("El archivo debe convertirse a data:image/png;base64."));
        return;
      }
      resolve(result);
    };
    reader.readAsDataURL(file);
  });
}

function TierEditor({
  title,
  tiers,
  onTierChange,
  onTierAdd,
  onTierRemove,
  onTierUploadEmblem,
  onTierClearEmblem,
  thresholdLabel = "Umbral",
  thresholdStep = "0.1",
}: {
  title: string;
  tiers: GamificationTier[];
  onTierChange: (index: number, patch: Partial<GamificationTier>) => void;
  onTierAdd: () => void;
  onTierRemove: (index: number) => void;
  onTierUploadEmblem: (index: number, file: File | null) => void;
  onTierClearEmblem: (index: number) => void;
  thresholdLabel?: string;
  thresholdStep?: string;
}) {
  return (
    <article className="surfaceButton" style={{ alignItems: "stretch" }}>
      <div className="sectionHead">
        <h4>{title}</h4>
        <p>Umbral + texto de logro + medalla + emblema PNG.</p>
      </div>

      <div className="stack compactStack" style={{ marginTop: 8 }}>
        {tiers.map((tier, index) => (
          <div key={`${title}_${index}`} className="surfaceButton" style={{ alignItems: "stretch" }}>
            <div className="splitGrid">
              <div>
                <label className="smallLabel">{thresholdLabel}</label>
                <input
                  type="number"
                  className="input"
                  min="0.1"
                  step={thresholdStep}
                  value={tier.threshold}
                  onChange={(e) => onTierChange(index, { threshold: Number(e.target.value) || 0 })}
                />
              </div>
              <div>
                <label className="smallLabel">Logro</label>
                <input
                  className="input"
                  value={tier.achievement}
                  onChange={(e) => onTierChange(index, { achievement: e.target.value })}
                />
              </div>
              <div>
                <label className="smallLabel">Medalla</label>
                <input
                  className="input"
                  value={tier.medal}
                  onChange={(e) => onTierChange(index, { medal: e.target.value })}
                />
              </div>
            </div>

            <div className="splitGrid">
              <div>
                <label className="smallLabel">Emblema PNG</label>
                <input
                  className="input"
                  value={tier.emblem_png || ""}
                  onChange={(e) => onTierChange(index, { emblem_png: e.target.value || null })}
                  placeholder="https://cdn.ejemplo.com/emblema.png o data:image/png;base64,..."
                />
              </div>
              <div style={{ display: "flex", alignItems: "end", gap: 8, flexWrap: "wrap" }}>
                <label className="btn" style={{ cursor: "pointer" }}>
                  Subir PNG
                  <input
                    type="file"
                    accept="image/png,.png"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      onTierUploadEmblem(index, e.target.files?.[0] || null);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
                <button
                  className="btn"
                  type="button"
                  onClick={() => onTierClearEmblem(index)}
                  disabled={!tier.emblem_png}
                >
                  Quitar emblema
                </button>
                <button className="btn" type="button" onClick={() => onTierRemove(index)}>
                  Quitar fila
                </button>
              </div>
              <div style={{ display: "flex", alignItems: "end" }}>
                {tier.emblem_png ? (
                  <img
                    src={tier.emblem_png}
                    alt={`Emblema ${tier.achievement}`}
                    style={{ width: 46, height: 46, objectFit: "cover", borderRadius: 10, border: "1px solid var(--border)" }}
                  />
                ) : (
                  <span className="small">Sin emblema.</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="quickActions" style={{ marginTop: 10 }}>
        <button className="btn" type="button" onClick={onTierAdd}>
          + Agregar fila
        </button>
      </div>
    </article>
  );
}

type SettingsPanel = "general" | "navigation" | "account" | "admin" | "security";

export default function Settings() {
  const nav = useNavigate();
  const { athleteId, activeSubject } = useAthleteAccess();
  const { prefs, setTheme, setEffortScale, setWeightUnit, setDistanceUnit, setPinnedModules } = usePreferences();
  const { user, planLabel, isAdmin, refreshMe, logout } = useAuth();
  const { registerUndo } = useUndo();
  const { viewMode } = useViewMode();
  const { items, addCustom, removeItem, importGlobalCatalog, exportGlobalCatalog, refresh } = useExerciseCatalog();
  const isAdminMode = isAdmin && viewMode === "admin";

  const [switchEmail, setSwitchEmail] = useState("");
  const [switchPlan, setSwitchPlan] = useState<PlanLabel>("standard");
  const [switchRole, setSwitchRole] = useState<"" | Role>("");
  const [switchMsg, setSwitchMsg] = useState("");
  const [switchBusy, setSwitchBusy] = useState(false);

  const [importMode, setImportMode] = useState<LegacyImportMode>("merge");
  const [importMsg, setImportMsg] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  const [sessionImportText, setSessionImportText] = useState<string>(JSON.stringify(SESSION_IMPORT_SAMPLE, null, 2));
  const [sessionImportBusy, setSessionImportBusy] = useState(false);
  const [sessionImportError, setSessionImportError] = useState("");
  const [sessionImportInfo, setSessionImportInfo] = useState("");
  const [sessionImportResult, setSessionImportResult] = useState("");
  const [sessionImportShowAdvanced, setSessionImportShowAdvanced] = useState(false);

  const [gamificationConfig, setGamificationConfig] = useState<GamificationConfig | null>(null);
  const [gamificationDefaults, setGamificationDefaults] = useState<GamificationConfig | null>(null);
  const [gamificationLoading, setGamificationLoading] = useState(false);
  const [gamificationBusy, setGamificationBusy] = useState(false);
  const [gamificationMsg, setGamificationMsg] = useState("");
  const [gamificationError, setGamificationError] = useState("");
  const [voiceTrainingProfile, setVoiceTrainingProfile] = useState<VoiceTrainingProfile>(() =>
    createDefaultVoiceTrainingProfile(),
  );
  const [voiceTrainingDraft, setVoiceTrainingDraft] = useState<VoiceTrainingDraft>(() =>
    trainingProfileToDraft(createDefaultVoiceTrainingProfile()),
  );
  const [voiceTrainingBusy, setVoiceTrainingBusy] = useState(false);
  const [voiceTrainingMsg, setVoiceTrainingMsg] = useState("");
  const [voiceTrainingError, setVoiceTrainingError] = useState("");
  const [voiceCalibrationStatus, setVoiceCalibrationStatus] = useState<OfflineRecognizerState>("inactive");
  const [voiceCalibrationRunning, setVoiceCalibrationRunning] = useState(false);
  const [voiceCalibrationAwaiting, setVoiceCalibrationAwaiting] = useState(false);
  const [voiceCalibrationStepIndex, setVoiceCalibrationStepIndex] = useState(0);
  const [voiceCalibrationPartial, setVoiceCalibrationPartial] = useState("");
  const [voiceCalibrationCaptures, setVoiceCalibrationCaptures] = useState<VoiceCalibrationCapture[]>([]);
  const [voiceCalibrationError, setVoiceCalibrationError] = useState("");
  const [voiceCalibrationInfo, setVoiceCalibrationInfo] = useState("");
  const [voiceCalibrationBusy, setVoiceCalibrationBusy] = useState(false);

  const calibrationRecognizerRef = useRef<OfflineVoskRecognizerClass | null>(null);
  const calibrationAwaitingRef = useRef(false);
  const calibrationStepIndexRef = useRef(0);
  const calibrationCapturesRef = useRef<VoiceCalibrationCapture[]>([]);
  const voiceTrainingDraftRef = useRef<VoiceTrainingDraft>(voiceTrainingDraft);

  const [dangerBusy, setDangerBusy] = useState(false);
  const [dangerError, setDangerError] = useState("");
  const [dangerInfo, setDangerInfo] = useState("");
  const [activePanel, setActivePanel] = useState<SettingsPanel>("general");
  const dangerBtnStyle = { borderColor: "var(--danger)", color: "var(--danger)" } as const;

  const availableNavModules = useMemo(() => {
    if (viewMode === "coach" || viewMode === "admin") return NAV_MODULE_OPTIONS;
    return NAV_MODULE_OPTIONS.filter((item) => item.id !== "users");
  }, [viewMode]);

  useEffect(() => {
    if (!user) return;
    setSwitchEmail(user.email);
    if (planLabel) setSwitchPlan(planLabel);
  }, [user, planLabel]);

  useEffect(() => {
    if (!isAdminMode) return;
    let cancelled = false;
    setGamificationLoading(true);
    setGamificationError("");
    getAdminGamificationConfig()
      .then((res) => {
        if (cancelled) return;
        setGamificationConfig(cloneGamificationConfig(res.config));
        setGamificationDefaults(cloneGamificationConfig(res.defaults));
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setGamificationError(String((cause as { message?: string })?.message || cause));
      })
      .finally(() => {
        if (!cancelled) setGamificationLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdminMode]);

  useEffect(() => {
    if (!isAdminMode) return;
    let cancelled = false;
    setVoiceTrainingMsg("");
    setVoiceTrainingError("");
    getVoiceTrainingConfig()
      .then((profile) => {
        if (cancelled) return;
        const nextDraft = trainingProfileToDraft(profile);
        setVoiceTrainingProfile(profile);
        setVoiceTrainingDraft(nextDraft);
        voiceTrainingDraftRef.current = nextDraft;
        saveVoiceTrainingProfile(profile);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const cached = loadVoiceTrainingProfile();
        const nextDraft = trainingProfileToDraft(cached);
        setVoiceTrainingProfile(cached);
        setVoiceTrainingDraft(nextDraft);
        voiceTrainingDraftRef.current = nextDraft;
        setVoiceTrainingError(
          `No pude cargar entrenamiento global de voz. Usando cache local: ${String((cause as { message?: string })?.message || cause)}`,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [isAdminMode]);

  useEffect(() => {
    calibrationAwaitingRef.current = voiceCalibrationAwaiting;
  }, [voiceCalibrationAwaiting]);

  useEffect(() => {
    calibrationStepIndexRef.current = voiceCalibrationStepIndex;
  }, [voiceCalibrationStepIndex]);

  useEffect(() => {
    calibrationCapturesRef.current = voiceCalibrationCaptures;
  }, [voiceCalibrationCaptures]);

  useEffect(() => {
    voiceTrainingDraftRef.current = voiceTrainingDraft;
  }, [voiceTrainingDraft]);

  useEffect(
    () => () => {
      const recognizer = calibrationRecognizerRef.current;
      calibrationRecognizerRef.current = null;
      if (!recognizer) return;
      void recognizer.dispose();
    },
    [],
  );

  useEffect(() => {
    if (isAdminMode) return;
    calibrationAwaitingRef.current = false;
    const recognizer = calibrationRecognizerRef.current;
    if (!recognizer) return;
    void recognizer.disarm();
  }, [isAdminMode]);

  function togglePinnedModule(moduleId: NavModuleId) {
    const current = prefs.pinnedModules.filter((entry) => availableNavModules.some((mod) => mod.id === entry));
    const exists = current.includes(moduleId);
    if (exists) {
      const next = current.filter((entry) => entry !== moduleId);
      setPinnedModules(next);
      return;
    }
    const next = [...current, moduleId].slice(0, 5);
    setPinnedModules(next);
  }

  async function submitSwitchPlan() {
    if (!switchEmail.trim()) {
      setSwitchMsg("Debes indicar un email.");
      return;
    }

    setSwitchBusy(true);
    setSwitchMsg("");
    try {
      const result = await adminSwitchPlan({
        email: switchEmail.trim(),
        plan: labelToBackendPlan(switchPlan),
        role: switchRole || undefined,
      });
      setSwitchMsg(`OK: ${result.email} -> ${result.plan} (${result.role})`);
      if (user && result.email.toLowerCase() === user.email.toLowerCase()) {
        await refreshMe();
      }
    } catch (e: unknown) {
      setSwitchMsg(String((e as { message?: string })?.message || e));
    } finally {
      setSwitchBusy(false);
    }
  }

  function updateVoiceTrainingDraft(intent: VoiceCommandIntent, value: string) {
    setVoiceTrainingDraft((prev) => ({ ...prev, [intent]: value }));
    setVoiceTrainingMsg("");
    setVoiceTrainingError("");
  }

  async function saveVoiceTrainingRules() {
    setVoiceTrainingBusy(true);
    setVoiceTrainingMsg("");
    setVoiceTrainingError("");
    try {
      const draftProfile = buildVoiceTrainingProfileFromDraft(voiceTrainingDraft, voiceTrainingProfile);
      const savedProfile = await updateVoiceTrainingConfig(draftProfile);
      const nextProfile = saveVoiceTrainingProfile(savedProfile);
      const nextDraft = trainingProfileToDraft(nextProfile);
      setVoiceTrainingProfile(nextProfile);
      setVoiceTrainingDraft(nextDraft);
      voiceTrainingDraftRef.current = nextDraft;
      setVoiceTrainingMsg("Entrenamiento de voz guardado. Aliases, comandos y autocorrecciones activas.");
    } catch (cause: unknown) {
      setVoiceTrainingError(String((cause as { message?: string })?.message || cause));
    } finally {
      setVoiceTrainingBusy(false);
    }
  }

  async function resetVoiceTrainingRules() {
    setVoiceTrainingBusy(true);
    setVoiceTrainingMsg("");
    setVoiceTrainingError("");
    const defaults = createDefaultVoiceTrainingProfile();
    try {
      const savedProfile = await updateVoiceTrainingConfig(defaults);
      const nextProfile = saveVoiceTrainingProfile(savedProfile);
      const nextDraft = trainingProfileToDraft(nextProfile);
      setVoiceTrainingProfile(nextProfile);
      setVoiceTrainingDraft(nextDraft);
      voiceTrainingDraftRef.current = nextDraft;
      setVoiceTrainingMsg("Entrenamiento de voz restablecido al estado inicial.");
    } catch (cause: unknown) {
      setVoiceTrainingError(String((cause as { message?: string })?.message || cause));
    } finally {
      setVoiceTrainingBusy(false);
    }
  }

  async function importVoiceTrainingFile(file: File | null) {
    if (!file) return;
    setVoiceTrainingBusy(true);
    setVoiceTrainingMsg("");
    setVoiceTrainingError("");
    try {
      const rawText = await file.text();
      const parsed = JSON.parse(rawText) as VoiceTrainingProfile;
      const savedProfile = await updateVoiceTrainingConfig(parsed);
      const saved = saveVoiceTrainingProfile(savedProfile);
      const nextDraft = trainingProfileToDraft(saved);
      setVoiceTrainingProfile(saved);
      setVoiceTrainingDraft(nextDraft);
      voiceTrainingDraftRef.current = nextDraft;
      setVoiceTrainingMsg("Entrenamiento de voz importado.");
    } catch (cause: unknown) {
      setVoiceTrainingError(`No pude importar el JSON: ${String((cause as { message?: string })?.message || cause)}`);
    } finally {
      setVoiceTrainingBusy(false);
    }
  }

  function exportVoiceTrainingRules() {
    setVoiceTrainingMsg("");
    setVoiceTrainingError("");
    try {
      const profile = voiceTrainingProfile;
      const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `voice-training-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setVoiceTrainingMsg("JSON de entrenamiento de voz exportado.");
    } catch (cause: unknown) {
      setVoiceTrainingError(String((cause as { message?: string })?.message || cause));
    }
  }

  function describeMicrophoneError(cause: unknown): string {
    const payload = cause as { name?: string; message?: string };
    const name = String(payload?.name ?? "");
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return "Permiso de microfono denegado en el navegador.";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "No se detecto un microfono disponible.";
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return "El microfono esta ocupado por otra aplicacion.";
    }
    if (name === "SecurityError") {
      return "La captura de microfono requiere HTTPS o localhost.";
    }
    const message = String(payload?.message ?? "");
    return message || String(cause);
  }

  async function stopVoiceCalibrationRecognizer(disposeModel: boolean): Promise<void> {
    calibrationAwaitingRef.current = false;
    setVoiceCalibrationAwaiting(false);
    setVoiceCalibrationPartial("");

    const recognizer = calibrationRecognizerRef.current;
    if (!recognizer) {
      setVoiceCalibrationStatus("inactive");
      return;
    }

    try {
      await recognizer.disarm();
    } catch (cause: unknown) {
      const message = String((cause as { message?: string })?.message || cause);
      setVoiceCalibrationError(message);
      setVoiceCalibrationStatus("error");
    }

    if (!disposeModel) return;
    try {
      await recognizer.dispose();
    } catch {
      // no-op cleanup
    } finally {
      calibrationRecognizerRef.current = null;
    }
  }

  function storeVoiceCalibrationCapture(stepIndex: number, heardRaw: string): void {
    const step = VOICE_CALIBRATION_STEPS[stepIndex];
    if (!step) return;

    const expected = normalizeVoiceTranscript(step.expected);
    const heard = normalizeVoiceTranscript(heardRaw);
    const corrections = buildCalibrationCorrections(expected, heard);
    const capture: VoiceCalibrationCapture = {
      step_id: step.id,
      step_index: stepIndex,
      expected,
      heard,
      matched: expected === heard,
      corrections,
    };

    const nextCaptures = [
      ...calibrationCapturesRef.current.filter((entry) => entry.step_index !== stepIndex),
      capture,
    ].sort((a, b) => a.step_index - b.step_index);
    calibrationCapturesRef.current = nextCaptures;
    setVoiceCalibrationCaptures(nextCaptures);

    calibrationAwaitingRef.current = false;
    setVoiceCalibrationAwaiting(false);
    setVoiceCalibrationPartial("");

    const nextStepIndex = stepIndex + 1;
    if (nextStepIndex >= VOICE_CALIBRATION_STEPS.length) {
      calibrationStepIndexRef.current = VOICE_CALIBRATION_STEPS.length - 1;
      setVoiceCalibrationRunning(false);
      setVoiceCalibrationInfo("Wizard completado. Guardando sugerencias detectadas...");
      void persistVoiceTrainingFromCorrections(collectCalibrationSuggestions(nextCaptures), "wizard_auto");
      void stopVoiceCalibrationRecognizer(false);
      return;
    }

    calibrationStepIndexRef.current = nextStepIndex;
    setVoiceCalibrationStepIndex(nextStepIndex);
    setVoiceCalibrationInfo(
      capture.matched
        ? `Paso ${stepIndex + 1} OK. Avanza al paso ${nextStepIndex + 1}.`
        : `Paso ${stepIndex + 1} capturado con diferencia. Avanza al paso ${nextStepIndex + 1}.`,
    );
  }

  async function ensureVoiceCalibrationRecognizerArmed(): Promise<boolean> {
    setVoiceCalibrationError("");
    if (!ENABLE_OFFLINE_VOICE_CAPTURE) {
      setVoiceCalibrationError("La feature VITE_ENABLE_OFFLINE_VOICE_CAPTURE esta en false.");
      return false;
    }
    if (!("mediaDevices" in navigator) || typeof navigator.mediaDevices?.getUserMedia !== "function") {
      setVoiceCalibrationError("Este navegador no permite acceso al microfono.");
      setVoiceCalibrationStatus("error");
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
      stream.getTracks().forEach((track) => track.stop());
    } catch (cause: unknown) {
      setVoiceCalibrationError(`No se pudo obtener permiso de microfono: ${describeMicrophoneError(cause)}`);
      setVoiceCalibrationStatus("error");
      return false;
    }

    let voiceModule: typeof import("../lib/voice/offlineRecognizer");
    try {
      voiceModule = await import("../lib/voice/offlineRecognizer");
    } catch (cause: unknown) {
      const message = String((cause as { message?: string })?.message || cause);
      setVoiceCalibrationError(`No pude cargar el motor de voz: ${message}`);
      setVoiceCalibrationStatus("error");
      return false;
    }

    if (!voiceModule.browserSupportsOfflineRecognizer()) {
      setVoiceCalibrationError("Este navegador no soporta captura de microfono offline para voz.");
      setVoiceCalibrationStatus("error");
      return false;
    }

    let recognizer = calibrationRecognizerRef.current;
    if (!recognizer) {
      recognizer = new voiceModule.OfflineVoskRecognizer({
        modelUrl: VOICE_MODEL_URL,
        callbacks: {
          onStateChange: (state) => setVoiceCalibrationStatus(state),
          onPartialTranscript: (partial) => {
            setVoiceCalibrationPartial(normalizeVoiceTranscript(partial));
          },
          onFinalTranscript: (result) => {
            const heard = normalizeVoiceTranscript(result.text);
            if (!heard || !calibrationAwaitingRef.current) return;
            storeVoiceCalibrationCapture(calibrationStepIndexRef.current, heard);
          },
          onError: (message) => {
            setVoiceCalibrationError(message);
            setVoiceCalibrationStatus("error");
            calibrationAwaitingRef.current = false;
            setVoiceCalibrationAwaiting(false);
          },
        },
      });
      calibrationRecognizerRef.current = recognizer;
    }

    try {
      await recognizer.arm();
      return true;
    } catch (cause: unknown) {
      const message = String((cause as { message?: string })?.message || cause);
      setVoiceCalibrationError(`No se pudo iniciar calibracion: ${message}`);
      setVoiceCalibrationStatus("error");
      return false;
    }
  }

  async function startVoiceCalibrationWizard(): Promise<void> {
    if (voiceCalibrationBusy) return;
    setVoiceCalibrationBusy(true);
    await stopVoiceCalibrationRecognizer(false);
    setVoiceCalibrationRunning(true);
    setVoiceCalibrationStepIndex(0);
    calibrationStepIndexRef.current = 0;
    setVoiceCalibrationCaptures([]);
    setVoiceCalibrationPartial("");
    setVoiceCalibrationInfo("");
    setVoiceCalibrationError("");
    calibrationAwaitingRef.current = false;
    setVoiceCalibrationAwaiting(false);

    const started = await ensureVoiceCalibrationRecognizerArmed();
    if (started) {
      setVoiceCalibrationInfo("Microfono listo. Pulsa 'Capturar paso' y dicta la frase esperada.");
    } else {
      setVoiceCalibrationRunning(false);
    }
    setVoiceCalibrationBusy(false);
  }

  function captureVoiceCalibrationStep(): void {
    if (!voiceCalibrationRunning) {
      setVoiceCalibrationInfo("Inicia el wizard antes de capturar.");
      return;
    }
    if (voiceCalibrationStatus !== "armed" && voiceCalibrationStatus !== "listening") {
      setVoiceCalibrationInfo("El motor aun no esta armado. Espera unos segundos.");
      return;
    }
    calibrationAwaitingRef.current = true;
    setVoiceCalibrationAwaiting(true);
    setVoiceCalibrationInfo(
      `Escuchando paso ${Math.min(voiceCalibrationStepIndex + 1, VOICE_CALIBRATION_STEPS.length)} de ${VOICE_CALIBRATION_STEPS.length}...`,
    );
  }

  function retryVoiceCalibrationStep(): void {
    const currentIndex = voiceCalibrationStepIndex;
    setVoiceCalibrationCaptures((previous) => previous.filter((entry) => entry.step_index !== currentIndex));
    calibrationAwaitingRef.current = false;
    setVoiceCalibrationAwaiting(false);
    setVoiceCalibrationPartial("");
    setVoiceCalibrationInfo("Paso reiniciado. Pulsa 'Capturar paso' para repetir.");
  }

  async function stopVoiceCalibrationWizard(): Promise<void> {
    setVoiceCalibrationRunning(false);
    calibrationAwaitingRef.current = false;
    setVoiceCalibrationAwaiting(false);
    await stopVoiceCalibrationRecognizer(false);
    setVoiceCalibrationInfo("Wizard detenido.");
  }

  async function persistVoiceTrainingFromCorrections(
    suggested: VoicePhraseCorrection[],
    source: "wizard_manual" | "wizard_auto",
  ): Promise<void> {
    if (suggested.length === 0) {
      setVoiceCalibrationInfo(
        source === "wizard_auto"
          ? "Wizard completado sin sugerencias nuevas para guardar."
          : "No hay sugerencias nuevas para aplicar.",
      );
      return;
    }

    const currentProfile = voiceTrainingProfile;
    const currentDraft = voiceTrainingDraftRef.current;
    const baseCorrections = multilineToPhraseCorrections(currentDraft.phrase_corrections);
    const mergedCorrections = mergePhraseCorrections(baseCorrections, suggested);
    const nextDraft: VoiceTrainingDraft = {
      ...currentDraft,
      phrase_corrections: phraseCorrectionsToMultiline(mergedCorrections),
    };

    setVoiceTrainingBusy(true);
    setVoiceTrainingError("");
    setVoiceTrainingMsg("");
    try {
      const nextProfilePayload = buildVoiceTrainingProfileFromDraft(nextDraft, currentProfile);
      const savedProfile = await updateVoiceTrainingConfig(nextProfilePayload);
      const nextProfile = saveVoiceTrainingProfile(savedProfile);
      const nextDraftNormalized = trainingProfileToDraft(nextProfile);
      setVoiceTrainingProfile(nextProfile);
      setVoiceTrainingDraft(nextDraftNormalized);
      voiceTrainingDraftRef.current = nextDraftNormalized;
      if (source === "wizard_auto") {
        setVoiceTrainingMsg("Wizard autoguardado. Correcciones de calibracion persistidas.");
        setVoiceCalibrationInfo(`Autoguardado completado: ${suggested.length} sugerencias.`);
      } else {
        setVoiceTrainingMsg("Wizard aplicado. Correcciones guardadas en entrenamiento de voz.");
        setVoiceCalibrationInfo(`Se agregaron/actualizaron ${suggested.length} sugerencias de calibracion.`);
      }
    } catch (cause: unknown) {
      setVoiceTrainingError(String((cause as { message?: string })?.message || cause));
    } finally {
      setVoiceTrainingBusy(false);
    }
  }

  async function applyVoiceCalibrationSuggestions(): Promise<void> {
    await persistVoiceTrainingFromCorrections(voiceCalibrationSuggestedCorrections, "wizard_manual");
  }

  function updateTierList(list: GamificationTier[], index: number, patch: Partial<GamificationTier>): GamificationTier[] {
    return list.map((tier, rowIndex) => (rowIndex === index ? { ...tier, ...patch } : tier));
  }

  function updateTierBucket(bucket: TierBucketKey, index: number, patch: Partial<GamificationTier>) {
    setGamificationConfig((current) => {
      if (!current) return current;
      return {
        ...current,
        [bucket]: updateTierList(current[bucket], index, patch),
      };
    });
    setGamificationMsg("");
    setGamificationError("");
  }

  function addTierBucketRow(bucket: TierBucketKey) {
    setGamificationConfig((current) => {
      if (!current) return current;
      const nextRow: GamificationTier = {
        threshold: nextTierThreshold(current[bucket]),
        achievement: "Nuevo logro",
        medal: "Nueva medalla",
      };
      return {
        ...current,
        [bucket]: [...current[bucket], nextRow],
      };
    });
    setGamificationMsg("");
    setGamificationError("");
  }

  function removeTierBucketRow(bucket: TierBucketKey, index: number) {
    setGamificationConfig((current) => {
      if (!current) return current;
      return {
        ...current,
        [bucket]: current[bucket].filter((_, rowIndex) => rowIndex !== index),
      };
    });
    setGamificationMsg("");
    setGamificationError("");
  }

  function updateLiftTier(lift: LiftTierKey, index: number, patch: Partial<GamificationTier>) {
    setGamificationConfig((current) => {
      if (!current) return current;
      return {
        ...current,
        lift_tiers: {
          ...current.lift_tiers,
          [lift]: updateTierList(current.lift_tiers[lift], index, patch),
        },
      };
    });
    setGamificationMsg("");
    setGamificationError("");
  }

  function addLiftTierRow(lift: LiftTierKey) {
    setGamificationConfig((current) => {
      if (!current) return current;
      const nextRow: GamificationTier = {
        threshold: nextTierThreshold(current.lift_tiers[lift]),
        achievement: `Nuevo logro ${LIFT_TIER_LABELS[lift]}`,
        medal: `Nueva medalla ${LIFT_TIER_LABELS[lift]}`,
      };
      return {
        ...current,
        lift_tiers: {
          ...current.lift_tiers,
          [lift]: [...current.lift_tiers[lift], nextRow],
        },
      };
    });
    setGamificationMsg("");
    setGamificationError("");
  }

  function removeLiftTierRow(lift: LiftTierKey, index: number) {
    setGamificationConfig((current) => {
      if (!current) return current;
      return {
        ...current,
        lift_tiers: {
          ...current.lift_tiers,
          [lift]: current.lift_tiers[lift].filter((_, rowIndex) => rowIndex !== index),
        },
      };
    });
    setGamificationMsg("");
    setGamificationError("");
  }

  function updateRelativeTier(lift: LiftTierKey, index: number, patch: Partial<GamificationTier>) {
    setGamificationConfig((current) => {
      if (!current) return current;
      return {
        ...current,
        relative_strength_tiers: {
          ...current.relative_strength_tiers,
          [lift]: updateTierList(current.relative_strength_tiers[lift], index, patch),
        },
      };
    });
    setGamificationMsg("");
    setGamificationError("");
  }

  function addRelativeTierRow(lift: LiftTierKey) {
    setGamificationConfig((current) => {
      if (!current) return current;
      const nextRow: GamificationTier = {
        threshold: nextTierThreshold(current.relative_strength_tiers[lift]),
        achievement: `Nuevo logro relativo ${LIFT_TIER_LABELS[lift]}`,
        medal: `Nueva medalla relativa ${LIFT_TIER_LABELS[lift]}`,
      };
      return {
        ...current,
        relative_strength_tiers: {
          ...current.relative_strength_tiers,
          [lift]: [...current.relative_strength_tiers[lift], nextRow],
        },
      };
    });
    setGamificationMsg("");
    setGamificationError("");
  }

  function removeRelativeTierRow(lift: LiftTierKey, index: number) {
    setGamificationConfig((current) => {
      if (!current) return current;
      return {
        ...current,
        relative_strength_tiers: {
          ...current.relative_strength_tiers,
          [lift]: current.relative_strength_tiers[lift].filter((_, rowIndex) => rowIndex !== index),
        },
      };
    });
    setGamificationMsg("");
    setGamificationError("");
  }

  async function uploadTierBucketEmblem(bucket: TierBucketKey, index: number, file: File | null) {
    if (!file) return;
    try {
      const dataUrl = await readPngAsDataUrl(file);
      updateTierBucket(bucket, index, { emblem_png: dataUrl });
    } catch (cause: unknown) {
      setGamificationError(String((cause as { message?: string })?.message || cause));
      setGamificationMsg("");
    }
  }

  async function uploadLiftTierEmblem(lift: LiftTierKey, index: number, file: File | null) {
    if (!file) return;
    try {
      const dataUrl = await readPngAsDataUrl(file);
      updateLiftTier(lift, index, { emblem_png: dataUrl });
    } catch (cause: unknown) {
      setGamificationError(String((cause as { message?: string })?.message || cause));
      setGamificationMsg("");
    }
  }

  async function uploadRelativeTierEmblem(lift: LiftTierKey, index: number, file: File | null) {
    if (!file) return;
    try {
      const dataUrl = await readPngAsDataUrl(file);
      updateRelativeTier(lift, index, { emblem_png: dataUrl });
    } catch (cause: unknown) {
      setGamificationError(String((cause as { message?: string })?.message || cause));
      setGamificationMsg("");
    }
  }

  async function uploadTrilogyEmblem(file: File | null) {
    if (!file) return;
    try {
      const dataUrl = await readPngAsDataUrl(file);
      setGamificationConfig((current) => (current ? { ...current, trilogy_emblem_png: dataUrl } : current));
      setGamificationMsg("");
      setGamificationError("");
    } catch (cause: unknown) {
      setGamificationError(String((cause as { message?: string })?.message || cause));
      setGamificationMsg("");
    }
  }

  async function saveGamificationRules() {
    if (!gamificationConfig) return;
    setGamificationBusy(true);
    setGamificationError("");
    setGamificationMsg("");
    try {
      const saved = await updateAdminGamificationConfig(gamificationConfig);
      setGamificationConfig(cloneGamificationConfig(saved));
      setGamificationMsg("Configuracion de logros/medallas guardada.");
    } catch (cause: unknown) {
      setGamificationError(String((cause as { message?: string })?.message || cause));
    } finally {
      setGamificationBusy(false);
    }
  }

  function loadGamificationDefaults() {
    if (!gamificationDefaults) return;
    setGamificationConfig(cloneGamificationConfig(gamificationDefaults));
    setGamificationMsg("Valores recomendados cargados. Guarda para aplicarlos.");
    setGamificationError("");
  }

  async function importLegacyFile(file: File | null) {
    if (!file) return;

    setImportBusy(true);
    setImportMsg("");
    try {
      const raw = await file.text();
      const items = parseExerciseImportFile(raw);
      const result = await importGlobalCatalog({ mode: importMode, items });
      setImportMsg(
        `Import global completo: +${result.imported} nuevos, ${result.updated} actualizados, ${result.skipped} duplicados sin cambios. Total procesado: ${result.total}.`,
      );
    } catch (e: unknown) {
      setImportMsg(String((e as { message?: string })?.message || e));
    } finally {
      setImportBusy(false);
    }
  }

  async function exportCatalogFile() {
    setExportBusy(true);
    setImportMsg("");
    try {
      const payload = await exportGlobalCatalog();
      const safeStamp = payload.exported_at_utc
        .replace(/[:]/g, "-")
        .replace(/\.\d+/, "")
        .replace("T", "_");
      const fileName = `global_exercises_${safeStamp}.json`;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setImportMsg(`Export global generado: ${payload.total} ejercicios (${fileName}).`);
    } catch (e: unknown) {
      setImportMsg(String((e as { message?: string })?.message || e));
    } finally {
      setExportBusy(false);
    }
  }

  const voiceCalibrationCurrentStep = VOICE_CALIBRATION_STEPS[Math.min(voiceCalibrationStepIndex, VOICE_CALIBRATION_STEPS.length - 1)];
  const voiceCalibrationCurrentCapture = useMemo(
    () => voiceCalibrationCaptures.find((entry) => entry.step_index === voiceCalibrationStepIndex) || null,
    [voiceCalibrationCaptures, voiceCalibrationStepIndex],
  );
  const voiceCalibrationCapturedCount = useMemo(() => {
    const uniqueSteps = new Set(voiceCalibrationCaptures.map((entry) => entry.step_id));
    return uniqueSteps.size;
  }, [voiceCalibrationCaptures]);
  const voiceCalibrationSuggestedCorrections = useMemo(() => {
    return collectCalibrationSuggestions(voiceCalibrationCaptures);
  }, [voiceCalibrationCaptures]);

  const parsedSessionBatch = useMemo(() => {
    try {
      return JSON.parse(sessionImportText) as unknown;
    } catch {
      return null;
    }
  }, [sessionImportText]);

  const parsedSessionCount = useMemo(() => {
    if (!Array.isArray(parsedSessionBatch)) return 0;
    return parsedSessionBatch.length;
  }, [parsedSessionBatch]);

  async function submitSessionImport() {
    if (!parsedSessionBatch) {
      setSessionImportError("JSON invalido. Corrige formato antes de enviar.");
      setSessionImportInfo("");
      return;
    }

    setSessionImportBusy(true);
    setSessionImportError("");
    setSessionImportInfo("");
    setSessionImportResult("");
    try {
      const result = await ingestSessions(parsedSessionBatch);
      setSessionImportInfo("Batch importado correctamente.");
      setSessionImportResult(JSON.stringify(result, null, 2));
    } catch (e: unknown) {
      setSessionImportError(String((e as { message?: string })?.message || e));
    } finally {
      setSessionImportBusy(false);
    }
  }

  function loadSessionSample() {
    setSessionImportText(JSON.stringify(SESSION_IMPORT_SAMPLE, null, 2));
    setSessionImportError("");
    setSessionImportInfo("");
    setSessionImportResult("");
  }

  async function importSessionFile(file: File | null) {
    if (!file) return;
    try {
      const raw = await file.text();
      setSessionImportText(raw);
      setSessionImportShowAdvanced(false);
      setSessionImportError("");
      setSessionImportInfo("");
      setSessionImportResult("");
    } catch {
      setSessionImportError("No se pudo leer el archivo.");
      setSessionImportInfo("");
    }
  }

  function requestDangerConfirmation(actionLabel: string, expected: string): boolean {
    const answer = window.prompt(`${actionLabel}\nEscribe exactamente: ${expected}`);
    if (answer === null) return false;
    return answer.trim() === expected;
  }

  async function clearAllRoutines() {
    setDangerError("");
    setDangerInfo("");

    if (!athleteId) {
      setDangerError("Selecciona un sujeto activo para borrar rutinas.");
      return;
    }

    const subjectLabel = activeSubject?.label || athleteId;
    const ok = requestDangerConfirmation(
      `Esta accion borra TODAS las rutinas locales del sujeto activo (${subjectLabel}).`,
      "BORRAR RUTINAS",
    );
    if (!ok) {
      setDangerError("Confirmacion cancelada.");
      return;
    }

    const sourceAthleteId = athleteId;
    const previousRoutines = loadRoutines(sourceAthleteId).map((routine) => ({
      ...routine,
      exercises: routine.exercises.map((exercise) => ({ ...exercise })),
    }));

    setDangerBusy(true);
    try {
      saveRoutines([], sourceAthleteId);
      setDangerInfo(`Rutinas locales eliminadas para ${subjectLabel}.`);
      registerUndo({
        message: `Rutinas locales eliminadas (${subjectLabel}).`,
        onUndo: async () => {
          saveRoutines(previousRoutines, sourceAthleteId);
          setDangerError("");
          setDangerInfo(`Rutinas restauradas para ${subjectLabel}: ${previousRoutines.length}.`);
        },
      });
    } catch (e: unknown) {
      setDangerError(String((e as { message?: string })?.message || e));
    } finally {
      setDangerBusy(false);
    }
  }

  async function clearAllCustomExercises() {
    setDangerError("");
    setDangerInfo("");

    const customItems = items.filter((item) => item.scope === "custom");
    const customSnapshots = customItems.map((item) => ({
      group: item.group,
      family: item.family,
      variation: item.variation,
      subvariation: item.subvariation,
      aliases: item.aliases,
    }));
    if (customItems.length === 0) {
      setDangerInfo("No hay ejercicios personalizados para borrar.");
      return;
    }

    const ok = requestDangerConfirmation(
      `Esta accion borra ${customItems.length} ejercicios personalizados.`,
      "BORRAR EJERCICIOS PERSONALIZADOS",
    );
    if (!ok) {
      setDangerError("Confirmacion cancelada.");
      return;
    }

    setDangerBusy(true);
    try {
      for (const item of customItems) {
        await removeItem(item);
      }
      await refresh();
      setDangerInfo(`Ejercicios personalizados eliminados: ${customItems.length}.`);
      registerUndo({
        message: `Ejercicios personalizados eliminados (${customItems.length}).`,
        onUndo: async () => {
          try {
            for (const payload of customSnapshots) {
              await addCustom(payload);
            }
            await refresh();
            setDangerError("");
            setDangerInfo(`Ejercicios personalizados restaurados: ${customSnapshots.length}.`);
          } catch (cause: unknown) {
            const message = String((cause as { message?: string })?.message || cause);
            setDangerError(message);
            throw cause;
          }
        },
      });
    } catch (e: unknown) {
      setDangerError(String((e as { message?: string })?.message || e));
    } finally {
      setDangerBusy(false);
    }
  }

  async function clearAllGlobalExercises() {
    setDangerError("");
    setDangerInfo("");

    if (!isAdminMode) {
      setDangerError("Solo admin puede borrar ejercicios globales.");
      return;
    }

    const globalItems = items
      .filter((item) => item.scope === "global")
      .map((item) => ({
        ...item,
        aliases: item.aliases ? [...item.aliases] : undefined,
      }));
    const globalCount = globalItems.length;
    const ok = requestDangerConfirmation(
      `Esta accion borra TODOS los ejercicios globales (${globalCount}).`,
      "BORRAR EJERCICIOS GLOBALES",
    );
    if (!ok) {
      setDangerError("Confirmacion cancelada.");
      return;
    }

    setDangerBusy(true);
    try {
      await importGlobalCatalog({ mode: "replace", items: [] });
      await refresh();
      setDangerInfo("Ejercicios globales eliminados.");
      registerUndo({
        message: `Ejercicios globales eliminados (${globalCount}).`,
        onUndo: async () => {
          try {
            await importGlobalCatalog({ mode: "replace", items: globalItems });
            await refresh();
            setDangerError("");
            setDangerInfo(`Ejercicios globales restaurados: ${globalCount}.`);
          } catch (cause: unknown) {
            const message = String((cause as { message?: string })?.message || cause);
            setDangerError(message);
            throw cause;
          }
        },
      });
    } catch (e: unknown) {
      setDangerError(String((e as { message?: string })?.message || e));
    } finally {
      setDangerBusy(false);
    }
  }

  async function deleteAccount() {
    setDangerError("");
    setDangerInfo("");

    const ok = requestDangerConfirmation(
      "Esta accion elimina tu cuenta y tus datos personales asociados.",
      "ELIMINAR CUENTA",
    );
    if (!ok) {
      setDangerError("Confirmacion cancelada.");
      return;
    }

    setDangerBusy(true);
    try {
      await deleteMyAccount("ELIMINAR CUENTA");
      logout();
      nav("/login", { replace: true });
    } catch (e: unknown) {
      setDangerError(String((e as { message?: string })?.message || e));
    } finally {
      setDangerBusy(false);
    }
  }

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Ajustes</h1>
        <p>Personaliza tu experiencia y gestiona tu cuenta de forma simple.</p>
      </header>

      <section className="surface">
        <div className="sectionHead">
          <h3>Módulos de ajustes</h3>
          <p>Muestra solo el bloque que quieres editar para evitar ruido visual.</p>
        </div>
        <div className="pillGroup" style={{ marginTop: 10 }}>
          {[
            { id: "general", label: "General" },
            { id: "navigation", label: "Navegación" },
            { id: "account", label: "Cuenta" },
            { id: "admin", label: "Admin" },
            { id: "security", label: "Seguridad" },
          ].map((panel) => (
            <button
              key={panel.id}
              type="button"
              className={`pill ${activePanel === panel.id ? "active" : ""}`}
              onClick={() => setActivePanel(panel.id as SettingsPanel)}
            >
              <span>{panel.label}</span>
            </button>
          ))}
        </div>
      </section>

      {activePanel === "account" ? (
        <>
          <section className="surface">
            <div className="sectionHead">
              <h3>Cuenta</h3>
              <p>Estado actual de autenticación y plan.</p>
            </div>
            <div className="chipRow">
              <span className="chip">Email: {user?.email || "-"}</span>
              <span className="chip">Rol: {user?.role || "-"}</span>
              <span className="chip">Plan: {planLabel || "-"}</span>
            </div>
          </section>

          <section className="surface">
            <div className="sectionHead">
              <h3>Planes</h3>
              <p>Resumen rápido de las modalidades disponibles.</p>
            </div>
            <div className="gridCards">
              <article className="surfaceButton">
                <strong>Standard</strong>
                <span className="small">Base individual: registro, historial y escenarios esenciales.</span>
              </article>
              <article className="surfaceButton">
                <strong>Plus</strong>
                <span className="small">Más analítica y módulos habilitables para seguimiento avanzado.</span>
              </article>
              <article className="surfaceButton">
                <strong>Coach</strong>
                <span className="small">Gestión de varios atletas y operaciones de coaching.</span>
              </article>
            </div>
          </section>
        </>
      ) : null}

      {activePanel === "navigation" ? (
        <section className="surface">
          <div className="sectionHead">
            <h3>Barra principal</h3>
            <p>Fija hasta 5 módulos frecuentes en la barra superior. El resto queda en “Más”.</p>
          </div>
          <div className="pillGroup" style={{ marginTop: 10 }}>
            {availableNavModules.map((module) => {
              const active = prefs.pinnedModules.includes(module.id);
              return (
                <button
                  key={module.id}
                  type="button"
                  className={`pill ${active ? "active" : ""}`}
                  onClick={() => togglePinnedModule(module.id)}
                >
                  <span>{module.label}</span>
                  <small>{active ? "Anclado en barra" : module.hint}</small>
                </button>
              );
            })}
          </div>
          <div className="small" style={{ marginTop: 10 }}>
            {`Módulos anclados: ${prefs.pinnedModules.length} / 5`}
          </div>
        </section>
      ) : null}

      {activePanel === "general" ? (
        <>
          <OptionRow
            label="Tema"
            description="Interfaz clara u oscura para entrenar en cualquier entorno."
            value={prefs.theme}
            onChange={setTheme}
            options={[
              { label: "Sistema", value: "system", hint: "sigue modo del navegador/SO" },
              { label: "Claro", value: "light", hint: "alto contraste en luz" },
              { label: "Oscuro", value: "dark", hint: "comodidad en noche/gym" },
            ]}
          />

          <OptionRow
            label="Escala de esfuerzo"
            description="El formulario de sesiones se adapta a tu forma de anotar intensidad."
            value={prefs.effortScale}
            onChange={setEffortScale}
            options={[
              { label: "RPE", value: "rpe", hint: "0-10 esfuerzo percibido" },
              { label: "RIR", value: "rir", hint: "reps en reserva" },
            ]}
          />

          <OptionRow
            label="Unidad de carga"
            description="Cómo deseas ver y capturar pesos de entrenamiento."
            value={prefs.weightUnit}
            onChange={setWeightUnit}
            options={[
              { label: "Kilogramos", value: "kg", hint: "estándar técnico" },
              { label: "Libras", value: "lb", hint: "convención comercial" },
            ]}
          />

          <OptionRow
            label="Unidad de distancia"
            description="Preparado para trabajo de cardio/traslados."
            value={prefs.distanceUnit}
            onChange={setDistanceUnit}
            options={[
              { label: "Metros", value: "m", hint: "precisión corta" },
              { label: "Millas", value: "mi", hint: "referencia imperial" },
            ]}
          />
        </>
      ) : null}

      {activePanel === "admin" ? (
        isAdminMode ? (
        <>
          <section className="surface">
            <div className="sectionHead">
              <h3>Admin: entrenar voz (comandos)</h3>
              <p>
                Define palabras/sinonimos que el parser debe reconocer para aplicar comandos de sets. Cada linea agrega una
                palabra o frase corta.
              </p>
            </div>

            <article className="surfaceButton" style={{ alignItems: "stretch", marginTop: 12 }}>
              <label className="smallLabel">Wake aliases personalizados (escucha)</label>
              <textarea
                className="input compactTextarea"
                value={voiceTrainingDraft.wake_aliases}
                onChange={(e) => {
                  setVoiceTrainingDraft((prev) => ({ ...prev, wake_aliases: e.target.value }));
                  setVoiceTrainingMsg("");
                  setVoiceTrainingError("");
                }}
                placeholder="Ejemplo: jarvis, nombre app, asistente..."
                style={{ minHeight: 96 }}
              />
              <span className="small">
                Se combinan con la palabra base de wake para habilitar activacion personalizada.
              </span>
            </article>

            <article className="surfaceButton" style={{ alignItems: "stretch", marginTop: 12 }}>
              <label className="smallLabel">Autocorreccion de frases (entrenamiento)</label>
              <textarea
                className="input compactTextarea"
                value={voiceTrainingDraft.phrase_corrections}
                onChange={(e) => {
                  setVoiceTrainingDraft((prev) => ({ ...prev, phrase_corrections: e.target.value }));
                  setVoiceTrainingMsg("");
                  setVoiceTrainingError("");
                }}
                placeholder={"Formato: frase escuchada => frase objetivo\nEjemplo: pezo => peso\nEjemplo: r p e => rpe"}
                style={{ minHeight: 120 }}
              />
              <span className="small">Una regla por linea. Se aplica antes de parsear el comando.</span>
            </article>

            <article className="surfaceButton" style={{ alignItems: "stretch", marginTop: 12 }}>
              <div className="sectionHead">
                <h4>Wizard calibracion de voz</h4>
                <p>
                  Guia asistida para detectar diferencias entre lo que dices y lo que el modelo transcribe. Genera
                  autocorrecciones y las guarda en tu perfil.
                </p>
              </div>

              <div className="chipRow" style={{ marginTop: 8 }}>
                <span className="chip">{`Estado: ${calibrationStatusLabel(voiceCalibrationStatus)}`}</span>
                <span className="chip">{`Paso: ${Math.min(voiceCalibrationStepIndex + 1, VOICE_CALIBRATION_STEPS.length)} / ${VOICE_CALIBRATION_STEPS.length}`}</span>
                <span className="chip">{`Capturas: ${voiceCalibrationCapturedCount}`}</span>
                <span className="chip">{`Sugerencias: ${voiceCalibrationSuggestedCorrections.length}`}</span>
              </div>

              <div className="small" style={{ marginTop: 8 }}>{`Frase objetivo (${voiceCalibrationCurrentStep.title}):`}</div>
              <div className="message" style={{ marginTop: 6 }}>
                <strong>{voiceCalibrationCurrentStep.expected}</strong>
              </div>

              <div className="small" style={{ marginTop: 8 }}>
                {voiceCalibrationAwaiting
                  ? "Escuchando este paso ahora. Habla una sola frase completa."
                  : "Pulsa 'Capturar paso' y dicta la frase objetivo exactamente."}
              </div>
              {voiceCalibrationPartial ? <div className="small">{`Parcial: ${voiceCalibrationPartial}`}</div> : null}
              {voiceCalibrationCurrentCapture ? (
                <div className="small">
                  {`Ultimo resultado del paso: ${voiceCalibrationCurrentCapture.heard} (${voiceCalibrationCurrentCapture.matched ? "match" : "diferente"})`}
                </div>
              ) : null}

              <div className="quickActions" style={{ marginTop: 10 }}>
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => void startVoiceCalibrationWizard()}
                  disabled={voiceCalibrationBusy || voiceTrainingBusy}
                >
                  {voiceCalibrationRunning ? "Reiniciar wizard" : "Iniciar wizard"}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={captureVoiceCalibrationStep}
                  disabled={!voiceCalibrationRunning || voiceCalibrationBusy || voiceTrainingBusy || voiceCalibrationAwaiting}
                >
                  Capturar paso
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={retryVoiceCalibrationStep}
                  disabled={!voiceCalibrationRunning || voiceCalibrationBusy || voiceTrainingBusy}
                >
                  Repetir paso
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => void stopVoiceCalibrationWizard()}
                  disabled={!voiceCalibrationRunning || voiceCalibrationBusy || voiceTrainingBusy}
                >
                  Detener wizard
                </button>
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => void applyVoiceCalibrationSuggestions()}
                  disabled={voiceCalibrationSuggestedCorrections.length === 0 || voiceTrainingBusy || voiceCalibrationBusy}
                >
                  Aplicar sugerencias
                </button>
              </div>

              {voiceCalibrationSuggestedCorrections.length > 0 ? (
                <details style={{ marginTop: 10 }}>
                  <summary>Sugerencias detectadas</summary>
                  <div className="small" style={{ marginTop: 8 }}>
                    {voiceCalibrationSuggestedCorrections
                      .slice(0, 20)
                      .map((entry) => `${entry.from} => ${entry.to}`)
                      .join(" | ")}
                  </div>
                </details>
              ) : null}

              {voiceCalibrationError ? <div className="message error" style={{ marginTop: 10 }}>{voiceCalibrationError}</div> : null}
              {voiceCalibrationInfo ? <div className="message" style={{ marginTop: 10 }}>{voiceCalibrationInfo}</div> : null}
            </article>

            <div className="gridCards" style={{ marginTop: 12 }}>
              {VOICE_TRAINABLE_INTENTS.map((intent) => (
                <article key={intent} className="surfaceButton" style={{ alignItems: "stretch" }}>
                  <label className="smallLabel">{VOICE_TRAINABLE_INTENT_LABELS[intent]}</label>
                  <textarea
                    className="input compactTextarea"
                    value={voiceTrainingDraft[intent]}
                    onChange={(e) => updateVoiceTrainingDraft(intent, e.target.value)}
                    placeholder="Ejemplo: repeticiones, repes, subir peso..."
                    style={{ minHeight: 120 }}
                  />
                </article>
              ))}
            </div>

            <div className="quickActions" style={{ marginTop: 12 }}>
              <button className="btn primary" type="button" onClick={() => void saveVoiceTrainingRules()} disabled={voiceTrainingBusy}>
                {voiceTrainingBusy ? "Guardando..." : "Guardar entrenamiento voz"}
              </button>
              <button className="btn" type="button" onClick={() => void resetVoiceTrainingRules()} disabled={voiceTrainingBusy}>
                Reiniciar
              </button>
              <button className="btn" type="button" onClick={exportVoiceTrainingRules} disabled={voiceTrainingBusy}>
                Exportar JSON
              </button>
              <label
                className="btn"
                style={{ cursor: voiceTrainingBusy ? "not-allowed" : "pointer", opacity: voiceTrainingBusy ? 0.6 : 1 }}
              >
                Importar JSON
                <input
                  type="file"
                  accept="application/json,.json"
                  style={{ display: "none" }}
                  disabled={voiceTrainingBusy}
                  onChange={(e) => {
                    void importVoiceTrainingFile(e.target.files?.[0] || null);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
            </div>

            <div className="chipRow" style={{ marginTop: 12 }}>
              <span className="chip">{`Ultima actualizacion: ${
                voiceTrainingProfile.updated_at_ms
                  ? new Date(voiceTrainingProfile.updated_at_ms).toLocaleString()
                  : "sin entrenamiento guardado"
              }`}</span>
            </div>

            {voiceTrainingError ? <div className="message error" style={{ marginTop: 12 }}>{voiceTrainingError}</div> : null}
            {voiceTrainingMsg ? <div className="message" style={{ marginTop: 12 }}>{voiceTrainingMsg}</div> : null}
          </section>

          <section className="surface">
            <div className="sectionHead">
              <h3>Admin: logros y medallas automaticos</h3>
              <p>Agrega, edita y configura las reglas del sistema de logros global.</p>
            </div>

            {gamificationLoading ? (
              <div className="emptyState" style={{ marginTop: 12 }}>
                Cargando configuracion...
              </div>
            ) : null}

            {!gamificationLoading && gamificationConfig ? (
              <div className="stack" style={{ marginTop: 12 }}>
                <article className="surfaceButton">
                  <div className="sectionHead">
                    <h4>Racha flexible</h4>
                    <p>
                      La racha no exige entrenar diario: sigue activa mientras no pasen mas de N dias desde el ultimo entreno.
                    </p>
                  </div>
                  <div className="splitGrid" style={{ marginTop: 10 }}>
                    <div>
                      <label className="smallLabel">Tolerancia (dias)</label>
                      <input
                        type="number"
                        className="input"
                        min={1}
                        max={14}
                        step={1}
                        value={gamificationConfig.streak_gap_tolerance_days}
                        onChange={(e) => {
                          const value = Math.max(1, Math.min(14, Number(e.target.value) || 7));
                          setGamificationConfig((current) =>
                            current ? { ...current, streak_gap_tolerance_days: value } : current,
                          );
                          setGamificationMsg("");
                          setGamificationError("");
                        }}
                      />
                    </div>
                  </div>
                </article>

                <div className="gridCards">
                  <TierEditor
                    title="Rachas"
                    tiers={gamificationConfig.streak_tiers}
                    thresholdLabel="Entrenos en racha"
                    onTierChange={(index, patch) => updateTierBucket("streak_tiers", index, patch)}
                    onTierAdd={() => addTierBucketRow("streak_tiers")}
                    onTierRemove={(index) => removeTierBucketRow("streak_tiers", index)}
                    onTierUploadEmblem={(index, file) => void uploadTierBucketEmblem("streak_tiers", index, file)}
                    onTierClearEmblem={(index) => updateTierBucket("streak_tiers", index, { emblem_png: null })}
                  />
                  <TierEditor
                    title="Dias completados de planificacion"
                    tiers={gamificationConfig.planning_days_tiers}
                    onTierChange={(index, patch) => updateTierBucket("planning_days_tiers", index, patch)}
                    onTierAdd={() => addTierBucketRow("planning_days_tiers")}
                    onTierRemove={(index) => removeTierBucketRow("planning_days_tiers", index)}
                    onTierUploadEmblem={(index, file) =>
                      void uploadTierBucketEmblem("planning_days_tiers", index, file)
                    }
                    onTierClearEmblem={(index) => updateTierBucket("planning_days_tiers", index, { emblem_png: null })}
                  />
                </div>

                <div className="gridCards">
                  {(Object.keys(LIFT_TIER_LABELS) as LiftTierKey[]).map((liftKey) => (
                    <TierEditor
                      key={liftKey}
                      title={LIFT_TIER_LABELS[liftKey]}
                      tiers={gamificationConfig.lift_tiers[liftKey]}
                      onTierChange={(index, patch) => updateLiftTier(liftKey, index, patch)}
                      onTierAdd={() => addLiftTierRow(liftKey)}
                      onTierRemove={(index) => removeLiftTierRow(liftKey, index)}
                      onTierUploadEmblem={(index, file) => void uploadLiftTierEmblem(liftKey, index, file)}
                      onTierClearEmblem={(index) => updateLiftTier(liftKey, index, { emblem_png: null })}
                    />
                  ))}
                </div>

                <div className="gridCards">
                  {(Object.keys(LIFT_TIER_LABELS) as LiftTierKey[]).map((liftKey) => (
                    <TierEditor
                      key={`relative_${liftKey}`}
                      title={`Fuerza relativa ${LIFT_TIER_LABELS[liftKey]}`}
                      tiers={gamificationConfig.relative_strength_tiers[liftKey]}
                      thresholdLabel="Ratio objetivo (x BW)"
                      thresholdStep="0.05"
                      onTierChange={(index, patch) => updateRelativeTier(liftKey, index, patch)}
                      onTierAdd={() => addRelativeTierRow(liftKey)}
                      onTierRemove={(index) => removeRelativeTierRow(liftKey, index)}
                      onTierUploadEmblem={(index, file) => void uploadRelativeTierEmblem(liftKey, index, file)}
                      onTierClearEmblem={(index) => updateRelativeTier(liftKey, index, { emblem_png: null })}
                    />
                  ))}
                </div>

                <article className="surfaceButton">
                  <div className="sectionHead">
                    <h4>Bonus trilogia basica</h4>
                    <p>Se desbloquea cuando los 3 basicos superan el primer umbral.</p>
                  </div>
                  <div className="splitGrid" style={{ marginTop: 10 }}>
                    <div>
                      <label className="smallLabel">Logro</label>
                      <input
                        className="input"
                        value={gamificationConfig.trilogy_achievement}
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          setGamificationConfig((current) =>
                            current ? { ...current, trilogy_achievement: nextValue } : current,
                          );
                          setGamificationMsg("");
                          setGamificationError("");
                        }}
                      />
                    </div>
                    <div>
                      <label className="smallLabel">Medalla</label>
                      <input
                        className="input"
                        value={gamificationConfig.trilogy_medal}
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          setGamificationConfig((current) =>
                            current ? { ...current, trilogy_medal: nextValue } : current,
                          );
                          setGamificationMsg("");
                          setGamificationError("");
                        }}
                      />
                    </div>
                    <div>
                      <label className="smallLabel">Emblema PNG</label>
                      <input
                        className="input"
                        value={gamificationConfig.trilogy_emblem_png || ""}
                        placeholder="https://cdn.ejemplo.com/trilogia.png o data:image/png;base64,..."
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          setGamificationConfig((current) =>
                            current ? { ...current, trilogy_emblem_png: nextValue || null } : current,
                          );
                          setGamificationMsg("");
                          setGamificationError("");
                        }}
                      />
                    </div>
                  </div>

                  <div className="quickActions" style={{ marginTop: 10 }}>
                    <label className="btn" style={{ cursor: "pointer" }}>
                      Subir PNG de trilogia
                      <input
                        type="file"
                        accept="image/png,.png"
                        style={{ display: "none" }}
                        onChange={(e) => {
                          void uploadTrilogyEmblem(e.target.files?.[0] || null);
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => {
                        setGamificationConfig((current) => (current ? { ...current, trilogy_emblem_png: null } : current));
                        setGamificationMsg("");
                        setGamificationError("");
                      }}
                      disabled={!gamificationConfig.trilogy_emblem_png}
                    >
                      Quitar emblema
                    </button>
                    {gamificationConfig.trilogy_emblem_png ? (
                      <img
                        src={gamificationConfig.trilogy_emblem_png}
                        alt="Emblema trilogia basica"
                        style={{ width: 46, height: 46, objectFit: "cover", borderRadius: 10, border: "1px solid var(--border)" }}
                      />
                    ) : null}
                  </div>
                </article>

                <div className="quickActions">
                  <button className="btn primary" onClick={saveGamificationRules} disabled={gamificationBusy}>
                    {gamificationBusy ? "Guardando..." : "Guardar reglas de logros"}
                  </button>
                  <button className="btn" onClick={loadGamificationDefaults} disabled={gamificationBusy || !gamificationDefaults}>
                    Restaurar recomendados
                  </button>
                </div>
              </div>
            ) : null}

            {gamificationError ? <div className="message error" style={{ marginTop: 12 }}>{gamificationError}</div> : null}
            {gamificationMsg ? <div className="message" style={{ marginTop: 12 }}>{gamificationMsg}</div> : null}
          </section>

          <section className="surface">
            <div className="sectionHead">
              <h3>Admin: import/export catalogo global</h3>
              <p>Importa JSON legacy o exportado y descarga snapshots del catalogo global compartido.</p>
            </div>

            <div className="pillGroup" style={{ marginTop: 10 }}>
              <button
                type="button"
                className={`pill ${importMode === "merge" ? "active" : ""}`}
                onClick={() => setImportMode("merge")}
              >
                <span>Merge</span>
                <small>Agrega/actualiza sin borrar existentes</small>
              </button>
              <button
                type="button"
                className={`pill ${importMode === "replace" ? "active" : ""}`}
                onClick={() => setImportMode("replace")}
              >
                <span>Replace</span>
                <small>Reemplaza el catalogo por el importado</small>
              </button>
            </div>

            <div className="quickActions" style={{ marginTop: 12 }}>
              <button className="btn" onClick={exportCatalogFile} disabled={importBusy || exportBusy}>
                {exportBusy ? "Exportando..." : "Exportar JSON global"}
              </button>
              <label
                className="btn"
                style={{ cursor: importBusy || exportBusy ? "not-allowed" : "pointer", opacity: importBusy || exportBusy ? 0.6 : 1 }}
              >
                {importBusy ? "Importando..." : "Seleccionar JSON para importar"}
                <input
                  type="file"
                  accept="application/json,.json"
                  style={{ display: "none" }}
                  disabled={importBusy || exportBusy}
                  onChange={(e) => {
                    void importLegacyFile(e.target.files?.[0] || null);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
            </div>

            {importMsg ? <div className="message" style={{ marginTop: 12 }}>{importMsg}</div> : null}
          </section>

          <section className="surface">
            <div className="sectionHead">
              <h3>Admin: importación de sesiones</h3>
              <p>Herramienta avanzada para carga masiva de sesiones en JSON.</p>
            </div>

            <div className="quickActions" style={{ marginTop: 12 }}>
              <button className="btn" onClick={loadSessionSample} disabled={sessionImportBusy}>
                Cargar ejemplo
              </button>
              <label
                className="btn"
                style={{ cursor: sessionImportBusy ? "not-allowed" : "pointer", opacity: sessionImportBusy ? 0.6 : 1 }}
              >
                Importar archivo .json
                <input
                  type="file"
                  accept="application/json,.json"
                  style={{ display: "none" }}
                  disabled={sessionImportBusy}
                  onChange={(e) => {
                    void importSessionFile(e.target.files?.[0] || null);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
              <button className="btn" onClick={() => setSessionImportShowAdvanced((value) => !value)} disabled={sessionImportBusy}>
                {sessionImportShowAdvanced ? "Ocultar editor avanzado" : "Mostrar editor avanzado"}
              </button>
            </div>

            <div className="chipRow" style={{ marginTop: 12 }}>
              <span className="chip">JSON: {parsedSessionBatch ? "valido" : "invalido"}</span>
              <span className="chip">Sesiones detectadas: {parsedSessionCount}</span>
            </div>

            {sessionImportShowAdvanced ? (
              <div style={{ marginTop: 12 }}>
                <label className="smallLabel">Editor JSON (avanzado)</label>
                <textarea
                  className="input compactTextarea"
                  value={sessionImportText}
                  onChange={(e) => setSessionImportText(e.target.value)}
                />
              </div>
            ) : null}

            <div className="quickActions" style={{ marginTop: 12 }}>
              <button className="btn primary" onClick={submitSessionImport} disabled={!parsedSessionBatch || sessionImportBusy}>
                {sessionImportBusy ? "Enviando..." : "Enviar batch"}
              </button>
            </div>

            {sessionImportError ? <div className="message error" style={{ marginTop: 12 }}>{sessionImportError}</div> : null}
            {sessionImportInfo ? <div className="message" style={{ marginTop: 12 }}>{sessionImportInfo}</div> : null}

            {sessionImportResult ? (
              <details style={{ marginTop: 12 }}>
                <summary>Ver detalle JSON de respuesta</summary>
                <pre style={{ marginTop: 10 }}>{sessionImportResult}</pre>
              </details>
            ) : null}
          </section>

          <section className="surface">
            <div className="sectionHead">
              <h3>Admin: cambio de plan/rol</h3>
              <p>Arranque operativo para standard/plus/coach con mapeo interno actual.</p>
            </div>

            <div className="splitGrid" style={{ marginTop: 10 }}>
              <div>
                <label className="smallLabel">Email usuario</label>
                <input className="input" value={switchEmail} onChange={(e) => setSwitchEmail(e.target.value)} />
              </div>

              <div>
                <label className="smallLabel">Plan</label>
                <select className="input" value={switchPlan} onChange={(e) => setSwitchPlan(e.target.value as PlanLabel)}>
                  <option value="standard">Standard</option>
                  <option value="plus">Plus</option>
                  <option value="coach">Coach</option>
                </select>
              </div>

              <div>
                <label className="smallLabel">Rol (opcional)</label>
                <select className="input" value={switchRole} onChange={(e) => setSwitchRole(e.target.value as "" | Role)}>
                  <option value="">Sin cambio</option>
                  <option value="user">User</option>
                  <option value="coach">Coach</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>

            <div className="quickActions" style={{ marginTop: 12 }}>
              <button className="btn primary" onClick={submitSwitchPlan} disabled={switchBusy}>
                {switchBusy ? "Aplicando..." : "Aplicar cambio"}
              </button>
            </div>

            {switchMsg ? <div className="message" style={{ marginTop: 12 }}>{switchMsg}</div> : null}
          </section>
        </>
      ) : (
        <section className="surface">
          <div className="small">
            Las funciones admin solo aparecen en modo admin.
          </div>
        </section>
      )
      ) : null}

      {activePanel === "security" ? (
      <section className="surface">
        <div className="sectionHead">
          <h3>Zona sensible</h3>
          <p>Acciones irreversibles. Cada una exige confirmación escrita.</p>
        </div>

        <div className="quickActions" style={{ marginTop: 12 }}>
          <button className="btn" style={dangerBtnStyle} onClick={clearAllRoutines} disabled={dangerBusy}>
            {dangerBusy ? "Procesando..." : "Borrar todas mis rutinas"}
          </button>
          <button className="btn" style={dangerBtnStyle} onClick={clearAllCustomExercises} disabled={dangerBusy}>
            {dangerBusy ? "Procesando..." : "Borrar todos mis ejercicios personalizados"}
          </button>
          {isAdminMode ? (
            <button className="btn" style={dangerBtnStyle} onClick={clearAllGlobalExercises} disabled={dangerBusy}>
              {dangerBusy ? "Procesando..." : "Admin: borrar todos los ejercicios globales"}
            </button>
          ) : null}
          <button className="btn" style={dangerBtnStyle} onClick={deleteAccount} disabled={dangerBusy}>
            {dangerBusy ? "Procesando..." : "Eliminar mi cuenta"}
          </button>
        </div>

        {dangerError ? <div className="message error" style={{ marginTop: 12 }}>{dangerError}</div> : null}
        {dangerInfo ? <div className="message" style={{ marginTop: 12 }}>{dangerInfo}</div> : null}
      </section>
      ) : null}
    </div>
  );
}
