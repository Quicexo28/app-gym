import { type BackendPlan, type Role, http } from "./core";

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
