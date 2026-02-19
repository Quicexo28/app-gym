export type JsonObject = Record<string, unknown>;

export type Role = "user" | "coach" | "admin";
export type BackendPlan = "free" | "pro" | "coach";
export type PlanLabel = "standard" | "plus" | "coach";

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

let authToken: string | null = null;

export function setApiToken(token: string | null): void {
  authToken = token;
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (init?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (authToken) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }

  const res = await fetch(path, {
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

