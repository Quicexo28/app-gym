export type JsonObject = Record<string, unknown>;

export type Role = "user" | "coach" | "admin";
export type BackendPlan = "free" | "pro" | "coach";
export type PlanLabel = "standard" | "plus" | "coach";
export type ViewMode = "admin" | "coach" | "user_plus" | "user_normal";
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
  effective_mode?: ViewMode;
  effective_role?: Role;
  effective_plan?: BackendPlan;
  allowed_view_modes?: ViewMode[];
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

export type ViewModeResponse = {
  mode: ViewMode;
  allowed_modes: ViewMode[];
  role: Role;
  plan: BackendPlan;
  effective_role: Role;
  effective_plan: BackendPlan;
};

export type ProfileData = {
  username?: string | null;
  bio?: string | null;
  achievements: string[];
  medals: string[];
};

export type ProfileTrainingStats = {
  sessions_total: number;
  runs_total: number;
  last_session_at?: string | null;
  last_run_at?: string | null;
};

export type ProfileResponse = {
  email: string;
  role: Role;
  plan: BackendPlan;
  profile: ProfileData;
  training_stats: ProfileTrainingStats;
};

let authToken: string | null = null;
let apiViewMode: ViewMode | null = null;
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

export function setApiViewMode(mode: ViewMode | null): void {
  apiViewMode = mode;
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (init?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (authToken) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }
  if (apiViewMode) {
    headers.set("X-App-View-Mode", apiViewMode);
  }

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

export function getViewMode(): Promise<ViewModeResponse> {
  return http("/api/v1/view-mode");
}

export function putViewMode(mode: ViewMode): Promise<ViewModeResponse> {
  return http("/api/v1/view-mode", {
    method: "PUT",
    body: JSON.stringify({ mode }),
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
  username?: string | null;
  bio?: string | null;
  achievements?: string[];
  medals?: string[];
}): Promise<ProfileResponse> {
  return http("/api/v1/profile/me", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
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

