export type IngestResult = {
  inserted: number;
  duplicates: number;
  results: Array<{
    inserted: boolean;
    issues: any[];
    session_key: [string, string];
  }>;
};

export type RunCreateResponse = {
  run_id: string;
  summary: any;
};

export type RunListItem = {
  run_id: string;
  generated_at_utc: string;
  engine_version: string;
  metric_key: string;
  used_normalized: boolean;
  summary: any;
};

export type RunSummaryResponse = {
  run_id: string;
  athlete_id: string;
  generated_at_utc: string;
  metric_key: string;
  top3_scenarios: Array<{
    name: string;
    probability: number;
    confidence: number;
    title: string;
    tradeoffs: string[];
    levers: Record<string, any>;
  }>;
  last_latents: Record<string, number | null>;
  confidence_last: number | null;
  issues_by_code: Record<string, number>;
  summary: any;
};

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
}

export function apiPing(): Promise<{ pong: boolean }> {
  return http("/api/v1/meta/ping");
}

export function ingestSessions(payload: unknown): Promise<IngestResult> {
  return http("/api/v1/sessions/batch", { method: "POST", body: JSON.stringify(payload) });
}

export function getSessions(athleteId: string): Promise<any[]> {
  return http(`/api/v1/sessions/${encodeURIComponent(athleteId)}`);
}

export function createRun(
  athleteId: string,
  metricKey = "volume_load_kg",
  useNormalized = true
): Promise<RunCreateResponse> {
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
