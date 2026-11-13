import { type JsonObject, http } from "./core";
import { type ProgressSnapshotMetric } from "./profile";

// Mismos 15 grupos y orden que coach_ai.training_core.muscle_groups (backend) -
// deben coincidir literalmente: son los valores validos de AthletePlan.priority_muscle_groups.
export const MUSCLE_GROUPS = [
  "Hombros",
  "Biceps",
  "Triceps",
  "Pecho",
  "Dorsales",
  "Espalda Alta",
  "Trapecio",
  "Lumbares",
  "Abdomen",
  "Gluteos",
  "Abductores",
  "Aductores",
  "Cuadriceps",
  "Femorales",
  "Pantorrillas",
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

// Los valores de arriba viajan al backend sin tildes (son claves validadas alla).
// En pantalla se muestran bien escritos.
const MUSCLE_GROUP_LABELS: Record<string, string> = {
  Biceps: "Bíceps",
  Triceps: "Tríceps",
  Gluteos: "Glúteos",
  Cuadriceps: "Cuádriceps",
};

export function muscleGroupLabel(group: string): string {
  return MUSCLE_GROUP_LABELS[group] || group;
}

export type HubSubject = {
  id: string;
  label: string;
  display_name?: string | null;
  kind: "self" | "assigned";
  sessions_total: number;
  runs_total: number;
  last_session_at?: string | null;
  last_run_at?: string | null;
  is_active_now: boolean;
  unread_reports_count: number;
};

export type AthleteHubResponse = {
  active_subject_id: string;
  subjects: HubSubject[];
};

export function getAthleteHub(params?: { q?: string; active_only?: boolean }): Promise<AthleteHubResponse> {
  const qs = new URLSearchParams();
  if (params?.q) qs.set("q", params.q);
  if (params?.active_only) qs.set("active_only", "true");
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return http(`/api/v1/athletes/hub${suffix}`);
}

export type CoachAthlete = {
  athlete_id: string;
  display_name?: string | null;
  notes?: string | null;
  priority_muscle_groups: string[];
};

export function createCoachAthlete(payload: {
  display_name: string;
  notes?: string | null;
  priority_muscle_groups?: string[];
}): Promise<CoachAthlete> {
  return http("/api/v1/coach/athletes", { method: "POST", body: JSON.stringify(payload) });
}

export function updateCoachAthlete(
  athleteId: string,
  payload: { display_name?: string; notes?: string | null; priority_muscle_groups?: string[] },
): Promise<CoachAthlete> {
  return http(`/api/v1/coach/athletes/${encodeURIComponent(athleteId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function removeCoachAthlete(athleteId: string): Promise<{ ok: boolean }> {
  return http(`/api/v1/coach/athletes/${encodeURIComponent(athleteId)}`, { method: "DELETE" });
}

export function markAthleteSeen(athleteId: string): Promise<{ ok: boolean }> {
  return http(`/api/v1/coach/athletes/${encodeURIComponent(athleteId)}/seen`, { method: "POST" });
}

export type CoachCapacity = {
  used: number;
  included: number;
  extra: number;
  total: number;
};

export type CoachInvite = {
  invite_code: string;
  invite_enabled: boolean;
  capacity: CoachCapacity;
};

export function getCoachInvite(): Promise<CoachInvite> {
  return http("/api/v1/coach/invite");
}

export function rotateCoachInvite(): Promise<CoachInvite> {
  return http("/api/v1/coach/invite/rotate", { method: "POST" });
}

export function setCoachInviteEnabled(enabled: boolean): Promise<CoachInvite> {
  return http("/api/v1/coach/invite", {
    method: "PATCH",
    body: JSON.stringify({ invite_enabled: enabled }),
  });
}

export function joinCoachByCode(code: string): Promise<{ ok: boolean; coach_user_id: string; coach_label: string }> {
  return http("/api/v1/coach/join", { method: "POST", body: JSON.stringify({ code }) });
}

export function leaveCoach(): Promise<{ ok: boolean; removed: number }> {
  return http("/api/v1/coach/leave", { method: "DELETE" });
}

export type CoachBillingStatus = "none" | "active" | "past_due" | "canceled";

export type CoachBilling = {
  status: CoachBillingStatus;
  has_subscription: boolean;
  capacity: CoachCapacity;
};

export function getCoachBilling(): Promise<CoachBilling> {
  return http("/api/v1/coach/billing");
}

export function subscribeCoachPlan(): Promise<{ checkout_url: string }> {
  return http("/api/v1/coach/billing/subscribe", { method: "POST" });
}

export function adjustCoachSeats(delta: 1 | -1): Promise<CoachBilling> {
  return http("/api/v1/coach/billing/seats", { method: "POST", body: JSON.stringify({ delta }) });
}

export function openCoachBillingPortal(): Promise<{ portal_url: string }> {
  return http("/api/v1/coach/billing/portal");
}

export type TrendDirection = "up" | "down" | "stable" | "insufficient" | "volatile";

export type MuscleSeriesPoint = { t: string; volume_kg: number };

export type MuscleGroupState = {
  group: string;
  trend_direction: TrendDirection;
  plateau_p: number | null;
  confidence: number;
  recent_series: MuscleSeriesPoint[];
  exercises_involved: string[];
};

export type MuscleInsightsResponse = {
  athlete_id: string;
  priority_muscle_groups: string[];
  states: MuscleGroupState[];
  weakest_group: string | null;
};

export function getAthleteMuscleInsights(athleteId: string): Promise<MuscleInsightsResponse> {
  return http(`/api/v1/coach/athletes/${encodeURIComponent(athleteId)}/muscle-insights`);
}

export type CoachNoteScope = "routine_exercise" | "programming";

export type CoachNote = {
  id: string;
  athlete_id: string;
  author_user_id: string;
  scope_type: CoachNoteScope;
  routine_id?: string | null;
  exercise_name_normalized?: string | null;
  assignment_id?: string | null;
  body: string;
  created_at_utc: string;
  read_at_utc?: string | null;
};

export function createCoachNote(payload: {
  athlete_id: string;
  scope_type: CoachNoteScope;
  routine_id?: string;
  exercise_name?: string;
  assignment_id?: string;
  body: string;
}): Promise<CoachNote> {
  return http("/api/v1/coach/notes", { method: "POST", body: JSON.stringify(payload) });
}

export function listCoachNotes(params: {
  athlete_id: string;
  routine_id?: string;
  exercise_name?: string;
}): Promise<CoachNote[]> {
  const qs = new URLSearchParams({ athlete_id: params.athlete_id });
  if (params.routine_id) qs.set("routine_id", params.routine_id);
  if (params.exercise_name) qs.set("exercise_name", params.exercise_name);
  return http(`/api/v1/coach/notes?${qs.toString()}`);
}

export function markCoachNoteRead(noteId: string): Promise<CoachNote> {
  return http(`/api/v1/coach/notes/${encodeURIComponent(noteId)}/read`, { method: "PATCH" });
}

export type RoutineUsageAthlete = { athlete_id: string; routine_id: string; routine_name: string };

export type RoutineUsageResponse = { template_key: string; athletes: RoutineUsageAthlete[] };

export function getRoutineTemplateUsage(templateKey: string): Promise<RoutineUsageResponse> {
  return http(`/api/v1/coach/routines/${encodeURIComponent(templateKey)}/usage`);
}

export type ExerciseUsageEntry = {
  athlete_id: string;
  routine_id: string;
  routine_name: string;
  target_sets_min?: number | null;
  target_sets_max?: number | null;
  target_reps_min?: number | null;
  target_reps_max?: number | null;
};

export type ExerciseUsageResponse = { exercise_name_normalized: string; entries: ExerciseUsageEntry[] };

export function getExerciseUsage(exerciseName: string): Promise<ExerciseUsageResponse> {
  return http(`/api/v1/coach/exercises/${encodeURIComponent(exerciseName)}/usage`);
}

export type CoachReportKind = "session_completed" | "measurement_taken";

export type CoachReportExerciseComparison = {
  name: string;
  comparable: boolean;
  avg_load_delta_pct?: number | null;
  avg_volume_delta_pct?: number | null;
  per_set: Array<{
    set_index: number | null;
    comparable: boolean;
    load_delta_pct?: number | null;
    volume_delta_pct?: number | null;
  }>;
  athlete_note?: string | null;
};

export type CoachReportSessionPayload = {
  session_id: string;
  routine_id?: string | null;
  routine_name?: string | null;
  start_time: string;
  has_previous_session: boolean;
  session_note?: string | null;
  wellness_signals?: JsonObject | null;
  exercises: CoachReportExerciseComparison[];
};

export type CoachReportMeasurementPayload = {
  measurement_id: string;
  measured_at: string;
  metrics: ProgressSnapshotMetric[];
  notes?: string | null;
};

export type CoachReportItem = {
  id: string;
  athlete_id: string;
  athlete_display_name?: string | null;
  kind: CoachReportKind;
  ref_id: string;
  payload: CoachReportSessionPayload | CoachReportMeasurementPayload | JsonObject;
  created_at_utc: string;
};

export function listCoachReports(params?: { athlete_id?: string; limit?: number }): Promise<CoachReportItem[]> {
  const qs = new URLSearchParams();
  if (params?.athlete_id) qs.set("athlete_id", params.athlete_id);
  if (params?.limit) qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return http(`/api/v1/coach/reports${suffix}`);
}
