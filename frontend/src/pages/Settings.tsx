import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  adminSwitchPlan,
  deleteMyAccount,
  getAdminGamificationConfig,
  ingestSessions,
  labelToBackendPlan,
  updateAdminGamificationConfig,
  type GamificationConfig,
  type GamificationTier,
  type PlanLabel,
  type Role,
} from "../api";
import { parseExerciseImportFile, type LegacyImportMode } from "../lib/legacyImport";
import { loadRoutines, saveRoutines } from "../lib/storage";
import { useAthleteAccess } from "../state/athlete";
import { useExerciseCatalog } from "../state/exerciseCatalog";
import { useAuth } from "../state/auth";
import { usePreferences } from "../state/preferences";
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

export default function Settings() {
  const nav = useNavigate();
  const { athleteId, activeSubject } = useAthleteAccess();
  const { prefs, setTheme, setEffortScale, setWeightUnit, setDistanceUnit } = usePreferences();
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

  const [dangerBusy, setDangerBusy] = useState(false);
  const [dangerError, setDangerError] = useState("");
  const [dangerInfo, setDangerInfo] = useState("");
  const dangerBtnStyle = { borderColor: "var(--danger)", color: "var(--danger)" } as const;

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
        <p>Personaliza la experiencia y gestiona cuenta/planes para esta etapa del producto.</p>
      </header>

      <section className="surface">
        <div className="sectionHead">
          <h3>Cuenta</h3>
          <p>Estado actual de autenticacion y plan.</p>
        </div>
        <div className="chipRow">
          <span className="chip">Email: {user?.email || "-"}</span>
          <span className="chip">Rol: {user?.role || "-"}</span>
          <span className="chip">Plan: {planLabel || "-"}</span>
        </div>
      </section>

      <section className="surface">
        <div className="sectionHead">
          <h3>Planes (roadmap inicial)</h3>
          <p>Nomenclatura de producto: standard, plus y coach.</p>
        </div>
        <div className="gridCards">
          <article className="surfaceButton">
            <strong>Standard</strong>
            <span className="small">Base individual: registro, historial y escenarios esenciales.</span>
          </article>
          <article className="surfaceButton">
            <strong>Plus</strong>
            <span className="small">Mas analitica y modulos habilitables para seguimiento avanzado.</span>
          </article>
          <article className="surfaceButton">
            <strong>Coach</strong>
            <span className="small">Gestion de varios atletas y operaciones de coaching.</span>
          </article>
        </div>
      </section>

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
        description="Como deseas ver y capturar pesos de entrenamiento."
        value={prefs.weightUnit}
        onChange={setWeightUnit}
        options={[
          { label: "Kilogramos", value: "kg", hint: "estandar tecnico" },
          { label: "Libras", value: "lb", hint: "convencion comercial" },
        ]}
      />

      <OptionRow
        label="Unidad de distancia"
        description="Preparado para trabajo de cardio/traslados."
        value={prefs.distanceUnit}
        onChange={setDistanceUnit}
        options={[
          { label: "Metros", value: "m", hint: "precision corta" },
          { label: "Millas", value: "mi", hint: "referencia imperial" },
        ]}
      />

      {isAdminMode ? (
        <>
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
              <h3>Admin: import batch de sesiones (debug)</h3>
              <p>Importa lotes JSON al sistema de sesiones sin usar una pestaña separada.</p>
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
      )}

      <section className="surface">
        <div className="sectionHead">
          <h3>Danger Zone</h3>
          <p>Acciones destructivas. Cada una exige confirmacion escrita.</p>
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
    </div>
  );
}
