import { type JsonObject, http } from "./core";
import { type PlanningReconcileSummary } from "./planning";

export type SessionSet = {
  reps: number;
  load_kg: number;
};

export type SessionExercise = {
  name: string;
  sets: SessionSet[];
};

export type SessionRecord = {
  athlete_id: string;
  start_time: string;
  duration_min: number;
  rpe: number;
  modality?: string;
  exercises: SessionExercise[];
  source?: string;
  meta?: JsonObject;
};

/** Serie guardada. Los campos extra (rir, rpe, calentamiento) se conservan al editar. */
export type HistorySet = { reps: number; load_kg: number } & JsonObject;

export type HistoryExercise = { name: string; sets: HistorySet[] } & JsonObject;

/** Sesión hecha, con id para poder editarla o borrarla. */
export type SessionHistoryItem = {
  id: string;
  athlete_id: string;
  start_time: string;
  duration_min: number;
  rpe: number | null;
  modality: string | null;
  source: string | null;
  routine_name: string | null;
  note: string | null;
  volume_load_kg: number | null;
  sets_total: number | null;
  reps_total: number | null;
  exercises: HistoryExercise[];
  meta: JsonObject;
};

export type SessionUpdatePayload = {
  duration_min?: number;
  rpe?: number | null;
  note?: string | null;
  exercises?: HistoryExercise[];
};

export type IngestResult = {
  inserted: number;
  duplicates: number;
  results: Array<{
    inserted: boolean;
    issues: unknown[];
    session_key: [string, string];
  }>;
  planning_reconcile?: Record<string, PlanningReconcileSummary[]>;
};

export type RunSummaryInfo = {
  top_scenario?: string;
  top_probability?: number;
} & JsonObject;

export type RunCreateResponse = {
  run_id: string;
  summary: RunSummaryInfo;
};

export type RunListItem = {
  run_id: string;
  generated_at_utc: string;
  engine_version: string;
  metric_key: string;
  used_normalized: boolean;
  summary: RunSummaryInfo;
};

export type RunScenario = {
  name: string;
  probability: number;
  confidence: number;
  title: string;
  tradeoffs: string[];
  levers: JsonObject;
};

/** Estado descriptivo de un ejercicio: hechos, sin modelo. */
export type ExerciseState = {
  name: string;
  sessions: number;
  last_top_load_kg: number;
  best_top_load_kg: number;
  e1rm_kg: number;
  best_e1rm_kg: number;
  last_session_at: string;
  days_since_last: number;
  sets_last_4w: number;
};

/** Evento detectado, con la regla que lo detecto (auditable por el atleta). */
export type TrainingEvent = {
  kind: "personal_record" | "stall" | "dropped_exercise" | "volume_drop";
  exercise: string | null;
  at: string;
  detail: string;
  rule: string;
};

/**
 * Proxima serie tope. El valor puntual es el ultimo tope: ningun modelo ajustado
 * le gano en los backtests (6.14 kg de error contra 6.44 kg del mejor). Lo que
 * aporta el motor es el intervalo, medido con 92.8% de cobertura real.
 */
export type NextSetPrediction = {
  exercise: string;
  point_kg: number;
  low_kg: number;
  high_kg: number;
  coverage: number;
  basis_sessions: number;
  method: string;
};

/**
 * Lo que dicen los datos, no lo que hay que hacer. La app no prescribe: nombra
 * lo que ve y deja la decision al entrenador (o al atleta con su criterio).
 * `reference_load_kg` es contexto para quien programa, no una orden de carga, y
 * por eso solo se muestra en la vista de coach.
 */
export type TrainingSignal = {
  kind:
    | "progression_margin"
    | "effort_at_limit"
    | "plan_shortfall"
    | "fatigue_rising"
    | "deload_suggested"
    | "low_adherence";
  exercise: string;
  reading: string;
  evidence: string;
  rule: string;
  reference_load_kg: number | null;
};

/**
 * Lo que cabe esperar si el atleta sostiene lo que viene haciendo. Sale de
 * extrapolar su propia tendencia, no de un modelo poblacional, y es condicional
 * a la adherencia observada. Siempre con intervalo.
 */
export type Projection = {
  scope: string; // "global" o el nombre del ejercicio
  horizon_weeks: number;
  current_kg: number | null;
  expected_change_kg: number | null;
  low_change_kg: number | null;
  high_change_kg: number | null;
  expected_change_pct: number;
  low_change_pct: number | null;
  high_change_pct: number | null;
  adherence: number | null;
  basis_sessions: number;
  method: string;
};

export type AthleteInsights = {
  athlete_id: string;
  generated_at: string;
  exercises: ExerciseState[];
  events: TrainingEvent[];
  predictions: NextSetPrediction[];
  signals: TrainingSignal[];
  projections: Projection[];
  abstained: string[];
  weekly_sets_by_group: Record<string, number>;
  sessions_last_4w: number;
};

export type PredictionTrackRecord = {
  resueltas: number;
  senales_resueltas?: number;
  senales_que_coincidieron?: number | null;
  mae_kg?: number | null;
  cobertura_intervalo?: number | null;
  cobertura_objetivo?: number | null;
};

export type RunSummaryResponse = {
  run_id: string;
  athlete_id: string;
  generated_at_utc: string;
  metric_key: string;
  top3_scenarios: RunScenario[];
  last_latents: Record<string, number | null>;
  confidence_last: number | null;
  issues_by_code: Record<string, number>;
  summary: JsonObject;
  insights?: AthleteInsights | null;
  prediction_track_record?: PredictionTrackRecord | null;
};

export function ingestSessions(payload: unknown): Promise<IngestResult> {
  return http("/api/v1/sessions/batch", { method: "POST", body: JSON.stringify(payload) });
}

export function getSessions(athleteId: string): Promise<SessionRecord[]> {
  return http(`/api/v1/sessions/${encodeURIComponent(athleteId)}`);
}

export function createRun(athleteId: string, metricKey = "volume_load_kg", useNormalized = true): Promise<RunCreateResponse> {
  const qs = new URLSearchParams({
    metric_key: metricKey,
    use_normalized: String(useNormalized),
  });
  return http(`/api/v1/runs/${encodeURIComponent(athleteId)}?${qs.toString()}`, { method: "POST" });
}

export function listRuns(athleteId: string, limit = 20): Promise<RunListItem[]> {
  const qs = new URLSearchParams({ athlete_id: athleteId, limit: String(limit) });
  return http(`/api/v1/runs?${qs.toString()}`);
}

export function getRunSummary(runId: string): Promise<RunSummaryResponse> {
  return http(`/api/v1/runs/${encodeURIComponent(runId)}/summary`);
}

export function sendSessionHeartbeat(payload: {
  athlete_id: string;
  routine_id?: string | null;
  routine_name?: string | null;
}): Promise<{ ok: boolean }> {
  return http("/api/v1/me/session-heartbeat", { method: "POST", body: JSON.stringify(payload) });
}

export function getSessionHistory(athleteId: string): Promise<SessionHistoryItem[]> {
  return http(`/api/v1/sessions/${encodeURIComponent(athleteId)}/history`);
}

export function updateSession(sessionId: string, payload: SessionUpdatePayload): Promise<SessionHistoryItem> {
  return http(`/api/v1/sessions/item/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteSession(sessionId: string): Promise<{ deleted: boolean }> {
  return http(`/api/v1/sessions/item/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
}
