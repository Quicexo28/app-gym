import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  getAthleteHub,
  getBodyMeasurementsHistory,
  getPlanningAssignment,
  getPlanningAthleteOverview,
  getSessions,
  listCoachReports,
} from "../api";
import type { CoachReportItem, HubSubject, PlanningAssignmentBlock, SessionRecord } from "../api";
import {
  dayKey,
  formatDayLong,
  isoToDayKey,
  parseDayKey,
  planDateToDayKey,
  relativeDayLabel,
} from "../lib/dates";
import { formatSetsRange, ROUTINES_HYDRATED_EVENT, loadRoutines } from "../lib/storage";
import { formatWeight } from "../lib/units";
import { BarChart, ChartPlaceholder, Sparkline } from "../components/Charts";
import type { ChartBar } from "../components/Charts";
import { MacroBar, ProgressRing } from "../components/NutritionCharts";
import Select from "../components/Select";
import Switch from "../components/Switch";
import WeekDayPicker from "../components/WeekDayPicker";
import { useDietToday } from "../lib/nutrition/dietApi";
import { useAthleteAccess, useAthleteId } from "../state/athlete";
import { usePreferences } from "../state/preferences";
import { useViewScopes } from "../state/viewScopes";
import { APP_LOCALE, formatDateTime } from "../lib/locale";

const REPORT_KIND_LABEL: Record<CoachReportItem["kind"], string> = {
  session_completed: "completó una sesión",
  measurement_taken: "tomó medidas",
};

/**
 * El feed del coach mostraba el `athlete_id` interno
 * ("user_d634a035a48b...") cuando el backend no manda nombre. Se resuelve
 * contra la cartera y, si aun asi no hay nombre, se dice "Un atleta".
 */
function reportAuthorLabel(report: CoachReportItem, subjects: HubSubject[]): string {
  if (report.athlete_display_name) return report.athlete_display_name;
  const match = subjects.find((subject) => subject.id === report.athlete_id);
  return match?.label || "Un atleta";
}

function AthleteMiniCard({ subject, onOpen }: { subject: HubSubject; onOpen: () => void }) {
  return (
    <button type="button" className="surface cardButton athleteMiniCard" onClick={onOpen}>
      <div className="sectionHead homeHead">
        <h4>{subject.display_name || subject.label}</h4>
        <div className="hstack compact">
          {subject.is_active_now ? <span className="chip activeNowChip">Entrenando</span> : null}
          {subject.unread_reports_count > 0 ? (
            <span className="chip notifyChip">{subject.unread_reports_count}</span>
          ) : null}
        </div>
      </div>
      <div className="chipRow">
        <span className="chip">{`${subject.sessions_total} sesiones`}</span>
        {subject.last_session_at ? (
          <span className="small">{`Última: ${new Date(subject.last_session_at).toLocaleDateString(APP_LOCALE)}`}</span>
        ) : null}
      </div>
    </button>
  );
}

function CoachPortfolioCard() {
  const nav = useNavigate();
  const { setAthleteId } = useAthleteAccess();
  const [subjects, setSubjects] = useState<HubSubject[]>([]);
  const [reports, setReports] = useState<CoachReportItem[]>([]);
  const [query, setQuery] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      getAthleteHub({ q: query.trim() || undefined, active_only: activeOnly })
        .then((res) => {
          if (cancelled) return;
          setSubjects(res.subjects.filter((subject) => subject.kind === "assigned"));
        })
        .catch(() => {
          if (!cancelled) setSubjects([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [query, activeOnly]);

  useEffect(() => {
    let cancelled = false;
    listCoachReports({ limit: 5 })
      .then((rows) => {
        if (!cancelled) setReports(rows);
      })
      .catch(() => {
        if (!cancelled) setReports([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function openAthlete(subject: HubSubject) {
    setAthleteId(subject.id);
    nav(`/users/${encodeURIComponent(subject.id)}`);
  }

  return (
    <section className="surface coachPortfolioCard">
      <div className="sectionHead homeHead">
        <h3>Usuarios</h3>
        <span className="chip">{subjects.length}</span>
      </div>
      <div className="hstack" style={{ marginTop: 8 }}>
        <input
          className="input"
          placeholder="Buscar atleta..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Switch label="Activos ahora" checked={activeOnly} onChange={setActiveOnly} compact />
      </div>
      <div className="athleteMiniGrid" style={{ marginTop: 12 }}>
        {subjects.length === 0 ? (
          <div className="emptyState">Sin atletas para mostrar.</div>
        ) : (
          subjects.map((subject) => (
            <AthleteMiniCard key={subject.id} subject={subject} onOpen={() => openAthlete(subject)} />
          ))
        )}
      </div>
      {reports.length > 0 ? (
        <div className="coachReportFeed" style={{ marginTop: 12 }}>
          <label className="smallLabel">Actividad reciente</label>
          {reports.map((report) => (
            <div key={report.id} className="reportFeedRow">
              <span className="small">{`${reportAuthorLabel(report, subjects)} ${REPORT_KIND_LABEL[report.kind] || ""}`}</span>
              <span className="smallLabel">{formatDateTime(report.created_at_utc)}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="quickActions" style={{ marginTop: 12 }}>
        <button type="button" className="btn" onClick={() => nav("/users")}>
          Ver todos
        </button>
      </div>
    </section>
  );
}

type PlannedBlock = PlanningAssignmentBlock & {
  assignment_id: string;
  template_name?: string | null;
};

type SnapshotExercise = {
  name: string;
  target_sets_min?: number;
  target_sets_max?: number;
  target_reps_min?: number;
  target_reps_max?: number;
};

type RoutineSnapshot = {
  routineId: string;
  routineName: string;
  exercises: SnapshotExercise[];
};

const MAX_ACTIVE_ASSIGNMENTS = 4;

function formatExerciseName(name: string): string {
  return name.replace(/\s*>\s*/g, " - ").trim();
}

function volumeLoadKg(session: SessionRecord): number {
  let total = 0;
  for (const exercise of session.exercises || []) {
    for (const set of exercise.sets || []) {
      const reps = Number(set.reps);
      const load = Number(set.load_kg);
      if (Number.isFinite(reps) && Number.isFinite(load)) total += reps * load;
    }
  }
  return total;
}

function exerciseVolumeKg(exercise: SessionRecord["exercises"][number]): number {
  let total = 0;
  for (const set of exercise.sets || []) {
    const reps = Number(set.reps);
    const load = Number(set.load_kg);
    if (Number.isFinite(reps) && Number.isFinite(load)) total += reps * load;
  }
  return total;
}

function countSets(session: SessionRecord): number {
  return (session.exercises || []).reduce((acc, exercise) => acc + (exercise.sets || []).length, 0);
}

/** El snapshot guardado por Planning es `{ routine_id, routine_name, exercises[] }`; toleramos también un array suelto. */
function readSnapshot(raw: PlanningAssignmentBlock["routine_snapshot"]): RoutineSnapshot | null {
  if (!raw) return null;

  const rawExercises = Array.isArray(raw) ? raw : (raw as Record<string, unknown>).exercises;
  if (!Array.isArray(rawExercises)) return null;

  const exercises: SnapshotExercise[] = [];
  for (const item of rawExercises) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const name = String(entry.name || "").trim();
    if (!name) continue;
    const legacySets = Number(entry.target_sets) || undefined;
    exercises.push({
      name,
      target_sets_min: Number(entry.target_sets_min) || legacySets || undefined,
      target_sets_max: Number(entry.target_sets_max) || legacySets || undefined,
      target_reps_min: Number(entry.target_reps_min) || undefined,
      target_reps_max: Number(entry.target_reps_max) || undefined,
    });
  }
  if (exercises.length === 0) return null;

  const source = Array.isArray(raw) ? {} : (raw as Record<string, unknown>);
  return {
    routineId: String(source.routine_id || ""),
    routineName: String(source.routine_name || ""),
    exercises,
  };
}

function repsLabel(exercise: SnapshotExercise): string {
  const min = exercise.target_reps_min;
  const max = exercise.target_reps_max;
  if (!min && !max) return "";
  if (min && max && min !== max) return `${min}-${max}`;
  return String(max || min);
}

function setsLabel(exercise: SnapshotExercise): string {
  const min = exercise.target_sets_min;
  const max = exercise.target_sets_max;
  if (!min && !max) return "";
  return formatSetsRange(min || max || 0, max || min || 0);
}

export default function Home() {
  const [athleteId] = useAthleteId();
  const { prefs } = usePreferences();
  const { coachView } = useViewScopes();
  const nav = useNavigate();

  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [plannedBlocks, setPlannedBlocks] = useState<PlannedBlock[]>([]);
  const [weights, setWeights] = useState<number[]>([]);
  const [routinesVersion, setRoutinesVersion] = useState(0);
  const [error, setError] = useState("");
  const [pickedRoutineId, setPickedRoutineId] = useState("");

  const todayKey = useMemo(() => dayKey(new Date()), []);
  const [selectedKey, setSelectedKey] = useState(todayKey);

  // La dieta del card en Home sigue al mismo día elegido en el selector semanal (doc `modulo-dieta.md` #6.4).
  const { targets: dietTargets, totals: dietTotals } = useDietToday(athleteId, selectedKey);

  // Las rutinas viven en almacenamiento local; AppShell las hidrata desde backend al arrancar.
  useEffect(() => {
    const bump = () => setRoutinesVersion((versión) => versión + 1);
    window.addEventListener(ROUTINES_HYDRATED_EVENT, bump);
    return () => window.removeEventListener(ROUTINES_HYDRATED_EVENT, bump);
  }, []);

  const routines = useMemo(
    () => (athleteId ? loadRoutines(athleteId) : []),
    // routinesVersion no se usa dentro: es el disparador para releer el storage tras la hidratación.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [athleteId, routinesVersion],
  );

  useEffect(() => {
    if (!athleteId) return;

    let cancelled = false;

    getSessions(athleteId)
      .then((rows) => {
        if (cancelled) return;
        setSessions(rows);
        setError("");
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setSessions([]);
        setError(String((cause as { message?: string })?.message || cause));
      });

    // La planificación es opcional: si falla no debe tumbar el resto de la vista.
    getPlanningAthleteOverview(athleteId)
      .then(async (overview) => {
        const active = (overview.active_assignments || []).slice(0, MAX_ACTIVE_ASSIGNMENTS);
        const details = await Promise.all(
          active.map((assignment) => getPlanningAssignment(assignment.id).catch(() => null)),
        );
        if (cancelled) return;
        const rows: PlannedBlock[] = [];
        for (const detail of details) {
          if (!detail) continue;
          for (const block of detail.blocks || []) {
            rows.push({ ...block, assignment_id: detail.id, template_name: detail.template_name });
          }
        }
        setPlannedBlocks(rows);
      })
      .catch(() => {
        if (cancelled) return;
        setPlannedBlocks([]);
      });

    // Peso: solo la tendencia, el detalle vive en Progreso.
    getBodyMeasurementsHistory(athleteId, 60)
      .then((history) => {
        if (cancelled) return;
        const rows = (history.items || [])
          .filter((item) => Number.isFinite(Number(item.weight_kg)))
          .map((item) => ({ at: String(item.measured_at), kg: Number(item.weight_kg) }))
          .sort((a, b) => a.at.localeCompare(b.at));
        setWeights(rows.slice(-14).map((row) => row.kg));
      })
      .catch(() => {
        if (cancelled) return;
        setWeights([]);
      });

    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  const sessionsByDay = useMemo(() => {
    const map = new Map<string, SessionRecord[]>();
    if (!athleteId) return map;
    for (const session of sessions) {
      const key = isoToDayKey(String(session.start_time));
      if (!key) continue;
      const bucket = map.get(key);
      if (bucket) bucket.push(session);
      else map.set(key, [session]);
    }
    return map;
  }, [athleteId, sessions]);

  const blocksByDay = useMemo(() => {
    const map = new Map<string, PlannedBlock[]>();
    if (!athleteId) return map;
    for (const block of plannedBlocks) {
      const key = planDateToDayKey(block.target_date);
      if (!key) continue;
      const bucket = map.get(key);
      if (bucket) bucket.push(block);
      else map.set(key, [block]);
    }
    return map;
  }, [athleteId, plannedBlocks]);

  const selectedDate = useMemo(() => parseDayKey(selectedKey), [selectedKey]);

  const daySessions = sessionsByDay.get(selectedKey) ?? [];
  const dayBlocks = blocksByDay.get(selectedKey) ?? [];
  const daySession = daySessions[0] ?? null;
  const dayBlock = dayBlocks[0] ?? null;
  const daySnapshot = dayBlock ? readSnapshot(dayBlock.routine_snapshot) : null;
  const isFuture = selectedKey > todayKey;
  const relativeLabel = relativeDayLabel(selectedKey, todayKey);

  const sortedRoutines = useMemo(
    () => [...routines].sort((a, b) => a.name.localeCompare(b.name)),
    [routines],
  );

  const dayMarks = useCallback(
    (key: string) => ({
      done: (sessionsByDay.get(key)?.length ?? 0) > 0,
      planned: (blocksByDay.get(key)?.length ?? 0) > 0,
    }),
    [blocksByDay, sessionsByDay],
  );

  function openRegister(routineId?: string) {
    const params = new URLSearchParams({ date: selectedKey });
    if (routineId) params.set("routine", routineId);
    nav(`/session/new?${params.toString()}`);
  }

  const trainingBars = useMemo<ChartBar[]>(() => {
    if (daySession) {
      return (daySession.exercises || [])
        .map((exercise) => {
          const volume = exerciseVolumeKg(exercise);
          return {
            label: formatExerciseName(exercise.name),
            value: Math.round(volume),
            valueLabel: formatWeight(volume, prefs.weightUnit),
          };
        })
        .sort((a, b) => b.value - a.value)
        .slice(0, 6);
    }
    if (daySnapshot) {
      return daySnapshot.exercises
        .map((exercise) => {
          const setsForChart = Math.max(0, Math.round(exercise.target_sets_max || exercise.target_sets_min || 0));
          return {
            label: formatExerciseName(exercise.name),
            value: setsForChart,
            valueLabel: `${setsLabel(exercise)}x${repsLabel(exercise)}`,
          };
        })
        .slice(0, 6);
    }
    return [];
  }, [daySession, daySnapshot, prefs.weightUnit]);

  const lastWeight = weights.length > 0 ? weights[weights.length - 1] : null;
  const trainingChartTitle = daySession ? "Volumen por ejercicio" : "Series objetivo";
  const dayVolume = daySession ? volumeLoadKg(daySession) : 0;

  const dietEnergyTarget = dietTargets?.energy_kcal || 0;
  const dietEnergyValue = dietTotals?.energy_kcal || 0;
  const dietEnergyPct = dietEnergyTarget > 0 ? (dietEnergyValue / dietEnergyTarget) * 100 : 0;

  return (
    <div className="container stack">
      <header className="homeHeader">
        <div className="homeDate">
          <span className="homeDateDay">{formatDayLong(selectedDate)}</span>
          <span className="homeDateMeta small">
            {relativeLabel ? `${relativeLabel} - ` : ""}
            {selectedDate.getFullYear()}
          </span>
        </div>

      </header>

      {coachView ? <CoachPortfolioCard /> : null}

      <WeekDayPicker selectedKey={selectedKey} todayKey={todayKey} onSelect={setSelectedKey} getMarks={dayMarks} />

      {error ? <section className="message error">{error}</section> : null}

      {!coachView ? (
        <section className="surface trainCard">
          <div className="sectionHead homeHead">
            <h3>Entreno</h3>
            {daySession ? (
              <span className="chip">Registrado</span>
            ) : dayBlock ? (
              <span className="chip">Planeado</span>
            ) : null}
          </div>

          {daySession ? (
            <div className="stack compactStack" style={{ marginTop: 12 }}>
              <div className="chipRow">
                <span className="chip">{`${(daySession.exercises || []).length} ejercicios`}</span>
                <span className="chip">{`${countSets(daySession)} series`}</span>
                <span className="chip">{formatWeight(dayVolume, prefs.weightUnit)}</span>
                <span className="chip">{`${daySession.duration_min ?? "-"} min`}</span>
                {daySession.rpe ? <span className="chip">{`RPE ${daySession.rpe}`}</span> : null}
              </div>
              <div className="small">
                {(daySession.exercises || []).map((exercise) => formatExerciseName(exercise.name)).join(" - ") ||
                  "Sin ejercicios"}
              </div>
              {daySessions.length > 1 ? <span className="chip">{`+${daySessions.length - 1}`}</span> : null}
              <div className="quickActions">
                <button className="btn" onClick={() => openRegister()} disabled={!athleteId}>
                  Registrar otra
                </button>
              </div>
            </div>
          ) : dayBlock ? (
            <div className="stack compactStack" style={{ marginTop: 12 }}>
              <strong>{dayBlock.title || "Sesión programada"}</strong>
              <div className="chipRow">
                {dayBlock.template_name ? <span className="chip">{dayBlock.template_name}</span> : null}
                {daySnapshot?.routineName ? <span className="chip">{daySnapshot.routineName}</span> : null}
                {daySnapshot ? <span className="chip">{`${daySnapshot.exercises.length} ejercicios`}</span> : null}
              </div>
              {dayBlock.objective ? <div className="small">{dayBlock.objective}</div> : null}
              {daySnapshot ? (
                <ul className="planList">
                  {daySnapshot.exercises.slice(0, 6).map((exercise, idx) => (
                    <li key={`${exercise.name}-${idx}`}>
                      <span>{formatExerciseName(exercise.name)}</span>
                      <span className="small">
                        {setsLabel(exercise) ? `${setsLabel(exercise)}x` : ""}
                        {repsLabel(exercise)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="quickActions">
                <button
                  className="btn primary btnBlock"
                  onClick={() => openRegister(daySnapshot?.routineId || undefined)}
                  disabled={!athleteId}
                >
                  {isFuture ? "Adelantar entreno" : "Registrar entreno"}
                </button>
                <button className="btn" onClick={() => nav("/training/plan")}>
                  Ver programación
                </button>
              </div>
            </div>
          ) : (
            <div className="stack compactStack" style={{ marginTop: 12 }}>
              {sortedRoutines.length > 0 ? (
                <div className="pickRoutineRow">
                  <Select
                    ariaLabel="Rutina"
                    value={pickedRoutineId}
                    onChange={setPickedRoutineId}
                    options={[
                      { value: "", label: "Elegir rutina..." },
                      ...sortedRoutines.map((routine) => ({ value: routine.id, label: routine.name })),
                    ]}
                  />
                  <button
                    className="btn primary"
                    onClick={() => openRegister(pickedRoutineId || undefined)}
                    disabled={!athleteId}
                  >
                    Registrar
                  </button>
                </div>
              ) : (
                <div className="quickActions">
                  <button className="btn primary" onClick={() => nav("/training")}>
                    Crear rutina
                  </button>
                </div>
              )}
              <div className="quickActions">
                <button className="btn btnSlim" onClick={() => nav("/training/plan")}>
                  Programar semana
                </button>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {!coachView ? (
        <button
          type="button"
          className="surface cardButton dietCard"
          onClick={() => nav(`/diet?day=${encodeURIComponent(selectedKey)}`)}
        >
          <div className="sectionHead homeHead">
            <h3>Dieta</h3>
            <span className="cardChevron" aria-hidden="true">
              ›
            </span>
          </div>

          <div className="dietBody">
            <ProgressRing pct={dietEnergyPct} center={dietEnergyValue > 0 ? String(Math.round(dietEnergyValue)) : "—"} caption="kcal" />
            <div className="macroStack">
              <MacroBar label="Proteína" value={dietTotals?.protein_g || 0} target={dietTargets?.protein_g || 0} unit="g" />
              <MacroBar label="Carbos" value={dietTotals?.carbs_g || 0} target={dietTargets?.carbs_g || 0} unit="g" />
              <MacroBar label="Grasas" value={dietTotals?.fat_g || 0} target={dietTargets?.fat_g || 0} unit="g" />
            </div>
          </div>
        </button>
      ) : null}

      {!coachView ? (
        <section className="surface">
          <div className="sectionHead homeHead">
            <h3>Sesión del día</h3>
            <span className="chip">{trainingChartTitle}</span>
          </div>
          <div style={{ marginTop: 12 }}>
            <BarChart bars={trainingBars} />
          </div>
        </section>
      ) : null}

      {!coachView ? (
        <div className="homeSplit">
          <button type="button" className="surface cardButton stepsCard" onClick={() => nav("/steps")}>
            <div className="sectionHead homeHead">
              <h3>Pasos</h3>
              <div className="hstack compact">
                <span className="mutedValue">—</span>
                <span className="cardChevron" aria-hidden="true">
                  ›
                </span>
              </div>
            </div>
            <ChartPlaceholder variant="bars" height={56} caption={null} />
          </button>

          <button type="button" className="surface cardButton weightCard" onClick={() => nav("/profile/progress")}>
            <div className="sectionHead homeHead">
              <h3>Peso</h3>
              <div className="hstack compact">
                <span className={lastWeight === null ? "mutedValue" : "cardValue"}>
                  {lastWeight === null ? "—" : formatWeight(lastWeight, prefs.weightUnit)}
                </span>
                <span className="cardChevron" aria-hidden="true">
                  ›
                </span>
              </div>
            </div>
            <Sparkline values={weights} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
