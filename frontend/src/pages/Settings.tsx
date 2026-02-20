import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { adminSwitchPlan, deleteMyAccount, ingestSessions, labelToBackendPlan, type PlanLabel, type Role } from "../api";
import { parseExerciseImportFile, type LegacyImportMode } from "../lib/legacyImport";
import { saveRoutines } from "../lib/storage";
import { useAthleteAccess } from "../state/athlete";
import { useExerciseCatalog } from "../state/exerciseCatalog";
import { useAuth } from "../state/auth";
import { usePreferences } from "../state/preferences";
import { useViewMode } from "../state/viewMode";

type Option<T extends string> = {
  label: string;
  value: T;
  hint: string;
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

export default function Settings() {
  const nav = useNavigate();
  const { athleteId, activeSubject } = useAthleteAccess();
  const { prefs, setTheme, setEffortScale, setWeightUnit, setDistanceUnit } = usePreferences();
  const { user, planLabel, isAdmin, refreshMe, logout } = useAuth();
  const { viewMode } = useViewMode();
  const { items, removeItem, importGlobalCatalog, exportGlobalCatalog, refresh } = useExerciseCatalog();
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

    setDangerBusy(true);
    try {
      saveRoutines([], athleteId);
      setDangerInfo(`Rutinas locales eliminadas para ${subjectLabel}.`);
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

    const globalCount = items.filter((item) => item.scope === "global").length;
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
