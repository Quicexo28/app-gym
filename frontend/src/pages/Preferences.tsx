import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { deleteMyAccount } from "../api";
import { loadRoutines, saveRoutines } from "../lib/storage";
import { useAthleteAccess } from "../state/athlete";
import { useAuth } from "../state/auth";
import { useExerciseCatalog } from "../state/exerciseCatalog";
import { usePreferences } from "../state/preferences";
import { useUndo } from "../state/undo";

type Option<T extends string> = {
  label: string;
  value: T;
  hint: string;
};

function OptionRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="optionRow">
      <span className="smallLabel">{label}</span>
      <div className="pillGroup">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`pill ${value === opt.value ? "active" : ""}`}
            onClick={() => onChange(opt.value)}
          >
            <span>{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Preferences() {
  const nav = useNavigate();
  const { athleteId, activeSubject } = useAthleteAccess();
  const { prefs, setTheme, setEffortScale, setWeightUnit, setDistanceUnit } = usePreferences();
  const { logout } = useAuth();
  const { registerUndo } = useUndo();
  const { items, addCustom, removeItem, refresh } = useExerciseCatalog();

  const [dangerBusy, setDangerBusy] = useState(false);
  const [dangerError, setDangerError] = useState("");
  const [dangerInfo, setDangerInfo] = useState("");
  const dangerBtnStyle = { borderColor: "var(--danger)", color: "var(--danger)" } as const;

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
      `Esta acción borra TODAS las rutinas locales del sujeto activo (${subjectLabel}).`,
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
      `Esta acción borra ${customItems.length} ejercicios personalizados.`,
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

  async function deleteAccount() {
    setDangerError("");
    setDangerInfo("");

    const ok = requestDangerConfirmation(
      "Esta acción elimina tu cuenta y tus datos personales asociados.",
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
    <>
      <section className="surface stack compactStack">
        <OptionRow
          label="Tema"
          value={prefs.theme}
          onChange={setTheme}
          options={[
            { label: "Sistema", value: "system", hint: "" },
            { label: "Claro", value: "light", hint: "" },
            { label: "Oscuro", value: "dark", hint: "" },
          ]}
        />
        <OptionRow
          label="Escala de esfuerzo"
          value={prefs.effortScale}
          onChange={setEffortScale}
          options={[
            { label: "RPE", value: "rpe", hint: "" },
            { label: "RIR", value: "rir", hint: "" },
          ]}
        />
        <OptionRow
          label="Unidad de carga"
          value={prefs.weightUnit}
          onChange={setWeightUnit}
          options={[
            { label: "Kilogramos", value: "kg", hint: "" },
            { label: "Libras", value: "lb", hint: "" },
          ]}
        />
        <OptionRow
          label="Unidad de distancia"
          value={prefs.distanceUnit}
          onChange={setDistanceUnit}
          options={[
            { label: "Metros", value: "m", hint: "" },
            { label: "Millas", value: "mi", hint: "" },
          ]}
        />
      </section>

      <details className="surface dangerZone">
        <summary>Zona peligrosa</summary>
        <div className="quickActions" style={{ marginTop: 12 }}>
          <button className="btn" style={dangerBtnStyle} onClick={clearAllRoutines} disabled={dangerBusy}>
            {dangerBusy ? "Procesando..." : "Borrar todas mis rutinas"}
          </button>
          <button className="btn" style={dangerBtnStyle} onClick={clearAllCustomExercises} disabled={dangerBusy}>
            {dangerBusy ? "Procesando..." : "Borrar mis ejercicios personalizados"}
          </button>
          <button className="btn" style={dangerBtnStyle} onClick={deleteAccount} disabled={dangerBusy}>
            {dangerBusy ? "Procesando..." : "Eliminar mi cuenta"}
          </button>
        </div>

        {dangerError ? <div className="message error" style={{ marginTop: 12 }}>{dangerError}</div> : null}
        {dangerInfo ? <div className="message" style={{ marginTop: 12 }}>{dangerInfo}</div> : null}
      </details>
    </>
  );
}
