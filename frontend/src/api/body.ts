import { http } from "./core";

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
