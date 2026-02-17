import { useEffect, useState } from "react";

import { adminSwitchPlan, labelToBackendPlan, type PlanLabel, type Role } from "../api";
import { importLegacyExercises, type LegacyImportMode } from "../lib/legacyImport";
import { loadExerciseCatalog, saveExerciseCatalog } from "../lib/storage";
import { useAuth } from "../state/auth";
import { usePreferences } from "../state/preferences";

type Option<T extends string> = {
  label: string;
  value: T;
  hint: string;
};

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
  const { prefs, setTheme, setEffortScale, setWeightUnit, setDistanceUnit } = usePreferences();
  const { user, planLabel, isAdmin, refreshMe } = useAuth();

  const [switchEmail, setSwitchEmail] = useState("");
  const [switchPlan, setSwitchPlan] = useState<PlanLabel>("standard");
  const [switchRole, setSwitchRole] = useState<"" | Role>("");
  const [switchMsg, setSwitchMsg] = useState("");
  const [switchBusy, setSwitchBusy] = useState(false);

  const [importMode, setImportMode] = useState<LegacyImportMode>("merge");
  const [importMsg, setImportMsg] = useState("");

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

  function importLegacyFile(file: File | null) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = String(reader.result || "");
        const existing = loadExerciseCatalog();
        const report = importLegacyExercises(raw, existing, importMode);
        saveExerciseCatalog(report.items);

        setImportMsg(
          `Import completo: +${report.imported} nuevos, ${report.updated} actualizados, ${report.skippedAsDuplicate} duplicados omitidos. Total catalogo: ${report.items.length}.`,
        );
      } catch (e: unknown) {
        setImportMsg(String((e as { message?: string })?.message || e));
      }
    };
    reader.onerror = () => setImportMsg("No se pudo leer el archivo.");
    reader.readAsText(file);
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

      {isAdmin ? (
        <>
          <section className="surface">
            <div className="sectionHead">
              <h3>Admin: importar catalogo de ejercicios</h3>
              <p>Importa JSON legacy (ej: exercises_backup_2025-11-15.json) al catalogo local.</p>
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
              <label className="btn" style={{ cursor: "pointer" }}>
                Seleccionar JSON
                <input
                  type="file"
                  accept="application/json,.json"
                  style={{ display: "none" }}
                  onChange={(e) => importLegacyFile(e.target.files?.[0] || null)}
                />
              </label>
            </div>

            {importMsg ? <div className="message" style={{ marginTop: 12 }}>{importMsg}</div> : null}
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
          <div className="small">Las funciones admin (import legacy + cambio de plan) solo aparecen con rol admin.</div>
        </section>
      )}
    </div>
  );
}

