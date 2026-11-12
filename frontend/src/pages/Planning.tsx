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
import {
  CUSTOM_OBJECTIVE_PRESET_ID,
  OBJECTIVE_PRESET_MAP,
  buildBlankLinkBuilder,
  buildBlankMicroBuilder,
  builderFocusTag,
  builderTrainingPhase,
  errorMessage,
  levelLabel,
  parseDurationInput,
  resizeLinkSlots,
  resizeMicroSlots,
  type BuilderConfig,
  type BuilderLevel,
  type LinkBuilder,
  type MicroBuilder,
  type MicroSlot,
  type PlanningTab,
} from "../lib/planning/builders";
import { loadRoutines, type RoutineTemplate } from "../lib/storage";
import { useAthleteAccess } from "../state/athlete";
import { useUndo } from "../state/undo";
import AssignmentsTab from "./planning/AssignmentsTab";
import HierarchyTab from "./planning/HierarchyTab";
import MicroTab from "./planning/MicroTab";
import TemplateCards from "./planning/TemplateCards";
import TrackingTab from "./planning/TrackingTab";
import TreeNode from "./planning/TreeNode";
import "../styles.planning.css";

const PLANNING_TABS: ReadonlyArray<{ key: PlanningTab; label: string }> = [
  { key: "meso", label: "Mesociclo" },
  { key: "macro", label: "Macrociclo" },
  { key: "assignments", label: "Asignaciones" },
  { key: "tracking", label: "Seguimiento" },
];

export default function Planning() {
  const { athleteId, subjects } = useAthleteAccess();
  const { registerUndo } = useUndo();
  const pendingDeleteTimerByTemplateRef = useRef<Map<string, number>>(new Map());
  const [tab, setTab] = useState<PlanningTab>("micro");
  const [advancedOpen, setAdvancedOpen] = useState(false);

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

  // texto en edición para el campo "duración": permite dejarlo vacio mientras se escribe
  // sin forzar el mínimo en cada tecla (null = usar el valor numerico del builder)
  const [microDurationDraft, setMicroDurationDraft] = useState<string | null>(null);
  const [linkDurationDraft, setLinkDurationDraft] = useState<Record<"meso" | "macro", string | null>>({
    meso: null,
    macro: null,
  });

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
      setTemplatesError(errorMessage(cause));
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
      setTemplatesError(errorMessage(cause));
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
      setTemplatesError(errorMessage(cause));
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
      setTemplatesError(errorMessage(cause));
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
      setMicroDurationDraft(null);
    } else if (level === "meso") {
      setMesoBuilder(buildBlankLinkBuilder("meso"));
      setSelectedMesoSlot(1);
      setLinkDurationDraft((current) => ({ ...current, meso: null }));
    } else {
      setMacroBuilder(buildBlankLinkBuilder("macro"));
      setSelectedMacroSlot(1);
      setLinkDurationDraft((current) => ({ ...current, macro: null }));
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
    if (rawValue === "") {
      // deja el campo vacio mientras se escribe, sin tocar aún el builder
      setMicroDurationDraft("");
      return;
    }
    setMicroDurationDraft(null);
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
    if (rawValue === "") {
      setLinkDurationDraft((current) => ({ ...current, [level]: "" }));
      return;
    }
    setLinkDurationDraft((current) => ({ ...current, [level]: null }));
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
            title: slot.title || `Sesión ${slot.index}`,
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
      setTemplatesError(errorMessage(cause));
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
      setTemplatesError(errorMessage(cause));
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
        setTemplatesError(errorMessage(cause));
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
        setFeedback("Eliminación de plantilla deshecha.");
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
      setFeedback("Asignación creada.");
      await refreshAssignments(assignmentAthleteId);
    } catch (cause: unknown) {
      setTemplatesError(errorMessage(cause));
    }
  }

  async function reconcileAndRefresh(assignmentId: string) {
    try {
      await reconcilePlanningAssignment(assignmentId);
      if (athleteId) await refreshAssignments(athleteId);
      await loadAssignmentDetail(assignmentId);
    } catch (cause: unknown) {
      setTemplatesError(errorMessage(cause));
    }
  }

  async function changeAssignmentStatus(assignmentId: string, status: CycleStatus) {
    try {
      await patchPlanningAssignmentStatus(assignmentId, status);
      if (athleteId) await refreshAssignments(athleteId);
      await loadAssignmentDetail(assignmentId);
    } catch (cause: unknown) {
      setTemplatesError(errorMessage(cause));
    }
  }

  function cards(level: CycleLevel) {
    return (
      <TemplateCards
        level={level}
        templates={templates[level]}
        onViewTree={(id) => void loadTree(id)}
        onDelete={(id) => void deleteTemplateItem(id)}
      />
    );
  }

  function renderHierarchyTab(level: "meso" | "macro") {
    const isMeso = level === "meso";
    return (
      <HierarchyTab
        level={level}
        builder={isMeso ? mesoBuilder : macroBuilder}
        durationDraft={linkDurationDraft[level]}
        selectedSlot={isMeso ? selectedMesoSlotData : selectedMacroSlotData}
        childTemplates={isMeso ? templates.micro : templates.meso}
        childMap={isMeso ? microTemplateMap : mesoTemplateMap}
        templateCards={cards(level)}
        onSave={() => void saveLinkBuilder(level)}
        onReset={() => resetBuilder(level)}
        onConfigChange={(patch) => updateLinkConfig(level, patch)}
        onDurationChange={(value) => updateLinkDuration(level, value)}
        onDurationBlur={() =>
          setLinkDurationDraft((current) => ({
            ...current,
            [level]: current[level] === "" ? null : current[level],
          }))
        }
        onSelectPreset={(presetId) => applyObjectivePresetToLink(level, presetId)}
        onSelectSlot={isMeso ? setSelectedMesoSlot : setSelectedMacroSlot}
        onSlotChange={(index, childTemplateId) => updateLinkSlot(level, index, childTemplateId)}
      />
    );
  }

  return (
    <>
      {templatesError ? <section className="message error">{templatesError}</section> : null}
      {feedback ? <section className="message">{feedback}</section> : null}

      {/* Mismo lenguaje visual que el resto de hubs (pildoras de navegacion).
          El boton "Refrescar" salio de aqui: mezclaba una accion dentro de una
          fila de navegacion y ya se recarga solo al entrar y al guardar. */}
      <details
        className="planningAdvanced"
        open={advancedOpen}
        onToggle={(e) => {
          const isOpen = e.currentTarget.open;
          setAdvancedOpen(isOpen);
          if (!isOpen) setTab("micro");
          else if (tab === "micro") setTab("meso");
        }}
      >
        <summary>Avanzado</summary>
        <nav className="hubTabs" aria-label="Secciones avanzadas de programación">
          {PLANNING_TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`hubTab ${tab === item.key ? "active" : ""}`.trim()}
              aria-current={tab === item.key ? "page" : undefined}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </details>

      {loadingTemplates ? <div className="small">Cargando plantillas...</div> : null}

      {tab === "micro" ? (
        <MicroTab
          builder={microBuilder}
          durationDraft={microDurationDraft}
          selectedSlotIndex={selectedMicroSlot}
          selectedSlotData={selectedMicroSlotData}
          routines={routines}
          routineMap={routineMap}
          templateCards={cards("micro")}
          onSave={() => void saveMicroBuilder()}
          onReset={() => resetBuilder("micro")}
          onNameChange={(name) => updateMicroConfig({ name })}
          onDurationChange={updateMicroDuration}
          onDurationBlur={() => setMicroDurationDraft((draft) => (draft === "" ? null : draft))}
          onSelectSlot={setSelectedMicroSlot}
          onSlotChange={updateMicroSlot}
        />
      ) : null}
      {tab === "meso" ? renderHierarchyTab("meso") : null}
      {tab === "macro" ? renderHierarchyTab("macro") : null}

      {tab === "assignments" ? (
        <AssignmentsTab
          subjects={subjects}
          allTemplates={allTemplates}
          athleteId={athleteId}
          assignmentAthleteId={assignmentAthleteId}
          assignmentTemplateId={assignmentTemplateId}
          startMode={startMode}
          startDate={startDate}
          toleranceDays={toleranceDays}
          timezone={timezone}
          onAthleteChange={setAssignmentAthleteId}
          onTemplateChange={setAssignmentTemplateId}
          onStartModeChange={setStartMode}
          onStartDateChange={setStartDate}
          onToleranceChange={setToleranceDays}
          onTimezoneChange={setTimezone}
          onSubmit={() => void submitAssignment()}
          onReload={() => athleteId && void refreshAssignments(athleteId)}
        />
      ) : null}

      {tab === "tracking" ? (
        <TrackingTab
          loadingAssignments={loadingAssignments}
          assignments={assignments}
          selectedAssignmentId={selectedAssignmentId}
          assignmentDetail={assignmentDetail}
          assignmentMetrics={assignmentMetrics}
          overview={overview}
          onSelectAssignment={setSelectedAssignmentId}
          onReconcile={(id) => void reconcileAndRefresh(id)}
          onChangeStatus={(id, status) => void changeAssignmentStatus(id, status)}
        />
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
    </>
  );
}
