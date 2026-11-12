import { type JsonObject, http } from "./core";

export type CycleLevel = "micro" | "meso" | "macro";

export type CycleStatus = "draft" | "active" | "completed" | "archived";

export type CycleStartMode = "auto_on_first_session" | "manual";

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
