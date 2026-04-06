import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { createRun, getSessions, listRuns } from "../api";
import type { RunListItem } from "../api";
import type { SessionRecord } from "../api";
import { formatWeight } from "../lib/units";
import { useAthleteAccess, useAthleteId } from "../state/athlete";
import { usePreferences } from "../state/preferences";

function formatExerciseNameForList(name: string): string {
  return name.replace(/\s*>\s*/g, " - ").trim();
}

function volumeLoadKg(session: SessionRecord): number {
  const ex = session.exercises || [];
  let total = 0;
  for (const e of ex) {
    for (const s of e.sets || []) {
      const reps = Number(s.reps);
      const load = Number(s.load_kg);
      if (Number.isFinite(reps) && Number.isFinite(load)) total += reps * load;
    }
  }
  return total;
}

export default function History() {
  const { subjects, canSwitch, ready: athleteReady, activeSubject } = useAthleteAccess();
  const [athleteId] = useAthleteId();
  const { prefs } = usePreferences();
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [periodDays, setPeriodDays] = useState<7 | 30 | 90>(30);
  const nav = useNavigate();

  useEffect(() => {
    if (!athleteId) {
      setSessions([]);
      setRuns([]);
      return;
    }

    getSessions(athleteId)
      .then(setSessions)
      .catch(() => setSessions([]));
    listRuns(athleteId, 20)
      .then(setRuns)
      .catch(() => setRuns([]));
  }, [athleteId]);

  const sessionsSorted = useMemo(
    () => [...sessions].sort((a, b) => String(b.start_time).localeCompare(String(a.start_time))),
    [sessions],
  );

  const filteredSessions = useMemo(() => {
    const nowMs = Date.now();
    const windowMs = periodDays * 24 * 60 * 60 * 1000;
    return sessionsSorted.filter((session) => {
      const startMs = Date.parse(String(session.start_time || ""));
      if (!Number.isFinite(startMs)) return false;
      return nowMs - startMs <= windowMs;
    });
  }, [sessionsSorted, periodDays]);

  const periodVolumeKg = useMemo(
    () => filteredSessions.reduce((acc, session) => acc + volumeLoadKg(session), 0),
    [filteredSessions],
  );

  const periodAvgRpe = useMemo(() => {
    const values = filteredSessions
      .map((item) => Number(item.rpe))
      .filter((value) => Number.isFinite(value) && value >= 0);
    if (values.length === 0) return null;
    return Number((values.reduce((acc, value) => acc + value, 0) / values.length).toFixed(2));
  }, [filteredSessions]);

  async function runNow() {
    if (!athleteId) return;

    setBusy(true);
    try {
      const res = await createRun(athleteId, "volume_load_kg", true);
      nav(`/run/${encodeURIComponent(res.run_id)}`);
    } catch (e: unknown) {
      alert(String((e as { message?: string })?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Historial</h1>
        <p>Vista ordenada de sesiones y runs para el atleta activo.</p>
      </header>

      <section className="surface">
        <div className="sectionHead">
          <h3>Resumen</h3>
          <p>Contexto actual y accesos rapidos.</p>
        </div>
        <div className="statsGrid" style={{ marginTop: 10 }}>
          <article className="statCard">
            <div className="smallLabel">Sujeto</div>
            <strong>{activeSubject?.label || "Sin asignar"}</strong>
          </article>
          <article className="statCard">
            <div className="smallLabel">Sesiones ({periodDays}d)</div>
            <strong>{filteredSessions.length}</strong>
          </article>
          <article className="statCard">
            <div className="smallLabel">Volumen ({periodDays}d)</div>
            <strong>{formatWeight(periodVolumeKg, prefs.weightUnit)}</strong>
          </article>
          <article className="statCard">
            <div className="smallLabel">{`RPE promedio (${periodDays}d)`}</div>
            <strong>{periodAvgRpe ?? "-"}</strong>
          </article>
          <article className="statCard">
            <div className="smallLabel">Runs totales</div>
            <strong>{runs.length}</strong>
          </article>
        </div>

        <div className="quickActions" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={() => nav("/session/new")} disabled={!athleteId}>
            Nueva sesion
          </button>
          <button className="btn" onClick={runNow} disabled={busy || !athleteId}>
            {busy ? "Corriendo..." : "Correr escenarios"}
          </button>
        </div>

        <div className="chipRow" style={{ marginTop: 10 }}>
          {[7, 30, 90].map((days) => (
            <button
              key={days}
              type="button"
              className={`chipButton ${periodDays === days ? "activeChipButton" : ""}`}
              onClick={() => setPeriodDays(days as 7 | 30 | 90)}
            >
              {`${days} dias`}
            </button>
          ))}
        </div>

        {canSwitch && athleteReady && subjects.filter((subject) => subject.kind === "assigned").length === 0 ? (
          <div className="message error" style={{ marginTop: 12 }}>
            No tienes usuarios asignados. Sigues teniendo acceso completo a tus propios entrenos.
          </div>
        ) : null}
      </section>

      <section className="surface">
        <div className="sectionHead">
          <h3>Sesiones recientes</h3>
          <p>{`Sesiones de los ultimos ${periodDays} dias, ordenadas por fecha.`}</p>
        </div>

        {filteredSessions.length === 0 ? (
          <div className="emptyState">Sin sesiones en este periodo.</div>
        ) : (
          <div className="stack compactStack" style={{ marginTop: 10 }}>
            {filteredSessions.slice(0, 30).map((s, idx) => {
              const volKg = volumeLoadKg(s);
              const exercises = (s.exercises || [])
                .map((e) => formatExerciseNameForList(e.name))
                .filter(Boolean)
                .join(" - ");

              return (
                <article key={idx} className="listItem">
                  <div className="listMain">
                    <strong>{s.start_time ? new Date(s.start_time).toLocaleString() : "Sin fecha"}</strong>
                    <span className="small">{`Duracion: ${s.duration_min ?? "-"} min`}</span>
                    <span className="small">{`${prefs.effortScale.toUpperCase()}: ${s.rpe ?? "-"}`}</span>
                  </div>
                  <div className="listMeta">
                    <span className="small">{`Volumen: ${formatWeight(volKg, prefs.weightUnit)}`}</span>
                    <span className="small">{exercises || "Sin ejercicios"}</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="surface">
        <div className="sectionHead">
          <h3>Runs recientes</h3>
          <p>Acceso directo a resultados de escenarios.</p>
        </div>

        {runs.length === 0 ? (
          <div className="emptyState">Sin runs todavia.</div>
        ) : (
          <div className="gridCards" style={{ marginTop: 10 }}>
            {runs.slice(0, 12).map((r) => (
              <button
                key={r.run_id}
                className="surfaceButton"
                onClick={() => nav(`/run/${encodeURIComponent(r.run_id)}`)}
              >
                <strong>{r.summary?.top_scenario || "Run"}</strong>
                <span className="small">{new Date(r.generated_at_utc).toLocaleString()}</span>
                <span className="small">
                  {`Prob top: ${
                    typeof r.summary?.top_probability === "number" ? `${Math.round(r.summary.top_probability * 100)}%` : "-"
                  }`}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
