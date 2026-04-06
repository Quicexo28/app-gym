import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createPlanningAssignment,
  createPlanningTemplate,
  deletePlanningTemplate,
  getPlanningAssignment,
  getPlanningAssignmentMetrics,
  getPlanningAthleteOverview,
  getPlanningTemplateTree,
  getPlanningTemplates,
  linkPlanningTemplateChild,
  listPlanningAssignments,
  patchPlanningAssignmentStatus,
  reconcilePlanningAssignment,
  type CycleLevel,
  type CycleStartMode,
  type CycleStatus,
  type PlanningAssignment,
  type PlanningAssignmentDetail,
  type PlanningAssignmentMetrics,
  type PlanningAthleteOverview,
  type PlanningTemplateItem,
  type PlanningTemplateTree,
} from "../api";
import { loadRoutines, type RoutineTemplate } from "../lib/storage";
import { useAthleteAccess } from "../state/athlete";
import { useUndo } from "../state/undo";

type PlanningTab = "micro" | "meso" | "macro" | "assignments" | "tracking";
type BuilderLevel = "micro" | "meso" | "macro";
const CUSTOM_OBJECTIVE_PRESET_ID = "custom";

type BuilderConfig = {
  name: string;
  objectivePresetId: string;
  objective: string;
  duration: number;
};

type ObjectivePreset = {
  id: string;
  label: string;
  objective: string;
  trainingPhase?: string;
};

type MicroSlot = {
  index: number;
  title: string;
  routineId: string;
};

type LinkSlot = {
  index: number;
  childTemplateId: string;
};

type MicroBuilder = {
  name: string;
  duration: number;
  slots: MicroSlot[];
};

type LinkBuilder = BuilderConfig & {
  slots: LinkSlot[];
};

const OBJECTIVE_PRESETS: ObjectivePreset[] = [
  {
    id: "hypertrophy",
    label: "Hipertrofia",
    objective: "Aumentar volumen util con ejecucion controlada.",
    trainingPhase: "hypertrophy",
  },
  {
    id: "strength",
    label: "Fuerza",
    objective: "Elevar fuerza maxima con enfasis tecnico.",
    trainingPhase: "strength",
  },
  {
    id: "deload",
    label: "Descarga",
    objective: "Reducir fatiga acumulada sin perder patron tecnico.",
    trainingPhase: "deload",
  },
  {
    id: "conditioning",
    label: "Acondicionamiento",
    objective: "Mejorar capacidad de trabajo y tolerancia al esfuerzo.",
    trainingPhase: "conditioning",
  },
  {
    id: "technique",
    label: "Tecnica",
    objective: "Refinar patron motor, ritmo y estabilidad.",
    trainingPhase: "technique",
  },
  {
    id: CUSTOM_OBJECTIVE_PRESET_ID,
    label: "Personalizado",
    objective: "",
  },
];

const OBJECTIVE_PRESET_MAP = new Map(OBJECTIVE_PRESETS.map((preset) => [preset.id, preset]));

function levelLabel(level: CycleLevel): string {
  if (level === "micro") return "Microciclo";
  if (level === "meso") return "Mesociclo";
  return "Macrociclo";
}

function statusLabel(status: CycleStatus): string {
  if (status === "draft") return "Draft";
  if (status === "active") return "Activo";
  if (status === "completed") return "Completado";
  return "Archivado";
}

function defaultDurationForLevel(level: CycleLevel): number {
  if (level === "micro") return 7;
  if (level === "meso") return 6;
  return 6;
}

function durationLabel(level: CycleLevel): string {
  if (level === "micro") return "Sesiones por ciclo";
  if (level === "meso") return "Ciclos por bloque";
  return "Bloques por plan";
}

function defaultBuilderName(level: BuilderLevel): string {
  if (level === "micro") return "Nuevo microciclo";
  if (level === "meso") return "Nuevo mesociclo";
  return "Nuevo macrociclo";
}

function makeMicroSlots(duration: number): MicroSlot[] {
  return Array.from({ length: duration }, (_, idx) => ({
    index: idx + 1,
    title: `Sesion ${idx + 1}`,
    routineId: "",
  }));
}

function makeLinkSlots(duration: number): LinkSlot[] {
  return Array.from({ length: duration }, (_, idx) => ({
    index: idx + 1,
    childTemplateId: "",
  }));
}

function resizeMicroSlots(slots: MicroSlot[], duration: number): MicroSlot[] {
  const byIndex = new Map(slots.map((slot) => [slot.index, slot]));
  return Array.from({ length: duration }, (_, idx) => {
    const index = idx + 1;
    const existing = byIndex.get(index);
    if (existing) return { ...existing, index };
    return {
      index,
      title: `Sesion ${index}`,
      routineId: "",
    };
  });
}

function resizeLinkSlots(slots: LinkSlot[], duration: number): LinkSlot[] {
  const byIndex = new Map(slots.map((slot) => [slot.index, slot]));
  return Array.from({ length: duration }, (_, idx) => {
    const index = idx + 1;
    const existing = byIndex.get(index);
    if (existing) return { ...existing, index };
    return {
      index,
      childTemplateId: "",
    };
  });
}

function buildBlankMicroBuilder(): MicroBuilder {
  const duration = defaultDurationForLevel("micro");
  return {
    name: defaultBuilderName("micro"),
    duration,
    slots: makeMicroSlots(duration),
  };
}

function buildBlankLinkBuilder(level: "meso" | "macro"): LinkBuilder {
  const duration = defaultDurationForLevel(level);
  return {
    name: defaultBuilderName(level),
    objectivePresetId: CUSTOM_OBJECTIVE_PRESET_ID,
    objective: "",
    duration,
    slots: makeLinkSlots(duration),
  };
}

function TreeNode({ node }: { node: PlanningTemplateTree }) {
  return (
    <details className="treeNode" open>
      <summary className="treeSummary">
        <span>{`${node.name} (${levelLabel(node.level)})`}</span>
        <span className="chip">{statusLabel(node.status)}</span>
      </summary>
      <div className="treeChildren">
        {node.blocks && node.blocks.length > 0 ? (
          <div className="treeLeafList">
            {node.blocks.map((block, idx) => (
              <article key={`${node.id}_block_${idx}`} className="treeLeaf">
                <div>
                  <strong>{block.title}</strong>
                  <div className="small">{`Sesion ${block.relative_day}`}</div>
                </div>
              </article>
            ))}
          </div>
        ) : null}
        {node.children && node.children.length > 0 ? (
          <div className="treeList">
            {node.children.map((child) => (
              <TreeNode key={child.id} node={child} />
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}

export default function Planning() {
  const { athleteId, subjects } = useAthleteAccess();
  const { registerUndo } = useUndo();
  const pendingDeleteTimerByTemplateRef = useRef<Map<string, number>>(new Map());
  const [tab, setTab] = useState<PlanningTab>("micro");

  const [templates, setTemplates] = useState<Record<CycleLevel, PlanningTemplateItem[]>>({
    micro: [],
    meso: [],
    macro: [],
  });
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templatesError, setTemplatesError] = useState("");
  const [feedback, setFeedback] = useState("");

  const [microBuilder, setMicroBuilder] = useState<MicroBuilder>(() => buildBlankMicroBuilder());
  const [mesoBuilder, setMesoBuilder] = useState<LinkBuilder>(() => buildBlankLinkBuilder("meso"));
  const [macroBuilder, setMacroBuilder] = useState<LinkBuilder>(() => buildBlankLinkBuilder("macro"));

  const [selectedMicroSlot, setSelectedMicroSlot] = useState<number>(1);
  const [selectedMesoSlot, setSelectedMesoSlot] = useState<number>(1);
  const [selectedMacroSlot, setSelectedMacroSlot] = useState<number>(1);

  const [treeData, setTreeData] = useState<PlanningTemplateTree | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);

  const [assignmentAthleteId, setAssignmentAthleteId] = useState("");
  const [assignmentTemplateId, setAssignmentTemplateId] = useState("");
  const [startMode, setStartMode] = useState<CycleStartMode>("auto_on_first_session");
  const [startDate, setStartDate] = useState("");
  const [toleranceDays, setToleranceDays] = useState("2");
  const [timezone, setTimezone] = useState("UTC");

  const [assignments, setAssignments] = useState<PlanningAssignment[]>([]);
  const [overview, setOverview] = useState<PlanningAthleteOverview | null>(null);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState("");
  const [assignmentDetail, setAssignmentDetail] = useState<PlanningAssignmentDetail | null>(null);
  const [assignmentMetrics, setAssignmentMetrics] = useState<PlanningAssignmentMetrics | null>(null);
  const [loadingAssignments, setLoadingAssignments] = useState(false);

  const routines = useMemo<RoutineTemplate[]>(() => loadRoutines(athleteId), [athleteId]);
  const routineMap = useMemo(() => new Map(routines.map((routine) => [routine.id, routine])), [routines]);
  const microTemplateMap = useMemo(
    () => new Map(templates.micro.map((item) => [item.id, item])),
    [templates.micro],
  );
  const mesoTemplateMap = useMemo(
    () => new Map(templates.meso.map((item) => [item.id, item])),
    [templates.meso],
  );
  const allTemplates = useMemo(
    () => [...templates.micro, ...templates.meso, ...templates.macro],
    [templates],
  );

  const selectedMicroSlotData = useMemo(
    () => microBuilder.slots.find((slot) => slot.index === selectedMicroSlot) || microBuilder.slots[0] || null,
    [microBuilder, selectedMicroSlot],
  );
  const selectedMesoSlotData = useMemo(
    () => mesoBuilder.slots.find((slot) => slot.index === selectedMesoSlot) || mesoBuilder.slots[0] || null,
    [mesoBuilder, selectedMesoSlot],
  );
  const selectedMacroSlotData = useMemo(
    () => macroBuilder.slots.find((slot) => slot.index === selectedMacroSlot) || macroBuilder.slots[0] || null,
    [macroBuilder, selectedMacroSlot],
  );

  const refreshTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    setTemplatesError("");
    try {
      const [micro, meso, macro] = await Promise.all([
        getPlanningTemplates("micro"),
        getPlanningTemplates("meso"),
        getPlanningTemplates("macro"),
      ]);
      const pendingDeletes = pendingDeleteTimerByTemplateRef.current;
      setTemplates({
        micro: micro.filter((item) => !pendingDeletes.has(item.id)),
        meso: meso.filter((item) => !pendingDeletes.has(item.id)),
        macro: macro.filter((item) => !pendingDeletes.has(item.id)),
      });
    } catch (cause: unknown) {
      setTemplatesError(String((cause as { message?: string })?.message || cause));
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  const loadTree = useCallback(async (templateId: string) => {
    if (!templateId) return;
    setTreeLoading(true);
    try {
      const data = await getPlanningTemplateTree(templateId);
      setTreeData(data);
    } catch (cause: unknown) {
      setTemplatesError(String((cause as { message?: string })?.message || cause));
      setTreeData(null);
    } finally {
      setTreeLoading(false);
    }
  }, []);

  const refreshAssignments = useCallback(async (targetAthleteId: string) => {
    if (!targetAthleteId) {
      setAssignments([]);
      setOverview(null);
      return;
    }
    setLoadingAssignments(true);
    try {
      const [items, dataOverview] = await Promise.all([
        listPlanningAssignments({ athlete_id: targetAthleteId }),
        getPlanningAthleteOverview(targetAthleteId),
      ]);
      setAssignments(items);
      setOverview(dataOverview);
    } catch (cause: unknown) {
      setTemplatesError(String((cause as { message?: string })?.message || cause));
    } finally {
      setLoadingAssignments(false);
    }
  }, []);

  const loadAssignmentDetail = useCallback(async (assignmentId: string) => {
    if (!assignmentId) {
      setAssignmentDetail(null);
      setAssignmentMetrics(null);
      return;
    }
    try {
      const [detail, metrics] = await Promise.all([
        getPlanningAssignment(assignmentId),
        getPlanningAssignmentMetrics(assignmentId),
      ]);
      setAssignmentDetail(detail);
      setAssignmentMetrics(metrics);
    } catch (cause: unknown) {
      setTemplatesError(String((cause as { message?: string })?.message || cause));
      setAssignmentDetail(null);
      setAssignmentMetrics(null);
    }
  }, []);

  useEffect(() => {
    void refreshTemplates();
  }, [refreshTemplates]);

  useEffect(() => {
    if (assignmentAthleteId) return;
    if (athleteId) setAssignmentAthleteId(athleteId);
  }, [athleteId, assignmentAthleteId]);

  useEffect(() => {
    if (!athleteId) return;
    void refreshAssignments(athleteId);
  }, [athleteId, refreshAssignments]);

  useEffect(() => {
    if (!selectedAssignmentId) return;
    void loadAssignmentDetail(selectedAssignmentId);
  }, [selectedAssignmentId, loadAssignmentDetail]);

  useEffect(() => {
    if (selectedMicroSlot <= microBuilder.duration) return;
    setSelectedMicroSlot(microBuilder.duration);
  }, [selectedMicroSlot, microBuilder.duration]);

  useEffect(() => {
    if (selectedMesoSlot <= mesoBuilder.duration) return;
    setSelectedMesoSlot(mesoBuilder.duration);
  }, [selectedMesoSlot, mesoBuilder.duration]);

  useEffect(() => {
    if (selectedMacroSlot <= macroBuilder.duration) return;
    setSelectedMacroSlot(macroBuilder.duration);
  }, [selectedMacroSlot, macroBuilder.duration]);

  useEffect(() => {
    setMicroBuilder((current) => {
      let changed = false;
      const nextSlots = current.slots.map((slot) => {
        if (!slot.routineId || routineMap.has(slot.routineId)) return slot;
        changed = true;
        return { ...slot, routineId: "" };
      });
      if (!changed) return current;
      return { ...current, slots: nextSlots };
    });
  }, [routineMap]);

  function parseDurationInput(raw: string, fallback: number): number {
    const parsed = Math.floor(Number(raw));
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return parsed;
  }

  function applyObjectivePresetToLink(level: "meso" | "macro", presetId: string) {
    const setter = level === "meso" ? setMesoBuilder : setMacroBuilder;
    setter((current) => ({
      ...current,
      objectivePresetId: presetId,
      objective:
        presetId === CUSTOM_OBJECTIVE_PRESET_ID
          ? current.objective
          : OBJECTIVE_PRESET_MAP.get(presetId)?.objective || current.objective,
    }));
  }

  function resetBuilder(level: BuilderLevel) {
    if (level === "micro") {
      setMicroBuilder(buildBlankMicroBuilder());
      setSelectedMicroSlot(1);
    } else if (level === "meso") {
      setMesoBuilder(buildBlankLinkBuilder("meso"));
      setSelectedMesoSlot(1);
    } else {
      setMacroBuilder(buildBlankLinkBuilder("macro"));
      setSelectedMacroSlot(1);
    }
    setFeedback(`${levelLabel(level)} listo para configurar.`);
    setTemplatesError("");
  }

  function updateMicroConfig(patch: Partial<Pick<MicroBuilder, "name">>) {
    setMicroBuilder((current) => ({ ...current, ...patch }));
  }

  function updateLinkConfig(level: "meso" | "macro", patch: Partial<BuilderConfig>) {
    const setter = level === "meso" ? setMesoBuilder : setMacroBuilder;
    setter((current) => ({ ...current, ...patch }));
  }

  function updateMicroDuration(rawValue: string) {
    setMicroBuilder((current) => {
      const duration = parseDurationInput(rawValue, current.duration);
      return {
        ...current,
        duration,
        slots: resizeMicroSlots(current.slots, duration),
      };
    });
  }

  function updateLinkDuration(level: "meso" | "macro", rawValue: string) {
    const setter = level === "meso" ? setMesoBuilder : setMacroBuilder;
    setter((current) => {
      const duration = parseDurationInput(rawValue, current.duration);
      return {
        ...current,
        duration,
        slots: resizeLinkSlots(current.slots, duration),
      };
    });
  }

  function updateMicroSlot(index: number, patch: Partial<MicroSlot>) {
    setMicroBuilder((current) => ({
      ...current,
      slots: current.slots.map((slot) => (slot.index === index ? { ...slot, ...patch } : slot)),
    }));
  }

  function updateLinkSlot(level: "meso" | "macro", index: number, childTemplateId: string) {
    const setter = level === "meso" ? setMesoBuilder : setMacroBuilder;
    setter((current) => ({
      ...current,
      slots: current.slots.map((slot) => (slot.index === index ? { ...slot, childTemplateId } : slot)),
    }));
  }

  function builderFocusTag(builder: BuilderConfig): string | undefined {
    if (builder.objectivePresetId === CUSTOM_OBJECTIVE_PRESET_ID) {
      return builder.objective.trim() ? "custom" : undefined;
    }
    return builder.objectivePresetId;
  }

  function builderTrainingPhase(builder: BuilderConfig): string | undefined {
    if (builder.objectivePresetId === CUSTOM_OBJECTIVE_PRESET_ID) return undefined;
    return OBJECTIVE_PRESET_MAP.get(builder.objectivePresetId)?.trainingPhase;
  }

  async function saveMicroBuilder() {
    const name = microBuilder.name.trim();
    if (!name) {
      setTemplatesError("Nombre requerido.");
      return;
    }
    setFeedback("");
    try {
      await createPlanningTemplate({
        level: "micro",
        name,
        duration_days: microBuilder.duration,
        blocks: microBuilder.slots.map((slot, idx) => {
          const routine = slot.routineId ? routineMap.get(slot.routineId) || null : null;
          return {
            sequence_index: idx + 1,
            relative_day: slot.index,
            title: slot.title || `Sesion ${slot.index}`,
            routine_snapshot: routine
              ? {
                  routine_id: routine.id,
                  routine_name: routine.name,
                  exercises: routine.exercises,
                }
              : undefined,
          };
        }),
      });
      setFeedback("Microciclo guardado.");
      await refreshTemplates();
    } catch (cause: unknown) {
      setTemplatesError(String((cause as { message?: string })?.message || cause));
    }
  }

  async function saveLinkBuilder(level: "meso" | "macro") {
    const builder = level === "meso" ? mesoBuilder : macroBuilder;
    const name = builder.name.trim();
    if (!name) {
      setTemplatesError("Nombre requerido.");
      return;
    }
    const focusTag = builderFocusTag(builder);
    setFeedback("");

    const selected = builder.slots.filter((slot) => slot.childTemplateId);
    if (selected.length === 0) {
      setTemplatesError(level === "meso" ? "Debes seleccionar al menos un ciclo." : "Debes seleccionar al menos un bloque.");
      return;
    }

    try {
      const created = await createPlanningTemplate({
        level,
        name,
        objective: builder.objective.trim() || undefined,
        focus_tags: focusTag ? [focusTag] : undefined,
        training_phase: builderTrainingPhase(builder),
        duration_weeks: builder.duration,
      });

      for (const slot of selected) {
        await linkPlanningTemplateChild(created.id, {
          child_template_id: slot.childTemplateId,
          order_index: slot.index,
        });
      }

      setFeedback(`${levelLabel(level)} guardado.`);
      await refreshTemplates();
      await loadTree(created.id);
    } catch (cause: unknown) {
      setTemplatesError(String((cause as { message?: string })?.message || cause));
    }
  }
  async function deleteTemplateItem(templateId: string) {
    if (!window.confirm("Confirma eliminar esta plantilla.")) return;
    const template =
      templates.micro.find((item) => item.id === templateId) ||
      templates.meso.find((item) => item.id === templateId) ||
      templates.macro.find((item) => item.id === templateId) ||
      null;
    if (!template) return;

    const level = template.level;
    setTemplates((prev) => ({
      ...prev,
      [level]: prev[level].filter((entry) => entry.id !== templateId),
    }));
    if (treeData?.id === templateId) {
      setTreeData(null);
    }
    setTemplatesError("");
    setFeedback("Plantilla eliminada. Puedes deshacer.");

    const timeoutMs = 7000;
    const commitDelayMs = timeoutMs + 200;
    const timerId = window.setTimeout(async () => {
      pendingDeleteTimerByTemplateRef.current.delete(templateId);
      try {
        await deletePlanningTemplate(templateId);
      } catch (cause: unknown) {
        setTemplates((prev) => {
          if (prev[level].some((entry) => entry.id === templateId)) return prev;
          return {
            ...prev,
            [level]: [...prev[level], template],
          };
        });
        setTemplatesError(String((cause as { message?: string })?.message || cause));
      }
    }, commitDelayMs);
    pendingDeleteTimerByTemplateRef.current.set(templateId, timerId);

    registerUndo({
      message: `Plantilla "${template.name}" eliminada.`,
      timeoutMs,
      onUndo: async () => {
        const pendingTimer = pendingDeleteTimerByTemplateRef.current.get(templateId);
        if (pendingTimer) {
          window.clearTimeout(pendingTimer);
          pendingDeleteTimerByTemplateRef.current.delete(templateId);
        }

        setTemplates((prev) => {
          if (prev[level].some((entry) => entry.id === templateId)) return prev;
          return {
            ...prev,
            [level]: [...prev[level], template],
          };
        });
        setTemplatesError("");
        setFeedback("Eliminacion de plantilla deshecha.");
      },
    });
  }

  async function submitAssignment() {
    if (!assignmentAthleteId || !assignmentTemplateId) return;
    try {
      await createPlanningAssignment({
        athlete_id: assignmentAthleteId,
        template_id: assignmentTemplateId,
        start_mode: startMode,
        start_date: startMode === "manual" ? startDate || null : null,
        tolerance_days: Math.max(0, Number(toleranceDays) || 2),
        timezone: timezone || "UTC",
      });
      setFeedback("Asignacion creada.");
      await refreshAssignments(assignmentAthleteId);
    } catch (cause: unknown) {
      setTemplatesError(String((cause as { message?: string })?.message || cause));
    }
  }

  async function reconcileAndRefresh(assignmentId: string) {
    try {
      await reconcilePlanningAssignment(assignmentId);
      if (athleteId) await refreshAssignments(athleteId);
      await loadAssignmentDetail(assignmentId);
    } catch (cause: unknown) {
      setTemplatesError(String((cause as { message?: string })?.message || cause));
    }
  }

  async function changeAssignmentStatus(assignmentId: string, status: CycleStatus) {
    try {
      await patchPlanningAssignmentStatus(assignmentId, status);
      if (athleteId) await refreshAssignments(athleteId);
      await loadAssignmentDetail(assignmentId);
    } catch (cause: unknown) {
      setTemplatesError(String((cause as { message?: string })?.message || cause));
    }
  }

  function renderTemplateCards(level: CycleLevel) {
    const levelTemplates = templates[level];
    if (levelTemplates.length === 0) {
      return <div className="emptyState">Sin plantillas guardadas en este nivel.</div>;
    }

    const unitLabel = level === "micro" ? "Sesiones" : level === "meso" ? "Ciclos" : "Bloques";

    return (
      <div className="gridCards">
        {levelTemplates.map((item) => (
          <article key={item.id} className="surfaceButton">
            <strong>{item.name}</strong>
            <span className="small">{`Estado: ${statusLabel(item.status)}`}</span>
            <span className="small">{`${unitLabel}: ${item.duration_days || item.duration_weeks || "-"}`}</span>
            <div className="quickActions">
              <button className="btn" onClick={() => void loadTree(item.id)}>
                Ver estructura
              </button>
              <button className="btn" onClick={() => void deleteTemplateItem(item.id)}>
                Borrar
              </button>
            </div>
          </article>
        ))}
      </div>
    );
  }

  function renderObjectiveControls(
    builder: BuilderConfig,
    onSelectPreset: (presetId: string) => void,
    onObjectiveChange: (value: string) => void,
  ) {
    return (
      <>
        <label className="smallLabel">Categoria / objetivo base</label>
        <div className="chipRow">
          {OBJECTIVE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`chipButton ${builder.objectivePresetId === preset.id ? "activeChipButton" : ""}`}
              onClick={() => onSelectPreset(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <label className="smallLabel">Objetivo final</label>
        <input
          className="input"
          value={builder.objective}
          onChange={(e) => onObjectiveChange(e.target.value)}
          placeholder="Puedes personalizar el objetivo aqui"
        />
      </>
    );
  }

  function renderMicroTab() {
    return (
      <section className="surface stack">
        <div className="planningTopRow">
          <div className="sectionHead">
            <h3>Microciclo</h3>
          </div>
          <div className="quickActions">
            <button className="btn" onClick={() => resetBuilder("micro")}>
              Nuevo limpio
            </button>
            <button className="btn primary" onClick={() => void saveMicroBuilder()}>
              Guardar microciclo
            </button>
          </div>
        </div>

        <div className="planningEditor">
          <aside className="planningConfigCard">
            <label className="smallLabel">Nombre</label>
            <input
              className="input"
              value={microBuilder.name}
              onChange={(e) => updateMicroConfig({ name: e.target.value })}
            />

            <label className="smallLabel">{durationLabel("micro")}</label>
            <input
              className="input"
              type="number"
              min={1}
              value={microBuilder.duration}
              onChange={(e) => updateMicroDuration(e.target.value)}
              inputMode="numeric"
            />
          </aside>

          <div className="planningEditorMain">
            <div className="planningHeaderCard">
              <strong>{microBuilder.name || "Microciclo sin nombre"}</strong>
              <span className="small">{`Sesiones: ${microBuilder.duration}`}</span>
            </div>

            <div className="planningMosaic">
              {microBuilder.slots.map((slot) => {
                const routineName = slot.routineId ? routineMap.get(slot.routineId)?.name : "";
                return (
                  <button
                    key={`micro_slot_${slot.index}`}
                    className={`planningSquare ${selectedMicroSlot === slot.index ? "active" : ""}`}
                    onClick={() => setSelectedMicroSlot(slot.index)}
                  >
                    <span className="planningSquareIdx">{`S${slot.index}`}</span>
                    <strong>{slot.title || `Sesion ${slot.index}`}</strong>
                    <span className="small">{routineName || "Sin rutina"}</span>
                  </button>
                );
              })}
            </div>

            {selectedMicroSlotData ? (
              <aside className="planningInspector">
                <h4>{`Sesion ${selectedMicroSlotData.index}`}</h4>
                <label className="smallLabel">Titulo</label>
                <input
                  className="input"
                  value={selectedMicroSlotData.title}
                  onChange={(e) => updateMicroSlot(selectedMicroSlotData.index, { title: e.target.value })}
                />

                <label className="smallLabel">Rutina</label>
                <select
                  className="input"
                  value={selectedMicroSlotData.routineId}
                  onChange={(e) => updateMicroSlot(selectedMicroSlotData.index, { routineId: e.target.value })}
                >
                  <option value="">Sin rutina</option>
                  {routines.map((routine) => (
                    <option key={routine.id} value={routine.id}>
                      {routine.name}
                    </option>
                  ))}
                </select>

                {routines.length === 0 ? (
                  <div className="small" style={{ marginTop: 8 }}>
                    No hay rutinas locales. Crea rutinas para asignarlas a las sesiones.
                  </div>
                ) : null}
              </aside>
            ) : null}
          </div>
        </div>

        {renderTemplateCards("micro")}
      </section>
    );
  }

  function renderHierarchyTab(level: "meso" | "macro") {
    const builder = level === "meso" ? mesoBuilder : macroBuilder;
    const selectedSlot = level === "meso" ? selectedMesoSlotData : selectedMacroSlotData;
    const setSelectedSlot = level === "meso" ? setSelectedMesoSlot : setSelectedMacroSlot;
    const childTemplates = level === "meso" ? templates.micro : templates.meso;
    const childMap = level === "meso" ? microTemplateMap : mesoTemplateMap;
    const sectionTitle = level === "meso" ? "Mesociclo" : "Macrociclo";
    const saveLabel = level === "meso" ? "Guardar mesociclo" : "Guardar macrociclo";
    const childLabel = level === "meso" ? "Ciclo" : "Bloque";
    const childLabelPlural = level === "meso" ? "Ciclos" : "Bloques";
    const usedIds = new Set(
      builder.slots
        .filter((slot) => slot.index !== selectedSlot?.index && slot.childTemplateId)
        .map((slot) => slot.childTemplateId),
    );
    const selectedCategory = OBJECTIVE_PRESET_MAP.get(builder.objectivePresetId)?.label || "Personalizado";
    const assignedBlocks = builder.slots.filter((slot) => slot.childTemplateId).length;

    return (
      <section className="surface stack">
        <div className="planningTopRow">
          <div className="sectionHead">
            <h3>{sectionTitle}</h3>
          </div>
          <div className="quickActions">
            <button className="btn" onClick={() => resetBuilder(level)}>
              Nuevo limpio
            </button>
            <button className="btn primary" onClick={() => void saveLinkBuilder(level)}>
              {saveLabel}
            </button>
          </div>
        </div>

        <div className="planningEditor">
          <aside className="planningConfigCard">
            <label className="smallLabel">Nombre</label>
            <input
              className="input"
              value={builder.name}
              onChange={(e) => updateLinkConfig(level, { name: e.target.value })}
            />

            <label className="smallLabel">{durationLabel(level)}</label>
            <input
              className="input"
              type="number"
              min={1}
              value={builder.duration}
              onChange={(e) => updateLinkDuration(level, e.target.value)}
              inputMode="numeric"
            />

            {renderObjectiveControls(
              builder,
              (presetId) => applyObjectivePresetToLink(level, presetId),
              (value) => updateLinkConfig(level, { objective: value }),
            )}
          </aside>

          <div className="planningEditorMain">
            <div className="planningHeaderCard">
              <strong>{builder.name || `${levelLabel(level)} sin nombre`}</strong>
              <span className="small">{`${childLabelPlural}: ${builder.duration}`}</span>
              <span className="small">{`Categoria: ${selectedCategory}`}</span>
              <span className="small">{`${childLabelPlural} asignados: ${assignedBlocks}/${builder.duration}`}</span>
              <span className="small">{builder.objective || "Sin objetivo"}</span>
            </div>

            <div className="planningMosaic">
              {builder.slots.map((slot) => (
                <button
                  key={`${level}_slot_${slot.index}`}
                  className={`planningSquare ${selectedSlot?.index === slot.index ? "active" : ""}`}
                  onClick={() => setSelectedSlot(slot.index)}
                >
                  <span className="planningSquareIdx">{`${level === "meso" ? "C" : "B"}${slot.index}`}</span>
                  <strong>{childMap.get(slot.childTemplateId)?.name || "Sin asignar"}</strong>
                  <span className="small">{childLabel}</span>
                </button>
              ))}
            </div>

            {selectedSlot ? (
              <aside className="planningInspector">
                <h4>{`${childLabel} ${selectedSlot.index}`}</h4>
                <label className="smallLabel">{childLabel}</label>
                <select
                  className="input"
                  value={selectedSlot.childTemplateId}
                  onChange={(e) => updateLinkSlot(level, selectedSlot.index, e.target.value)}
                >
                  <option value="">Sin asignar</option>
                  {childTemplates.map((item) => (
                    <option
                      key={item.id}
                      value={item.id}
                      disabled={usedIds.has(item.id) && item.id !== selectedSlot.childTemplateId}
                    >
                      {item.name}
                    </option>
                  ))}
                </select>
              </aside>
            ) : null}
          </div>
        </div>

        {renderTemplateCards(level)}
      </section>
    );
  }

  const trackingSummary = useMemo(() => {
    const total = assignments.length;
    const active = assignments.filter((item) => item.status === "active").length;
    const overdue = assignments.filter((item) =>
      (item.next_blocks || []).some((block) => !!block.target_date && Date.parse(String(block.target_date)) < Date.now()),
    ).length;

    const adherenceValues = assignments
      .map((item) => Number(item.adherence))
      .filter((value) => Number.isFinite(value));

    const atRisk = assignments.filter((item) => {
      const adherence = Number(item.adherence || 0);
      const hasOverdue = (item.next_blocks || []).some((block) => !!block.target_date && Date.parse(String(block.target_date)) < Date.now());
      return adherence < 0.7 || hasOverdue;
    }).length;

    const avgAdherence =
      adherenceValues.length > 0
        ? Number((adherenceValues.reduce((acc, value) => acc + value, 0) / adherenceValues.length).toFixed(3))
        : null;

    return { total, active, overdue, atRisk, avgAdherence };
  }, [assignments]);

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Planificacion</h1>
      </header>

      {templatesError ? <section className="message error">{templatesError}</section> : null}
      {feedback ? <section className="message">{feedback}</section> : null}

      <section className="surface">
        <div className="quickActions">
          <button className={`btn ${tab === "micro" ? "primary" : ""}`} onClick={() => setTab("micro")}>
            Microciclo
          </button>
          <button className={`btn ${tab === "meso" ? "primary" : ""}`} onClick={() => setTab("meso")}>
            Mesociclo
          </button>
          <button className={`btn ${tab === "macro" ? "primary" : ""}`} onClick={() => setTab("macro")}>
            Macrociclo
          </button>
          <button className={`btn ${tab === "assignments" ? "primary" : ""}`} onClick={() => setTab("assignments")}>
            Asignaciones
          </button>
          <button className={`btn ${tab === "tracking" ? "primary" : ""}`} onClick={() => setTab("tracking")}>
            Seguimiento
          </button>
          <button className="btn" onClick={() => void refreshTemplates()} disabled={loadingTemplates}>
            Refrescar
          </button>
        </div>
      </section>

      {tab === "micro" ? renderMicroTab() : null}
      {tab === "meso" ? renderHierarchyTab("meso") : null}
      {tab === "macro" ? renderHierarchyTab("macro") : null}

      {tab === "assignments" ? (
        <section className="surface stack">
          <div className="sectionHead">
            <h3>Asignar ciclo</h3>
          </div>
          <select className="input" value={assignmentAthleteId} onChange={(e) => setAssignmentAthleteId(e.target.value)}>
            <option value="">Sujeto</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.label}
              </option>
            ))}
          </select>
          <select className="input" value={assignmentTemplateId} onChange={(e) => setAssignmentTemplateId(e.target.value)}>
            <option value="">Plantilla</option>
            {allTemplates.map((item) => (
              <option key={item.id} value={item.id}>
                {`${item.name} (${levelLabel(item.level)})`}
              </option>
            ))}
          </select>
          <select className="input" value={startMode} onChange={(e) => setStartMode(e.target.value as CycleStartMode)}>
            <option value="auto_on_first_session">Inicio auto (primera sesion)</option>
            <option value="manual">Inicio manual</option>
          </select>
          {startMode === "manual" ? (
            <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          ) : null}
          <input
            className="input"
            value={toleranceDays}
            onChange={(e) => setToleranceDays(e.target.value)}
            placeholder="Tolerancia dias"
          />
          <input className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Timezone" />
          <div className="quickActions">
            <button
              className="btn primary"
              onClick={() => void submitAssignment()}
              disabled={!assignmentAthleteId || !assignmentTemplateId}
            >
              Crear asignacion
            </button>
            <button className="btn" onClick={() => athleteId && void refreshAssignments(athleteId)} disabled={!athleteId}>
              Recargar
            </button>
          </div>
        </section>
      ) : null}

      {tab === "tracking" ? (
        <section className="surface stack">
          <div className="sectionHead">
            <h3>Seguimiento</h3>
          </div>

          <div className="statsGrid" style={{ marginTop: 10 }}>
            <article className="statCard">
              <div className="smallLabel">Asignaciones</div>
              <strong>{trackingSummary.total}</strong>
            </article>
            <article className="statCard">
              <div className="smallLabel">Activas</div>
              <strong>{trackingSummary.active}</strong>
            </article>
            <article className="statCard">
              <div className="smallLabel">Con atraso</div>
              <strong>{trackingSummary.overdue}</strong>
            </article>
            <article className="statCard">
              <div className="smallLabel">En riesgo</div>
              <strong>{trackingSummary.atRisk}</strong>
            </article>
            <article className="statCard">
              <div className="smallLabel">Adherencia promedio</div>
              <strong>{trackingSummary.avgAdherence === null ? "-" : `${Math.round(trackingSummary.avgAdherence * 100)}%`}</strong>
            </article>
          </div>

          {loadingAssignments ? <div className="emptyState">Cargando asignaciones...</div> : null}
          {!loadingAssignments ? (
            <div className="gridCards">
              {assignments.map((item) => (
                <article key={item.id} className="surfaceButton">
                  <strong>{item.template_name || item.template_id}</strong>
                  <span className="small">{`${levelLabel(item.level)} | ${statusLabel(item.status)}`}</span>
                  <span className="small">{`Adherencia: ${Math.round((item.adherence || 0) * 100)}%`}</span>
                  <span className="small">
                    {`Riesgo: ${
                      (Number(item.adherence || 0) < 0.7 ||
                      (item.next_blocks || []).some((block) => !!block.target_date && Date.parse(String(block.target_date)) < Date.now()))
                        ? "alto"
                        : "controlado"
                    }`}
                  </span>
                  {(item.next_blocks || []).length > 0 ? (
                    <span className="small">
                      {`Proximo: ${(item.next_blocks || [])[0]?.title || "-"}${(item.next_blocks || [])[0]?.target_date ? ` (${(item.next_blocks || [])[0]?.target_date})` : ""}`}
                    </span>
                  ) : (
                    <span className="small">Sin proximos bloques</span>
                  )}
                  <div className="quickActions">
                    <button className="btn" onClick={() => setSelectedAssignmentId(item.id)}>
                      Detalle
                    </button>
                    <button className="btn" onClick={() => void reconcileAndRefresh(item.id)}>
                      Reconciliar
                    </button>
                    <button className="btn" onClick={() => void changeAssignmentStatus(item.id, "archived")}>
                      Archivar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}

          {selectedAssignmentId && assignmentDetail ? (
            <article className="surface">
              <div className="sectionHead">
                <h4>Detalle asignacion</h4>
                <p>{assignmentDetail.template_name || assignmentDetail.template_id}</p>
              </div>
              <div className="chipRow" style={{ marginTop: 10 }}>
                <span className="chip">{`Estado: ${statusLabel(assignmentDetail.status)}`}</span>
                <span className="chip">
                  {`${assignmentDetail.level === "micro" ? "Sesiones" : assignmentDetail.level === "meso" ? "Ciclos" : "Bloques"}: ${
                    assignmentDetail.blocks_completed || 0
                  }/${assignmentDetail.blocks_total || 0}`}
                </span>
                <button className="btn" onClick={() => void changeAssignmentStatus(selectedAssignmentId, "active")}>
                  Activar
                </button>
                <button className="btn" onClick={() => void changeAssignmentStatus(selectedAssignmentId, "completed")}>
                  Completar
                </button>
              </div>
              <div className="stack compactStack" style={{ marginTop: 10 }}>
                {assignmentDetail.blocks.slice(0, 12).map((block) => (
                  <article key={block.id} className="listItem">
                    <div className="listMain">
                      <strong>{block.title}</strong>
                      <span className="small">
                        {`${
                          assignmentDetail.level === "micro"
                            ? "Sesion"
                            : assignmentDetail.level === "meso"
                              ? "Ciclo"
                              : "Bloque"
                        } ${block.relative_day}`}
                      </span>
                    </div>
                    <div className="listMeta">
                      <span className="small">{`Estado: ${block.status}`}</span>
                      <span className="small">{`Objetivo: ${block.target_date || "-"}`}</span>
                    </div>
                  </article>
                ))}
              </div>
            </article>
          ) : null}

          {assignmentMetrics ? (
            <article className="surface">
              <div className="sectionHead">
                <h4>Metricas</h4>
              </div>
              <div className="statsGrid" style={{ marginTop: 10 }}>
                <article className="statCard">
                  <div className="smallLabel">Volumen</div>
                  <strong>{Math.round(assignmentMetrics.totals.volume_load_kg)}</strong>
                </article>
                <article className="statCard">
                  <div className="smallLabel">Fatiga</div>
                  <strong>{Math.round(assignmentMetrics.totals.fatigue_load)}</strong>
                </article>
                <article className="statCard">
                  <div className="smallLabel">Frecuencia</div>
                  <strong>{assignmentMetrics.totals.frequency_sessions}</strong>
                </article>
                <article className="statCard">
                  <div className="smallLabel">Adherencia</div>
                  <strong>{`${Math.round(assignmentMetrics.totals.adherence * 100)}%`}</strong>
                </article>
              </div>
            </article>
          ) : null}

          {overview ? (
            <article className="surface">
              <div className="sectionHead">
                <h4>Overview sujeto</h4>
                <p>{`Activos: ${overview.active_assignments.length}`}</p>
              </div>
              <ul className="compactList">
                {overview.active_assignments.slice(0, 5).map((item) => (
                  <li key={`ov_${item.id}`}>{`${item.template_name || item.template_id} (${statusLabel(item.status)})`}</li>
                ))}
              </ul>
            </article>
          ) : null}
        </section>
      ) : null}

      {treeLoading ? (
        <section className="surface">
          <div className="emptyState">Cargando estructura...</div>
        </section>
      ) : null}
      {!treeLoading && treeData ? (
        <section className="surface">
          <div className="sectionHead">
            <h3>Estructura guardada</h3>
          </div>
          <div style={{ marginTop: 10 }}>
            <TreeNode node={treeData} />
          </div>
        </section>
      ) : null}

    </div>
  );
}
