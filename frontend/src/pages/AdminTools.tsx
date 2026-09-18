import { useEffect, useMemo, useState } from "react";

import { adminSwitchPlan, ingestSessions, labelToBackendPlan, type PlanLabel, type Role } from "../api";
import Select from "../components/Select";
import { parseExerciseImportFile, type LegacyImportMode } from "../lib/legacyImport";
import { useAuth } from "../state/auth";
import { useExerciseCatalog } from "../state/exerciseCatalog";
import { useUndo } from "../state/undo";

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

export default function AdminTools() {
  const { user, planLabel, refreshMe } = useAuth();
  const { registerUndo } = useUndo();
  const { items, importGlobalCatalog, exportGlobalCatalog, refresh } = useExerciseCatalog();

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

  const [dangerBusy, setDangerBusy] = useState(false);
  const [dangerError, setDangerError] = useState("");
  const [dangerInfo, setDangerInfo] = useState("");
  const dangerBtnStyle = { borderColor: "var(--danger)", color: "var(--danger)" } as const;

  useEffect(() => {
    if (!user) return;
    setSwitchEmail(user.email);
    if (planLabel) setSwitchPlan(planLabel);
  }, [user, planLabel]);

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

  async function importLegacyFile(file: File | null) {
    if (!file) return;

    setImportBusy(true);
    setImportMsg("");
    try {
      const raw = await file.text();
      const parsedItems = parseExerciseImportFile(raw);
      const result = await importGlobalCatalog({ mode: importMode, items: parsedItems });
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
      setSessionImportError("JSON inválido. Corrige formato antes de enviar.");
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

  async function clearAllGlobalExercises() {
    setDangerError("");
    setDangerInfo("");

    const globalItems = items
      .filter((item) => item.scope === "global")
      .map((item) => ({
        ...item,
        aliases: item.aliases ? [...item.aliases] : undefined,
      }));
    const globalCount = globalItems.length;
    const answer = window.prompt(
      `Esta acción borra TODOS los ejercicios globales (${globalCount}).\nEscribe exactamente: BORRAR EJERCICIOS GLOBALES`,
    );
    if (answer === null || answer.trim() !== "BORRAR EJERCICIOS GLOBALES") {
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

  return (
    <>
      <section className="surface">
        <div className="sectionHead">
          <h3>Catálogo global</h3>
          <p>Importa JSON legacy o exportado y descarga snapshots del catálogo compartido.</p>
        </div>

        <div className="pillGroup" style={{ marginTop: 10 }}>
          <button
            type="button"
            className={`pill ${importMode === "merge" ? "active" : ""}`}
            onClick={() => setImportMode("merge")}
          >
            <span>Merge</span>
          </button>
          <button
            type="button"
            className={`pill ${importMode === "replace" ? "active" : ""}`}
            onClick={() => setImportMode("replace")}
          >
            <span>Replace</span>
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
            {importBusy ? "Importando..." : "Importar JSON"}
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
          <h3>Importar lote de sesiones</h3>
          <p>Importa lotes JSON al sistema de sesiones.</p>
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
            {sessionImportShowAdvanced ? "Ocultar editor" : "Editor avanzado"}
          </button>
        </div>

        <div className="chipRow" style={{ marginTop: 12 }}>
          <span className="chip">JSON: {parsedSessionBatch ? "válido" : "inválido"}</span>
          <span className="chip">Sesiones detectadas: {parsedSessionCount}</span>
        </div>

        {sessionImportShowAdvanced ? (
          <div style={{ marginTop: 12 }}>
            <label className="smallLabel">Editor JSON</label>
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
          <h3>Cambio de plan/rol</h3>
        </div>

        <div className="splitGrid" style={{ marginTop: 10 }}>
          <div>
            <label className="smallLabel">Email usuario</label>
            <input className="input" value={switchEmail} onChange={(e) => setSwitchEmail(e.target.value)} />
          </div>

          <div>
            <label className="smallLabel">Plan</label>
            <Select
              value={switchPlan}
              onChange={(v) => setSwitchPlan(v as PlanLabel)}
              options={[
                { value: "standard", label: "Standard" },
                { value: "plus", label: "Plus" },
                { value: "coach", label: "Coach" },
              ]}
            />
          </div>

          <div>
            <label className="smallLabel">Rol (opcional)</label>
            <Select
              value={switchRole}
              onChange={(v) => setSwitchRole(v as "" | Role)}
              options={[
                { value: "", label: "Sin cambio" },
                { value: "user", label: "User" },
                { value: "coach", label: "Coach" },
                { value: "admin", label: "Admin" },
              ]}
            />
          </div>
        </div>

        <div className="quickActions" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={submitSwitchPlan} disabled={switchBusy}>
            {switchBusy ? "Aplicando..." : "Aplicar cambio"}
          </button>
        </div>

        {switchMsg ? <div className="message" style={{ marginTop: 12 }}>{switchMsg}</div> : null}
      </section>

      <details className="surface dangerZone">
        <summary>Zona peligrosa (admin)</summary>
        <div className="quickActions" style={{ marginTop: 12 }}>
          <button className="btn" style={dangerBtnStyle} onClick={clearAllGlobalExercises} disabled={dangerBusy}>
            {dangerBusy ? "Procesando..." : "Borrar todos los ejercicios globales"}
          </button>
        </div>

        {dangerError ? <div className="message error" style={{ marginTop: 12 }}>{dangerError}</div> : null}
        {dangerInfo ? <div className="message" style={{ marginTop: 12 }}>{dangerInfo}</div> : null}
      </details>
    </>
  );
}
