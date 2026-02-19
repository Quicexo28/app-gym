import { useCallback, useEffect, useMemo, useState } from "react";

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

type PlanningTab = "micro" | "meso" | "macro" | "assignments" | "tracking";

type BuilderConfig = {
  name: string;
  objective: string;
  duration: number;
};

type MicroSlot = {
  index: number;
  title: string;
  objective: string;
  routineId: string;
};

type LinkSlot = {
  index: number;
  childTemplateId: string;
};

type MicroBuilder = BuilderConfig & {
  slots: MicroSlot[];
};

type LinkBuilder = BuilderConfig & {
  slots: LinkSlot[];
};

function levelLabel(level: CycleLevel): string {
  if (level === "micro") return "Micro";
  if (level === "meso") return "Meso";
  return "Macro";
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
  if (level === "micro") return "Duracion relativa (dias)";
  if (level === "meso") return "Duracion relativa (bloques micro)";
  return "Duracion relativa (bloques meso)";
}

function makeMicroSlots(duration: number): MicroSlot[] {
  return Array.from({ length: duration }, (_, idx) => ({
    index: idx + 1,
    title: `Sesion ${idx + 1}`,
    objective: "",
    routineId: "",
  }));
}

function makeLinkSlots(duration: number): LinkSlot[] {
  return Array.from({ length: duration }, (_, idx) => ({
    index: idx + 1,
    childTemplateId: "",
  }));
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
                  <div className="small">{`Bloque ${block.relative_day}`}</div>
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
  const [tab, setTab] = useState<PlanningTab>("micro");

  const [templates, setTemplates] = useState<Record<CycleLevel, PlanningTemplateItem[]>>({
    micro: [],
    meso: [],
    macro: [],
  });
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templatesError, setTemplatesError] = useState("");
  const [feedback, setFeedback] = useState("");

  const [configOpen, setConfigOpen] = useState(false);
  const [configLevel, setConfigLevel] = useState<CycleLevel>("micro");
  const [configName, setConfigName] = useState("");
  const [configDuration, setConfigDuration] = useState(String(defaultDurationForLevel("micro")));
  const [configObjective, setConfigObjective] = useState("");

  const [microBuilder, setMicroBuilder] = useState<MicroBuilder | null>(null);
  const [mesoBuilder, setMesoBuilder] = useState<LinkBuilder | null>(null);
  const [macroBuilder, setMacroBuilder] = useState<LinkBuilder | null>(null);

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

  const routines = useMemo<RoutineTemplate[]>(() => loadRoutines(), []);
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
    () => microBuilder?.slots.find((slot) => slot.index === selectedMicroSlot) || null,
    [microBuilder, selectedMicroSlot],
  );
  const selectedMesoSlotData = useMemo(
    () => mesoBuilder?.slots.find((slot) => slot.index === selectedMesoSlot) || null,
    [mesoBuilder, selectedMesoSlot],
  );
  const selectedMacroSlotData = useMemo(
    () => macroBuilder?.slots.find((slot) => slot.index === selectedMacroSlot) || null,
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
      setTemplates({ micro, meso, macro });
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

  function openConfig(level: CycleLevel) {
    setConfigLevel(level);
    setConfigName("");
    setConfigObjective("");
    setConfigDuration(String(defaultDurationForLevel(level)));
    setConfigOpen(true);
  }

  function startBuilder() {
    const name = configName.trim();
    const duration = Math.max(1, Math.floor(Number(configDuration) || 0));
    if (!name) {
      setTemplatesError("Nombre requerido.");
      return;
    }
    if (!Number.isFinite(duration) || duration < 1) {
      setTemplatesError("Duracion invalida.");
      return;
    }

    if (configLevel === "micro") {
      setMicroBuilder({
        name,
        objective: configObjective.trim(),
        duration,
        slots: makeMicroSlots(duration),
      });
      setSelectedMicroSlot(1);
      setTab("micro");
    } else if (configLevel === "meso") {
      setMesoBuilder({
        name,
        objective: configObjective.trim(),
        duration,
        slots: makeLinkSlots(duration),
      });
      setSelectedMesoSlot(1);
      setTab("meso");
    } else {
      setMacroBuilder({
        name,
        objective: configObjective.trim(),
        duration,
        slots: makeLinkSlots(duration),
      });
      setSelectedMacroSlot(1);
      setTab("macro");
    }

    setConfigOpen(false);
    setTemplatesError("");
    setFeedback(`${levelLabel(configLevel)} en configuracion.`);
  }

  function updateMicroSlot(index: number, patch: Partial<MicroSlot>) {
    setMicroBuilder((current) => {
      if (!current) return current;
      return {
        ...current,
        slots: current.slots.map((slot) => (slot.index === index ? { ...slot, ...patch } : slot)),
      };
    });
  }

  function updateLinkSlot(level: "meso" | "macro", index: number, childTemplateId: string) {
    const setter = level === "meso" ? setMesoBuilder : setMacroBuilder;
    setter((current) => {
      if (!current) return current;
      return {
        ...current,
        slots: current.slots.map((slot) => (slot.index === index ? { ...slot, childTemplateId } : slot)),
      };
    });
  }

  async function saveMicroBuilder() {
    if (!microBuilder) return;
    setFeedback("");
    try {
      await createPlanningTemplate({
        level: "micro",
        name: microBuilder.name,
        objective: microBuilder.objective || undefined,
        duration_days: microBuilder.duration,
        blocks: microBuilder.slots.map((slot, idx) => {
          const routine = slot.routineId ? routineMap.get(slot.routineId) || null : null;
          return {
            sequence_index: idx + 1,
            relative_day: slot.index,
            title: slot.title || `Sesion ${slot.index}`,
            objective: slot.objective || undefined,
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
      setMicroBuilder(null);
      await refreshTemplates();
    } catch (cause: unknown) {
      setTemplatesError(String((cause as { message?: string })?.message || cause));
    }
  }

  async function saveLinkBuilder(level: "meso" | "macro") {
    const builder = level === "meso" ? mesoBuilder : macroBuilder;
    if (!builder) return;
    setFeedback("");

    const selected = builder.slots.filter((slot) => slot.childTemplateId);
    if (selected.length === 0) {
      setTemplatesError("Debes seleccionar al menos un bloque.");
      return;
    }

    try {
      const created = await createPlanningTemplate({
        level,
        name: builder.name,
        objective: builder.objective || undefined,
        duration_weeks: builder.duration,
      });

      for (const slot of selected) {
        await linkPlanningTemplateChild(created.id, {
          child_template_id: slot.childTemplateId,
          order_index: slot.index,
        });
      }

      setFeedback(`${levelLabel(level)} guardado.`);
      if (level === "meso") setMesoBuilder(null);
      if (level === "macro") setMacroBuilder(null);
      await refreshTemplates();
      await loadTree(created.id);
    } catch (cause: unknown) {
      setTemplatesError(String((cause as { message?: string })?.message || cause));
    }
  }
  async function deleteTemplateItem(templateId: string) {
    if (!window.confirm("Confirma eliminar esta plantilla.")) return;
    try {
      await deletePlanningTemplate(templateId);
      setFeedback("Plantilla eliminada.");
      await refreshTemplates();
      if (treeData?.id === templateId) setTreeData(null);
    } catch (cause: unknown) {
      setTemplatesError(String((cause as { message?: string })?.message || cause));
    }
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

    return (
      <div className="gridCards">
        {levelTemplates.map((item) => (
          <article key={item.id} className="surfaceButton">
            <strong>{item.name}</strong>
            <span className="small">{`Estado: ${statusLabel(item.status)}`}</span>
            <span className="small">{`Duracion: ${item.duration_days || item.duration_weeks || "-"} (relativa)`}</span>
            <div className="quickActions">
              <button className="btn" onClick={() => void loadTree(item.id)}>
                Ver mosaico
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

  function renderMicroTab() {
    return (
      <section className="surface stack">
        <div className="planningTopRow">
          <div className="sectionHead">
            <h3>Microciclo</h3>
            <p>Flujo: crear nuevo microciclo - configurar - editar mosaico por bloques relativos.</p>
          </div>
          <button className="btn primary" onClick={() => openConfig("micro")}>
            Crear nuevo microciclo
          </button>
        </div>

        {!microBuilder ? (
          <div className="emptyState">
            Inicia con "Crear nuevo microciclo" para abrir la configuracion y construir el mosaico de bloques.
          </div>
        ) : (
          <div className="planningEditor">
            <div className="planningHeaderCard">
              <strong>{microBuilder.name}</strong>
              <span className="small">{`Duracion relativa: ${microBuilder.duration} bloques`}</span>
              <span className="small">{microBuilder.objective || "Sin objetivo"}</span>
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
                    <span className="planningSquareIdx">{`B${slot.index}`}</span>
                    <strong>{slot.title || `Sesion ${slot.index}`}</strong>
                    <span className="small">{routineName || "Sin rutina"}</span>
                  </button>
                );
              })}
            </div>

            {selectedMicroSlotData ? (
              <aside className="planningInspector">
                <h4>{`Bloque ${selectedMicroSlotData.index}`}</h4>
                <label className="smallLabel">Titulo</label>
                <input
                  className="input"
                  value={selectedMicroSlotData.title}
                  onChange={(e) => updateMicroSlot(selectedMicroSlotData.index, { title: e.target.value })}
                />

                <label className="smallLabel">Objetivo</label>
                <input
                  className="input"
                  value={selectedMicroSlotData.objective}
                  onChange={(e) => updateMicroSlot(selectedMicroSlotData.index, { objective: e.target.value })}
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
                    No hay rutinas locales. Crea rutinas primero para asignarlas a los bloques.
                  </div>
                ) : null}
              </aside>
            ) : null}

            <div className="quickActions">
              <button className="btn primary" onClick={() => void saveMicroBuilder()}>
                Guardar microciclo
              </button>
              <button className="btn" onClick={() => setMicroBuilder(null)}>
                Cancelar
              </button>
            </div>
          </div>
        )}

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
    const usedIds = new Set(
      (builder?.slots || [])
        .filter((slot) => slot.index !== selectedSlot?.index && slot.childTemplateId)
        .map((slot) => slot.childTemplateId),
    );

    return (
      <section className="surface stack">
        <div className="planningTopRow">
          <div className="sectionHead">
            <h3>{level === "meso" ? "Mesociclo" : "Macrociclo"}</h3>
            <p>{`Flujo: crear nuevo ${level}ciclo - configurar - mosaico de bloques relativos para escoger ${level === "meso" ? "microciclos" : "mesociclos"}.`}</p>
          </div>
          <button className="btn primary" onClick={() => openConfig(level)}>
            {`Crear nuevo ${level}ciclo`}
          </button>
        </div>

        {!builder ? (
          <div className="emptyState">
            {`Inicia con "Crear nuevo ${level}ciclo" para abrir configuracion y asignar los bloques del mosaico.`}
          </div>
        ) : (
          <div className="planningEditor">
            <div className="planningHeaderCard">
              <strong>{builder.name}</strong>
              <span className="small">{`Duracion relativa: ${builder.duration} bloques`}</span>
              <span className="small">{builder.objective || "Sin objetivo"}</span>
            </div>

            <div className="planningMosaic">
              {builder.slots.map((slot) => (
                <button
                  key={`${level}_slot_${slot.index}`}
                  className={`planningSquare ${selectedSlot?.index === slot.index ? "active" : ""}`}
                  onClick={() => setSelectedSlot(slot.index)}
                >
                  <span className="planningSquareIdx">{`B${slot.index}`}</span>
                  <strong>{childMap.get(slot.childTemplateId)?.name || "Sin asignar"}</strong>
                  <span className="small">{level === "meso" ? "Microciclo" : "Mesociclo"}</span>
                </button>
              ))}
            </div>

            {selectedSlot ? (
              <aside className="planningInspector">
                <h4>{`Bloque ${selectedSlot.index}`}</h4>
                <label className="smallLabel">{level === "meso" ? "Microciclo" : "Mesociclo"}</label>
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

            <div className="quickActions">
              <button className="btn primary" onClick={() => void saveLinkBuilder(level)}>
                {`Guardar ${level}ciclo`}
              </button>
              <button className="btn" onClick={() => (level === "meso" ? setMesoBuilder(null) : setMacroBuilder(null))}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {renderTemplateCards(level)}
      </section>
    );
  }
  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Planificacion</h1>
        <p>Vista tipo calendario/mosaico por bloques relativos. No se muestran fechas fijas en la construccion.</p>
      </header>

      {templatesError ? <section className="message error">{templatesError}</section> : null}
      {feedback ? <section className="message">{feedback}</section> : null}

      <section className="surface">
        <div className="quickActions">
          <button className={`btn ${tab === "micro" ? "primary" : ""}`} onClick={() => setTab("micro")}>
            Micro
          </button>
          <button className={`btn ${tab === "meso" ? "primary" : ""}`} onClick={() => setTab("meso")}>
            Meso
          </button>
          <button className={`btn ${tab === "macro" ? "primary" : ""}`} onClick={() => setTab("macro")}>
            Macro
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
            <p>Asigna plantillas creadas a sujetos accesibles.</p>
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
            <p>Reconciliacion, adherencia y metricas de los ciclos asignados.</p>
          </div>

          {loadingAssignments ? <div className="emptyState">Cargando asignaciones...</div> : null}
          {!loadingAssignments ? (
            <div className="gridCards">
              {assignments.map((item) => (
                <article key={item.id} className="surfaceButton">
                  <strong>{item.template_name || item.template_id}</strong>
                  <span className="small">{`${levelLabel(item.level)} | ${statusLabel(item.status)}`}</span>
                  <span className="small">{`Adherencia: ${Math.round((item.adherence || 0) * 100)}%`}</span>
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
                <span className="chip">{`Bloques: ${assignmentDetail.blocks_completed || 0}/${assignmentDetail.blocks_total || 0}`}</span>
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
                      <span className="small">{`Bloque relativo ${block.relative_day}`}</span>
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
                <p>Calculadas sobre sesiones reales.</p>
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
            <p>Mosaico/arbol de la plantilla seleccionada.</p>
          </div>
          <div style={{ marginTop: 10 }}>
            <TreeNode node={treeData} />
          </div>
        </section>
      ) : null}

      {configOpen ? (
        <div className="planningModalBackdrop">
          <section className="planningModalCard">
            <div className="sectionHead">
              <h3>{`Nuevo ${levelLabel(configLevel).toLowerCase()}ciclo`}</h3>
              <p>Configura la base y luego edita los cuadrados del mosaico relativo.</p>
            </div>
            <label className="smallLabel">Nombre</label>
            <input className="input" value={configName} onChange={(e) => setConfigName(e.target.value)} />
            <label className="smallLabel">{durationLabel(configLevel)}</label>
            <input
              className="input"
              value={configDuration}
              onChange={(e) => setConfigDuration(e.target.value)}
              inputMode="numeric"
            />
            <label className="smallLabel">Objetivo</label>
            <input className="input" value={configObjective} onChange={(e) => setConfigObjective(e.target.value)} />
            <div className="quickActions" style={{ marginTop: 10 }}>
              <button className="btn primary" onClick={startBuilder}>
                Continuar al mosaico
              </button>
              <button className="btn" onClick={() => setConfigOpen(false)}>
                Cancelar
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
