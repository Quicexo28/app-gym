export type JsonObject = Record<string, unknown>;

export type Role = "user" | "coach" | "admin";
export type BackendPlan = "free" | "pro" | "coach";
export type PlanLabel = "standard" | "plus" | "coach";
export type ViewScopes = { admin: boolean; coach: boolean };
export type CycleLevel = "micro" | "meso" | "macro";
export type CycleStatus = "draft" | "active" | "completed" | "archived";
export type CycleStartMode = "auto_on_first_session" | "manual";

const PLAN_LABEL_BY_BACKEND: Record<BackendPlan, PlanLabel> = {
  free: "standard",
  pro: "plus",
  coach: "coach",
};

const BACKEND_PLAN_BY_LABEL: Record<PlanLabel, BackendPlan> = {
  standard: "free",
  plus: "pro",
  coach: "coach",
};

export function backendPlanToLabel(plan: BackendPlan): PlanLabel {
  return PLAN_LABEL_BY_BACKEND[plan];
}

export function labelToBackendPlan(label: PlanLabel): BackendPlan {
  return BACKEND_PLAN_BY_LABEL[label];
}

export type AuthUser = {
  id: string;
  email: string;
  phone_number?: string | null;
  role: Role;
  plan: BackendPlan;
  can_admin_view?: boolean;
  can_coach_view?: boolean;
  admin_view?: boolean;
  coach_view?: boolean;
  effective_role?: Role;
};

export type TokenResponse = {
  access_token: string;
  token_type: "bearer";
};

export type AuthResponse = {
  token: TokenResponse;
  user: AuthUser;
};

export type ExerciseScope = "global" | "custom";

export type ExerciseCatalogApiItem = {
  id: string;
  group: string;
  family: string;
  variation?: string | null;
  subvariation?: string | null;
  aliases: string[];
  scope: ExerciseScope;
  owner_user_id?: string | null;
  created_at_utc: string;
};

export type GlobalExerciseExportPayload = {
  schema: "coach_ai_exercise_catalog_global_v1";
  exported_at_utc: string;
  total: number;
  items: Array<{
    group: string;
    family: string;
    variation?: string | null;
    subvariation?: string | null;
    aliases: string[];
  }>;
};

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

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
};

export type AccessibleSubject = {
  id: string;
  label: string;
  kind: "self" | "assigned";
};

export type AccessibleAthletesResponse = {
  can_switch: boolean;
  active_subject_id?: string;
  subjects?: AccessibleSubject[];
  athlete_ids?: string[];
};

export type BodyMetricKey =
  | "weight_kg"
  | "height_cm"
  | "neck_cm"
  | "shoulders_cm"
  | "chest_cm"
  | "waist_cm"
  | "hip_cm"
  | "arm_relaxed_cm"
  | "arm_flexed_cm"
  | "forearm_cm"
  | "thigh_cm"
  | "calf_cm"
  | "body_fat_pct";

export type BodyMetricDefinition = {
  key: BodyMetricKey;
  label: string;
  unit: string;
  description: string;
};

export type BodyMeasurementItem = {
  id: string;
  athlete_id: string;
  measured_by_user_id: string;
  measured_at: string;
  created_at_utc: string;
  weight_kg?: number | null;
  height_cm?: number | null;
  neck_cm?: number | null;
  shoulders_cm?: number | null;
  chest_cm?: number | null;
  waist_cm?: number | null;
  hip_cm?: number | null;
  arm_relaxed_cm?: number | null;
  arm_flexed_cm?: number | null;
  forearm_cm?: number | null;
  thigh_cm?: number | null;
  calf_cm?: number | null;
  body_fat_pct?: number | null;
  notes?: string | null;
  bmi?: number | null;
  waist_to_height_ratio?: number | null;
  waist_to_hip_ratio?: number | null;
};

export type BodyMeasurementHistoryResponse = {
  athlete_id: string;
  total: number;
  items: BodyMeasurementItem[];
};

export type BodyMeasurementCreatePayload = {
  athlete_id: string;
  measured_at?: string | null;
  weight_kg?: number | null;
  height_cm?: number | null;
  neck_cm?: number | null;
  shoulders_cm?: number | null;
  chest_cm?: number | null;
  waist_cm?: number | null;
  hip_cm?: number | null;
  arm_relaxed_cm?: number | null;
  arm_flexed_cm?: number | null;
  forearm_cm?: number | null;
  thigh_cm?: number | null;
  calf_cm?: number | null;
  body_fat_pct?: number | null;
  notes?: string | null;
};

export type PlanningMicroBlockPayload = {
  sequence_index: number;
  relative_day: number;
  title: string;
  objective?: string | null;
  routine_snapshot?: JsonObject | unknown[] | null;
  target_volume?: number | null;
  target_intensity?: number | null;
  target_fatigue?: number | null;
  target_frequency?: number | null;
  meta?: JsonObject | null;
};

export type PlanningTemplateItem = {
  id: string;
  owner_user_id: string;
  level: CycleLevel;
  name: string;
  objective?: string | null;
  notes?: string | null;
  status: CycleStatus;
  training_phase?: string | null;
  nutrition_phase?: string | null;
  focus_tags: string[];
  duration_days?: number | null;
  duration_weeks?: number | null;
  block_count?: number;
  created_at_utc: string;
  updated_at_utc: string;
  warnings?: string[];
};

export type PlanningTemplateTree = PlanningTemplateItem & {
  order_index?: number;
  cycle_detected?: boolean;
  blocks?: PlanningMicroBlockPayload[];
  children?: PlanningTemplateTree[];
};

export type PlanningTemplateCreatePayload = {
  level: CycleLevel;
  name: string;
  objective?: string | null;
  notes?: string | null;
  status?: CycleStatus;
  training_phase?: string | null;
  nutrition_phase?: string | null;
  focus_tags?: string[];
  duration_days?: number | null;
  duration_weeks?: number | null;
  blocks?: PlanningMicroBlockPayload[];
};

export type PlanningTemplateUpdatePayload = {
  name?: string;
  objective?: string | null;
  notes?: string | null;
  status?: CycleStatus;
  training_phase?: string | null;
  nutrition_phase?: string | null;
  focus_tags?: string[];
  duration_days?: number | null;
  duration_weeks?: number | null;
  blocks?: PlanningMicroBlockPayload[];
};

export type PlanningTemplateLinkPayload = {
  child_template_id: string;
  order_index: number;
};

export type PlanningAssignment = {
  id: string;
  athlete_id: string;
  template_id: string;
  template_name?: string | null;
  level: CycleLevel;
  assigned_by_user_id: string;
  status: CycleStatus;
  start_mode: CycleStartMode;
  start_date?: string | null;
  tolerance_days: number;
  timezone: string;
  started_at_utc?: string | null;
  completed_at_utc?: string | null;
  archived_at_utc?: string | null;
  created_at_utc: string;
  updated_at_utc: string;
  warnings?: string[];
  blocks_total?: number;
  blocks_completed?: number;
  adherence?: number;
  next_blocks?: Array<{
    id: string;
    title: string;
    target_date?: string | null;
    relative_day: number;
  }>;
};

export type PlanningAssignmentBlock = {
  id: string;
  assignment_id: string;
  micro_seq: number;
  sequence_index: number;
  relative_day: number;
  target_date?: string | null;
  title: string;
  objective?: string | null;
  routine_snapshot?: JsonObject | unknown[] | null;
  target_volume?: number | null;
  target_intensity?: number | null;
  target_fatigue?: number | null;
  target_frequency?: number | null;
  status: "pending" | "completed" | "not_applicable";
  completed_session_id?: string | null;
  completed_at_utc?: string | null;
};

export type PlanningAssignmentDetail = PlanningAssignment & {
  blocks: PlanningAssignmentBlock[];
};

export type PlanningReconcileSummary = {
  assignment_id: string;
  status: CycleStatus;
  updated: boolean;
  completed_now: number;
};

export type PlanningAssignmentMetrics = {
  assignment_id: string;
  athlete_id: string;
  level: CycleLevel;
  status: CycleStatus;
  totals: {
    volume_load_kg: number;
    intensity_avg_rpe?: number | null;
    fatigue_load: number;
    frequency_sessions: number;
    adherence: number;
    blocks_total: number;
    blocks_completed: number;
  };
  micro_rollups: Array<{
    micro_seq: number;
    blocks_total: number;
    blocks_completed: number;
    adherence: number;
    volume_load_kg: number;
    intensity_avg_rpe?: number | null;
    fatigue_load: number;
    frequency_sessions: number;
  }>;
  meso_rollups?: Array<{
    meso_seq: number;
    blocks_total: number;
    blocks_completed: number;
    adherence: number;
    volume_load_kg: number;
    intensity_avg_rpe?: number | null;
    fatigue_load: number;
    frequency_sessions: number;
  }>;
  macro_rollup?: {
    blocks_total: number;
    blocks_completed: number;
    adherence: number;
    volume_load_kg: number;
    intensity_avg_rpe?: number | null;
    fatigue_load: number;
    frequency_sessions: number;
  };
};

export type PlanningAthleteOverview = {
  athlete_id: string;
  active_assignments: PlanningAssignment[];
  recent_assignments: PlanningAssignment[];
};

export type ProfileGender = "male" | "female" | "other" | "unspecified";

export type ProfileData = {
  display_name?: string | null;
  username?: string | null;
  bio?: string | null;
  birth_date?: string | null;
  gender?: ProfileGender | null;
  height_cm?: number | null;
};

export type ProfileTrainingStats = {
  sessions_total: number;
  runs_total: number;
  last_session_at?: string | null;
  last_run_at?: string | null;
};

export type ProfileContact = {
  user_id: string;
  label: string;
};

export type ProfileNetwork = {
  athlete_id: string;
  coaches: ProfileContact[];
  athletes_total: number;
};

export type ProfileResponse = {
  email: string;
  role: Role;
  plan: BackendPlan;
  profile: ProfileData;
  training_stats: ProfileTrainingStats;
  network: ProfileNetwork;
};

export type ProgressSnapshotMetric = {
  key: string;
  label: string;
  value: number;
  unit: string;
  delta?: number | null;
};

export type ProgressAuthor = {
  user_id: string;
  label: string;
  role: Role;
};

export type ProgressShareCommentItem = {
  id: string;
  author: ProgressAuthor;
  body: string;
  created_at_utc: string;
};

export type ProgressShareItem = {
  id: string;
  athlete_id: string;
  author: ProgressAuthor;
  note?: string | null;
  metrics: ProgressSnapshotMetric[];
  sessions_total: number;
  sessions_recent: number;
  measured_at?: string | null;
  created_at_utc: string;
  comments: ProgressShareCommentItem[];
};

export type ProgressShareListResponse = {
  athlete_id: string;
  total: number;
  items: ProgressShareItem[];
};

let authToken: string | null = null;
let apiViewScopes: ViewScopes = { admin: false, coach: false };
let onUnauthorized: (() => void) | null = null;
const API_BASE_URL = ((import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "").replace(/\/+$/, "");

function toApiUrl(path: string): string {
  if (!API_BASE_URL) {
    return path;
  }
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

export function setApiToken(token: string | null): void {
  authToken = token;
}

export function setApiViewScopes(scopes: ViewScopes): void {
  apiViewScopes = scopes;
}

/**
 * Aviso global de token rechazado. El access token vive 24h y no hay refresh:
 * sin esto la sesión vencida se queda montada y cada pantalla muestra el
 * "Invalid token." crudo del backend en vez de mandar al login.
 */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/** Solo cuenta como sesión vencida si mandamos token y el endpoint no es el de autenticacion. */
function notifyUnauthorized(status: number, path: string): void {
  if (status !== 401 || !authToken) return;
  if (path.startsWith("/api/v1/auth/")) return;
  onUnauthorized?.();
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  const isFormDataBody = typeof FormData !== "undefined" && init?.body instanceof FormData;
  if (init?.body !== undefined && !isFormDataBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  // multipart (subida de fotos): NO se fija Content-Type a mano, el navegador
  // le agrega el boundary automaticamente cuando el body es un FormData.
  if (authToken) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }
  headers.set("X-App-Admin-View", apiViewScopes.admin ? "1" : "0");
  headers.set("X-App-Coach-View", apiViewScopes.coach ? "1" : "0");

  const res = await fetch(toApiUrl(path), {
    ...init,
    headers,
  });

  if (!res.ok) {
    const raw = await res.text();
    let detail = raw.trim();

    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { detail?: unknown };
        if (typeof parsed.detail === "string" && parsed.detail.trim()) {
          detail = parsed.detail.trim();
        } else if (
          parsed.detail &&
          typeof parsed.detail === "object" &&
          "message" in parsed.detail &&
          typeof (parsed.detail as { message?: unknown }).message === "string"
        ) {
          detail = String((parsed.detail as { message: string }).message).trim();
        }
      } catch {
        // Keep raw text fallback.
      }
    }

    if (!detail) {
      detail = `${res.status} ${res.statusText}`;
    }
    notifyUnauthorized(res.status, path);
    throw new ApiError(res.status, detail);
  }

  return (await res.json()) as T;
}

export function apiPing(): Promise<{ pong: boolean }> {
  return http("/api/v1/meta/ping");
}

export function authRegister(email: string, password: string, phoneNumber?: string): Promise<AuthResponse> {
  return http("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, phone_number: phoneNumber || null }),
  });
}

export function authLogin(identifier: string, password: string): Promise<AuthResponse> {
  return http("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier, password }),
  });
}

export function authGoogle(idToken: string): Promise<AuthResponse> {
  return http("/api/v1/auth/google", {
    method: "POST",
    body: JSON.stringify({ id_token: idToken }),
  });
}

export function authGuest(): Promise<AuthResponse> {
  return http("/api/v1/auth/guest", {
    method: "POST",
  });
}

export type RoutineStorePayload = {
  schema: string;
  scopes: Record<string, unknown[]>;
  updated_at_utc?: string | null;
};

export function getRoutineStore(): Promise<RoutineStorePayload> {
  return http("/api/v1/routines/store");
}

export function putRoutineStore(scopes: Record<string, unknown[]>): Promise<RoutineStorePayload> {
  return http("/api/v1/routines/store", {
    method: "PUT",
    body: JSON.stringify({ schema: "coach_ai_routines_v2", scopes }),
  });
}

export function getExerciseCatalog(): Promise<ExerciseCatalogApiItem[]> {
  return http("/api/v1/exercises/catalog");
}

export function createCustomExercise(payload: {
  group: string;
  family: string;
  variation?: string;
  subvariation?: string;
  aliases?: string[];
}): Promise<ExerciseCatalogApiItem> {
  return http("/api/v1/exercises/custom", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createGlobalExercise(payload: {
  group: string;
  family: string;
  variation?: string;
  subvariation?: string;
  aliases?: string[];
}): Promise<ExerciseCatalogApiItem> {
  return http("/api/v1/exercises/global", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateCustomExercise(
  exerciseId: string,
  payload: {
    group: string;
    family: string;
    variation?: string;
    subvariation?: string;
    aliases?: string[];
  },
): Promise<ExerciseCatalogApiItem> {
  return http(`/api/v1/exercises/custom/${encodeURIComponent(exerciseId)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function updateGlobalExercise(
  exerciseId: string,
  payload: {
    group: string;
    family: string;
    variation?: string;
    subvariation?: string;
    aliases?: string[];
  },
): Promise<ExerciseCatalogApiItem> {
  return http(`/api/v1/exercises/global/${encodeURIComponent(exerciseId)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteCustomExercise(exerciseId: string): Promise<{ ok: boolean; id: string }> {
  return http(`/api/v1/exercises/custom/${encodeURIComponent(exerciseId)}`, {
    method: "DELETE",
  });
}

export function deleteGlobalExercise(exerciseId: string): Promise<{ ok: boolean; id: string }> {
  return http(`/api/v1/exercises/global/${encodeURIComponent(exerciseId)}`, {
    method: "DELETE",
  });
}

export function importGlobalExercises(payload: {
  mode: "merge" | "replace";
  items: Array<{
    group: string;
    family: string;
    variation?: string;
    subvariation?: string;
    aliases?: string[];
  }>;
}): Promise<{ total: number; imported: number; updated: number; skipped: number }> {
  return http("/api/v1/exercises/global/import", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function exportGlobalExercises(): Promise<GlobalExerciseExportPayload> {
  return http("/api/v1/exercises/global/export");
}

export function getMe(): Promise<AuthUser> {
  return http("/api/v1/me");
}

export function getAccessibleAthletes(): Promise<AccessibleAthletesResponse> {
  return http("/api/v1/athletes/accessible");
}

export function getBodyMetricDefinitions(): Promise<BodyMetricDefinition[]> {
  return http("/api/v1/body-metrics/definitions");
}

export function getBodyMeasurementsHistory(athleteId: string, limit = 100): Promise<BodyMeasurementHistoryResponse> {
  const qs = new URLSearchParams({ limit: String(limit) });
  return http(`/api/v1/body-metrics/${encodeURIComponent(athleteId)}?${qs.toString()}`);
}

export function createBodyMeasurement(payload: BodyMeasurementCreatePayload): Promise<BodyMeasurementItem> {
  return http("/api/v1/body-metrics", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteMyAccount(confirm: string): Promise<{ ok: boolean }> {
  return http("/api/v1/auth/me", {
    method: "DELETE",
    body: JSON.stringify({ confirm }),
  });
}

export function getMyProfile(): Promise<ProfileResponse> {
  return http("/api/v1/profile/me");
}

export function updateMyProfile(payload: {
  display_name?: string | null;
  username?: string | null;
  bio?: string | null;
  birth_date?: string | null;
  gender?: ProfileGender | null;
  height_cm?: number | null;
}): Promise<ProfileResponse> {
  return http("/api/v1/profile/me", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function listProgressShares(athleteId: string, limit = 20): Promise<ProgressShareListResponse> {
  const qs = new URLSearchParams({ athlete_id: athleteId, limit: String(limit) });
  return http(`/api/v1/progress/shares?${qs.toString()}`);
}

export function createProgressShare(payload: {
  athlete_id: string;
  note?: string | null;
}): Promise<ProgressShareItem> {
  return http("/api/v1/progress/shares", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createProgressComment(shareId: string, body: string): Promise<ProgressShareItem> {
  return http(`/api/v1/progress/shares/${encodeURIComponent(shareId)}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export function deleteProgressShare(shareId: string): Promise<{ ok: boolean; id: string }> {
  return http(`/api/v1/progress/shares/${encodeURIComponent(shareId)}`, { method: "DELETE" });
}

export function adminSwitchPlan(payload: {
  email: string;
  plan: BackendPlan;
  role?: Role;
}): Promise<{ ok: boolean; email: string; plan: BackendPlan; role: Role }> {
  return http("/api/v1/admin/dev/switch-plan", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

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

export function getPlanningTemplates(level?: CycleLevel): Promise<PlanningTemplateItem[]> {
  const qs = new URLSearchParams();
  if (level) qs.set("level", level);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return http(`/api/v1/planning/templates${suffix}`);
}

export function createPlanningTemplate(payload: PlanningTemplateCreatePayload): Promise<PlanningTemplateItem> {
  return http("/api/v1/planning/templates", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updatePlanningTemplate(
  templateId: string,
  payload: PlanningTemplateUpdatePayload,
): Promise<PlanningTemplateItem> {
  return http(`/api/v1/planning/templates/${encodeURIComponent(templateId)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deletePlanningTemplate(templateId: string): Promise<{ ok: boolean; id: string }> {
  return http(`/api/v1/planning/templates/${encodeURIComponent(templateId)}`, {
    method: "DELETE",
  });
}

export function getPlanningTemplateTree(templateId: string): Promise<PlanningTemplateTree> {
  return http(`/api/v1/planning/templates/${encodeURIComponent(templateId)}/tree`);
}

export function linkPlanningTemplateChild(
  templateId: string,
  payload: PlanningTemplateLinkPayload,
): Promise<{ id: string; parent_template_id: string; child_template_id: string; order_index: number }> {
  return http(`/api/v1/planning/templates/${encodeURIComponent(templateId)}/children`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createPlanningAssignment(payload: {
  athlete_id: string;
  template_id: string;
  start_mode?: CycleStartMode;
  start_date?: string | null;
  tolerance_days?: number;
  timezone?: string;
}): Promise<PlanningAssignment & { reconcile?: PlanningReconcileSummary }> {
  return http("/api/v1/planning/assignments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listPlanningAssignments(params?: {
  athlete_id?: string;
  status?: CycleStatus;
}): Promise<PlanningAssignment[]> {
  const qs = new URLSearchParams();
  if (params?.athlete_id) qs.set("athlete_id", params.athlete_id);
  if (params?.status) qs.set("status", params.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return http(`/api/v1/planning/assignments${suffix}`);
}

export function getPlanningAssignment(assignmentId: string): Promise<PlanningAssignmentDetail> {
  return http(`/api/v1/planning/assignments/${encodeURIComponent(assignmentId)}`);
}

export function patchPlanningAssignmentStatus(
  assignmentId: string,
  status: CycleStatus,
): Promise<PlanningAssignment> {
  return http(`/api/v1/planning/assignments/${encodeURIComponent(assignmentId)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function reconcilePlanningAssignment(assignmentId: string): Promise<PlanningReconcileSummary> {
  return http(`/api/v1/planning/assignments/${encodeURIComponent(assignmentId)}/reconcile`, {
    method: "POST",
  });
}

export function getPlanningAssignmentMetrics(assignmentId: string): Promise<PlanningAssignmentMetrics> {
  return http(`/api/v1/planning/assignments/${encodeURIComponent(assignmentId)}/metrics`);
}

export function getPlanningAthleteOverview(athleteId: string): Promise<PlanningAthleteOverview> {
  return http(`/api/v1/planning/athletes/${encodeURIComponent(athleteId)}/overview`);
}

// Mismos 12 grupos y orden que coach_ai.training_core.muscle_groups (backend) -
// deben coincidir literalmente: son los valores validos de AthletePlan.priority_muscle_groups.
export const MUSCLE_GROUPS = [
  "Hombros",
  "Biceps",
  "Triceps",
  "Pecho",
  "Espalda",
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

export function sendSessionHeartbeat(payload: {
  athlete_id: string;
  routine_id?: string | null;
  routine_name?: string | null;
}): Promise<{ ok: boolean }> {
  return http("/api/v1/me/session-heartbeat", { method: "POST", body: JSON.stringify(payload) });
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

// --------------------------------------------------------------------------
// Dieta (`src/app/api/v1/endpoints/diet.py`)
// --------------------------------------------------------------------------

// Franjas legacy (fijas) + genericas personalizables `comida_1`..`comida_8`
// (ver `MealSlot` en `src/app/api/v1/endpoints/diet.py`). El nombre visible de
// las genericas sale de `NutritionTarget.meal_labels`, no de este id.
export type MealSlot = string;
export type FoodScope = "all" | "mine" | "global";
export type FoodBasis = "per_100g" | "per_100ml";
export type FoodStatus = "active" | "pending" | "rejected";

export type NutritionTarget = {
  athlete_id: string;
  energy_kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  micronutrient_targets: Record<string, number>;
  meal_labels: string[] | null;
  updated_at_utc: string | null;
};

export type NutritionTargetPayload = {
  athlete_id: string;
  energy_kcal?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  fiber_g?: number | null;
  micronutrient_targets?: Record<string, number> | null;
  meal_labels?: string[] | null;
};

export function getDietTargets(athleteId: string): Promise<NutritionTarget> {
  const qs = new URLSearchParams({ athlete_id: athleteId });
  return http(`/api/v1/diet/targets?${qs.toString()}`);
}

export function putDietTargets(payload: NutritionTargetPayload): Promise<NutritionTarget> {
  return http("/api/v1/diet/targets", { method: "PUT", body: JSON.stringify(payload) });
}

export type DailyTotals = {
  energy_kcal: number;
  protein_g: number;
  carbs_g: number;
  sugars_g: number;
  fiber_g: number;
  fat_g: number;
  sat_fat_g: number;
  sodium_mg: number;
  micronutrients: Record<string, number>;
};

export type MealEntry = {
  id: string;
  athlete_id: string;
  logged_by_user_id: string;
  consumed_at: string;
  meal_slot: MealSlot;
  food_product_id: string | null;
  food_name: string;
  // `quantity_g` es la cantidad normalizada a la unidad base del alimento (g, o
  // ml si su basis es per_100ml): es la que entra en los macros.
  // `quantity_value`/`quantity_unit` guardan lo que escribio el usuario
  // ("2 porciones"); son null en entradas anteriores a las unidades.
  quantity_g: number;
  quantity_value: number | null;
  quantity_unit: string | null;
  energy_kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  sugars_g: number | null;
  fiber_g: number | null;
  fat_g: number | null;
  sat_fat_g: number | null;
  sodium_mg: number | null;
  micronutrients: Record<string, number>;
  notes: string | null;
  created_at_utc: string;
};

export type MealEntryCreatePayload = {
  athlete_id: string;
  consumed_at?: string | null;
  meal_slot: MealSlot;
  food_product_id?: string | null;
  food_name?: string | null;
  // Se manda la cantidad en la unidad que eligio el usuario y el backend
  // convierte (es el único que conoce el `serving_size_g` del catálogo).
  // `quantity_g` solo para entradas ya normalizadas (reencolar, deshacer).
  quantity_g?: number;
  quantity_value?: number | null;
  quantity_unit?: string | null;
  notes?: string | null;
  energy_kcal?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  sugars_g?: number | null;
  fiber_g?: number | null;
  fat_g?: number | null;
  sat_fat_g?: number | null;
  sodium_mg?: number | null;
  micronutrients?: Record<string, number> | null;
  // Idempotencia del outbox offline (`lib/nutrition/mealOutbox.ts`): mismo
  // client_ref -> el backend devuelve la entrada ya creada en vez de duplicarla.
  client_ref?: string | null;
};

export type MealEntryUpdatePayload = {
  consumed_at?: string | null;
  meal_slot?: MealSlot;
  quantity_g?: number;
  quantity_value?: number | null;
  quantity_unit?: string | null;
  food_name?: string;
  notes?: string | null;
  energy_kcal?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  sugars_g?: number | null;
  fiber_g?: number | null;
  fat_g?: number | null;
  sat_fat_g?: number | null;
  sodium_mg?: number | null;
  micronutrients?: Record<string, number> | null;
};

export type MealEntryFromPresetPayload = {
  athlete_id: string;
  preset_id: string;
  consumed_at?: string | null;
  meal_slot?: MealSlot | null;
  // Ref de LOTE (uno por intento de guardado), no uno por item del preset.
  client_ref?: string | null;
};

export type MealEntriesResponse = {
  athlete_id: string;
  date: string;
  items: MealEntry[];
  totals: DailyTotals;
};

export type DietSummaryDayItem = {
  date: string;
  totals: DailyTotals;
};

export type DietSummaryResponse = {
  athlete_id: string;
  from_date: string;
  to_date: string;
  days: DietSummaryDayItem[];
};

export function getDietEntries(athleteId: string, date: string): Promise<MealEntriesResponse> {
  const qs = new URLSearchParams({ athlete_id: athleteId, date });
  return http(`/api/v1/diet/entries?${qs.toString()}`);
}

export function createDietEntry(payload: MealEntryCreatePayload): Promise<MealEntry> {
  return http("/api/v1/diet/entries", { method: "POST", body: JSON.stringify(payload) });
}

export function updateDietEntry(entryId: string, payload: MealEntryUpdatePayload): Promise<MealEntry> {
  return http(`/api/v1/diet/entries/${encodeURIComponent(entryId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteDietEntry(entryId: string): Promise<{ ok: boolean; id: string }> {
  return http(`/api/v1/diet/entries/${encodeURIComponent(entryId)}`, { method: "DELETE" });
}

export function createDietEntriesFromPreset(payload: MealEntryFromPresetPayload): Promise<MealEntry[]> {
  return http("/api/v1/diet/entries/from-preset", { method: "POST", body: JSON.stringify(payload) });
}

export function getDietSummary(athleteId: string, from: string, to: string): Promise<DietSummaryResponse> {
  const qs = new URLSearchParams({ athlete_id: athleteId, from, to });
  return http(`/api/v1/diet/summary?${qs.toString()}`);
}

export type FoodProduct = {
  id: string;
  owner_user_id: string | null;
  barcode: string | null;
  source: string;
  source_ref: string | null;
  name: string;
  brand: string | null;
  country_code: string | null;
  category: string | null;
  serving_size_g: number | null;
  serving_label: string | null;
  package_qty_g: number | null;
  basis: FoodBasis;
  energy_kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  sugars_g: number | null;
  fiber_g: number | null;
  fat_g: number | null;
  sat_fat_g: number | null;
  trans_fat_g: number | null;
  sodium_mg: number | null;
  cholesterol_mg: number | null;
  micronutrients: Record<string, number>;
  image_front_path: string | null;
  image_nutrition_path: string | null;
  verified_count: number;
  status: FoodStatus;
  created_at_utc: string;
};

export type FoodProductCreatePayload = {
  barcode?: string | null;
  name: string;
  brand?: string | null;
  country_code?: string | null;
  serving_size_g?: number | null;
  serving_label?: string | null;
  package_qty_g?: number | null;
  basis?: FoodBasis;
  energy_kcal?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  sugars_g?: number | null;
  fiber_g?: number | null;
  fat_g?: number | null;
  sat_fat_g?: number | null;
  trans_fat_g?: number | null;
  sodium_mg?: number | null;
  cholesterol_mg?: number | null;
  micronutrients?: Record<string, number> | null;
};

export type FoodProductUpdatePayload = Partial<FoodProductCreatePayload> & { status?: FoodStatus };

export type FoodSearchFilters = {
  q: string;
  scope?: FoodScope;
  /** Una o varias categorias del catálogo; se envian como `?category=` repetido. */
  category?: string | string[];
  min_kcal?: number;
  max_kcal?: number;
  min_protein?: number;
  max_protein?: number;
  min_carbs?: number;
  max_carbs?: number;
  min_fat?: number;
  max_fat?: number;
  limit?: number;
};

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).filter((item) => item.trim() !== "");
}

export function searchDietFoods(params: FoodSearchFilters): Promise<FoodProduct[]> {
  const qs = new URLSearchParams({ q: params.q });
  if (params.scope) qs.set("scope", params.scope);
  for (const category of toArray(params.category)) qs.append("category", category);
  if (params.min_kcal !== undefined) qs.set("min_kcal", String(params.min_kcal));
  if (params.max_kcal !== undefined) qs.set("max_kcal", String(params.max_kcal));
  if (params.min_protein !== undefined) qs.set("min_protein", String(params.min_protein));
  if (params.max_protein !== undefined) qs.set("max_protein", String(params.max_protein));
  if (params.min_carbs !== undefined) qs.set("min_carbs", String(params.min_carbs));
  if (params.max_carbs !== undefined) qs.set("max_carbs", String(params.max_carbs));
  if (params.min_fat !== undefined) qs.set("min_fat", String(params.min_fat));
  if (params.max_fat !== undefined) qs.set("max_fat", String(params.max_fat));
  if (params.limit) qs.set("limit", String(params.limit));
  return http(`/api/v1/diet/foods/search?${qs.toString()}`);
}

export function getRecentDietFoods(athleteId: string, limit?: number): Promise<FoodProduct[]> {
  const qs = new URLSearchParams({ athlete_id: athleteId });
  if (limit) qs.set("limit", String(limit));
  return http(`/api/v1/diet/foods/recent?${qs.toString()}`);
}

export function getDietFoodCategories(scope?: FoodScope): Promise<string[]> {
  const qs = new URLSearchParams();
  if (scope) qs.set("scope", scope);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return http(`/api/v1/diet/foods/categories${suffix}`);
}

export function getDietFoodByBarcode(barcode: string): Promise<FoodProduct> {
  return http(`/api/v1/diet/foods/barcode/${encodeURIComponent(barcode)}`);
}

export function createDietFood(payload: FoodProductCreatePayload): Promise<FoodProduct> {
  return http("/api/v1/diet/foods", { method: "POST", body: JSON.stringify(payload) });
}

export function updateDietFood(foodId: string, payload: FoodProductUpdatePayload): Promise<FoodProduct> {
  return http(`/api/v1/diet/foods/${encodeURIComponent(foodId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteDietFood(foodId: string): Promise<{ ok: boolean; id: string }> {
  return http(`/api/v1/diet/foods/${encodeURIComponent(foodId)}`, { method: "DELETE" });
}

export type FoodPhotoKind = "front" | "nutrition";

export type FoodPhotoUploadResponse = {
  ok: boolean;
  kind: FoodPhotoKind;
  path: string;
};

/** Sube la foto de un producto (multipart: `kind` + `file`). Ver `upload_food_photo` en el backend. */
export function uploadDietFoodPhoto(
  foodId: string,
  kind: FoodPhotoKind,
  file: Blob,
  filename?: string,
): Promise<FoodPhotoUploadResponse> {
  const form = new FormData();
  form.append("kind", kind);
  form.append("file", file, filename || `${kind}.jpg`);
  return http(`/api/v1/diet/foods/${encodeURIComponent(foodId)}/photos`, { method: "POST", body: form });
}

/** La respuesta es la imagen binaria (JPEG), no JSON: `http()` no aplica aquí. */
export async function getDietFoodPhoto(foodId: string, kind: FoodPhotoKind): Promise<Blob> {
  const headers = new Headers();
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
  headers.set("X-App-Admin-View", apiViewScopes.admin ? "1" : "0");
  headers.set("X-App-Coach-View", apiViewScopes.coach ? "1" : "0");

  const path = `/api/v1/diet/foods/${encodeURIComponent(foodId)}/photos/${kind}`;
  const res = await fetch(toApiUrl(path), { headers });
  if (!res.ok) {
    notifyUnauthorized(res.status, path);
    throw new ApiError(res.status, res.statusText || "No se pudo obtener la foto.");
  }
  return res.blob();
}

export type MicronutrientDefinition = {
  key: string;
  label: string;
  unit: string;
  rda: number;
  upper_limit: number | null;
};

export function getDietMicronutrients(): Promise<MicronutrientDefinition[]> {
  return http("/api/v1/diet/micronutrients");
}

export type MealPresetItem = {
  food_product_id?: string | null;
  food_name: string;
  quantity_g: number;
  // Solo presentacion: `quantity_g` sigue mandando al crear las entradas.
  quantity_value?: number | null;
  quantity_unit?: string | null;
  energy_kcal?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  sugars_g?: number | null;
  fiber_g?: number | null;
  fat_g?: number | null;
  sat_fat_g?: number | null;
  sodium_mg?: number | null;
  micronutrients?: Record<string, number> | null;
};

export type MealPreset = {
  id: string;
  owner_user_id: string;
  name: string;
  meal_slot: MealSlot | null;
  items: MealPresetItem[];
  created_at_utc: string;
  updated_at_utc: string;
};

export type MealPresetCreatePayload = {
  name: string;
  meal_slot?: MealSlot | null;
  items: MealPresetItem[];
};

export function getDietPresets(): Promise<MealPreset[]> {
  return http("/api/v1/diet/presets");
}

export function createDietPreset(payload: MealPresetCreatePayload): Promise<MealPreset> {
  return http("/api/v1/diet/presets", { method: "POST", body: JSON.stringify(payload) });
}

export function deleteDietPreset(presetId: string): Promise<{ ok: boolean; id: string }> {
  return http(`/api/v1/diet/presets/${encodeURIComponent(presetId)}`, { method: "DELETE" });
}

