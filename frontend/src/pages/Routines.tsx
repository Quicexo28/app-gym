import { useEffect, useMemo, useRef, useState } from "react";

import {
  ALL_EXERCISE_FILTER as ALL,
  ALL_EXERCISE_MOVEMENT_FILTER,
  ALL_EXERCISE_ZONE_FILTER,
  buildExerciseCatalogBrowser,
  tokenizeExerciseSearch,
  type ExerciseBodyZoneFilter,
  type ExerciseCatalogEntry,
  type ExerciseFilters,
} from "../lib/exerciseCatalog";
import {
  formatSetsRange,
  listRoutinePropagationTargets,
  loadRoutines,
  parseSetsRangeText,
  propagateRoutineUpdate,
  ROUTINES_HYDRATED_EVENT,
  saveRoutines,
  uid,
} from "../lib/storage";
import KebabMenu from "../components/KebabMenu";
import { useConfirm } from "../lib/useConfirm";
import type { RoutineExerciseTemplate, RoutineTemplate } from "../lib/storage";
import { useExerciseCatalog } from "../state/exerciseCatalog";
import { useAthleteAccess } from "../state/athlete";
import { useUndo } from "../state/undo";
import { useViewScopes } from "../state/viewScopes";
import { buildTree, toTreeItems } from "../lib/exerciseTree";
import { buildCatalogGroupByName, buildNonLeafPathKeys, pathKey } from "../lib/routines/catalog";
import {
  cloneRoutine,
  DEFAULT_REST_SECONDS,
  DEFAULT_TARGET_REPS_MAX,
  DEFAULT_TARGET_REPS_MIN,
  DEFAULT_TARGET_SETS,
  inferLegacyExerciseGroup,
  normalizeDraftRestSeconds,
  normalizeGroupLabel,
  normalizeLookupText,
  parseBoundedInt,
  routineExerciseIdentity,
  splitRestSeconds,
  toDraftExercise,
  type DraftExercisePatch,
  type DraftRoutineExercise,
} from "../lib/routines/draft";
import { buildRoutineRadar, buildRoutineSeriesByGroup, routineSummaryLine } from "../lib/routines/summary";
import DraftExerciseCard from "./routines/DraftExerciseCard";
import ExercisePickerModal from "./routines/ExercisePickerModal";
import RoutineInfoModal from "./routines/RoutineInfoModal";
import { useDraftDrag } from "./routines/useDraftDrag";

export default function Routines() {
  const { confirm, dialog } = useConfirm();
  const { athleteId, subjects } = useAthleteAccess();
  const { coachView } = useViewScopes();
  const { loading, syncError, entries: catalogEntries } = useExerciseCatalog();
  const { registerUndo } = useUndo();
  const [items, setItems] = useState<RoutineTemplate[]>(() => (athleteId ? loadRoutines(athleteId) : []));
  const [name, setName] = useState("");
  const [draftExercises, setDraftExercises] = useState<DraftRoutineExercise[]>([]);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [editingRoutineId, setEditingRoutineId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // El formulario de creacion ya no vive abierto encima de la lista: se abre
  // con "+ Nueva rutina" o al editar una existente.
  const [builderOpen, setBuilderOpen] = useState(false);
  const [infoRoutineId, setInfoRoutineId] = useState<string | null>(null);
  const [openCardMenuIdentity, setOpenCardMenuIdentity] = useState<string | null>(null);
  const {
    draggedExerciseIdentity,
    dropSlotIndex,
    dragArmedExerciseIdentity,
    clearDragState,
    resetDragState,
    handleSortableListDragOverCapture,
    handleExercisePointerDown,
    handleExercisePointerRelease,
    handleExerciseDragStart,
    handleDropSlotDragOver,
    handleDropSlotDrop,
  } = useDraftDrag(setDraftExercises);

  const [selectedGroup, setSelectedGroup] = useState<string>(ALL);
  const [selectedZone, setSelectedZone] = useState<ExerciseBodyZoneFilter>(ALL_EXERCISE_ZONE_FILTER);
  const [search, setSearch] = useState("");
  const athleteIdRef = useRef<string | null>(athleteId);

  const filters = useMemo<ExerciseFilters>(
    () => ({
      group: ALL,
      zone: selectedZone,
      movement: ALL_EXERCISE_MOVEMENT_FILTER,
      search,
    }),
    [search, selectedZone],
  );
  const browser = useMemo(() => buildExerciseCatalogBrowser(catalogEntries, filters), [catalogEntries, filters]);
  const filteredEntries = browser.filteredEntries;
  const searchTokens = useMemo(() => tokenizeExerciseSearch(search), [search]);
  const treeItems = useMemo(() => toTreeItems(filteredEntries, searchTokens), [filteredEntries, searchTokens]);
  const tree = useMemo(() => buildTree(treeItems, searchTokens.length > 0), [treeItems, searchTokens.length]);
  const activeRootLabel = useMemo(() => {
    if (selectedGroup === ALL) return null;
    return tree.some((node) => node.label === selectedGroup) ? selectedGroup : null;
  }, [selectedGroup, tree]);
  const nonLeafPathKeys = useMemo(() => buildNonLeafPathKeys(catalogEntries), [catalogEntries]);
  const subjectLabelById = useMemo(() => new Map(subjects.map((subject) => [subject.id, subject.label])), [subjects]);

  const sorted = useMemo(() => [...items].sort((a, b) => a.name.localeCompare(b.name)), [items]);
  const isEditing = Boolean(editingRoutineId);
  const showBuilder = builderOpen || isEditing;
  const hasIncompleteRepsRange = useMemo(
    () =>
      draftExercises.some(
        (exercise) => exercise.target_reps_min.trim() === "" || exercise.target_reps_max.trim() === "",
      ),
    [draftExercises],
  );
  const hasIncompleteSeries = useMemo(
    () => draftExercises.some((exercise) => parseSetsRangeText(exercise.target_sets) === null),
    [draftExercises],
  );
  const canSaveRoutine =
    name.trim().length > 0 && draftExercises.length > 0 && !hasIncompleteRepsRange && !hasIncompleteSeries;
  const draftTotalSeries = useMemo(() => {
    const totals = draftExercises.reduce(
      (acc, exercise) => {
        const parsed = parseSetsRangeText(exercise.target_sets);
        if (!parsed) return acc;
        return { min: acc.min + parsed.min, max: acc.max + parsed.max };
      },
      { min: 0, max: 0 },
    );
    return formatSetsRange(totals.min, totals.max);
  }, [draftExercises]);
  const infoRoutine = useMemo(
    () => sorted.find((routine) => routine.id === infoRoutineId) || null,
    [infoRoutineId, sorted],
  );
  const catalogGroupByName = useMemo(() => buildCatalogGroupByName(catalogEntries), [catalogEntries]);
  const infoRoutineSeriesByGroup = useMemo(() => {
    if (!infoRoutine) return [];
    return buildRoutineSeriesByGroup(infoRoutine, catalogGroupByName);
  }, [catalogGroupByName, infoRoutine]);
  const infoRoutineMaxSeries = useMemo(() => {
    if (infoRoutineSeriesByGroup.length === 0) return 1;
    return Math.max(...infoRoutineSeriesByGroup.map((entry) => entry.sets), 1);
  }, [infoRoutineSeriesByGroup]);
  const infoRoutineRadar = useMemo(
    () => buildRoutineRadar(infoRoutineSeriesByGroup, infoRoutineMaxSeries),
    [infoRoutineMaxSeries, infoRoutineSeriesByGroup],
  );

  useEffect(() => {
    athleteIdRef.current = athleteId;
  }, [athleteId]);

  // Reset sincronizado durante render al cambiar de sujeto (evita efecto + setState).
  const [renderedAthleteId, setRenderedAthleteId] = useState(athleteId);
  if (renderedAthleteId !== athleteId) {
    setRenderedAthleteId(athleteId);
    setItems(athleteId ? loadRoutines(athleteId) : []);
    setName("");
    setDraftExercises([]);
    setEditingRoutineId(null);
    setInfoRoutineId(null);
    resetDragState();
    if (athleteId) {
      setError("");
      setFeedback("");
    }
  }

  useEffect(() => {
    const onHydrated = () => {
      const current = athleteIdRef.current;
      if (current) setItems(loadRoutines(current));
    };
    window.addEventListener(ROUTINES_HYDRATED_EVENT, onHydrated);
    return () => window.removeEventListener(ROUTINES_HYDRATED_EVENT, onHydrated);
  }, []);

  function isLeafEntry(entry: ExerciseCatalogEntry): boolean {
    return !nonLeafPathKeys.has(pathKey(entry.path));
  }


  useEffect(() => {
    if (!openCardMenuIdentity) return;

    const onPointerDownOutside = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-card-menu]")) return;
      setOpenCardMenuIdentity(null);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenCardMenuIdentity(null);
    };

    window.addEventListener("pointerdown", onPointerDownOutside, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDownOutside, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openCardMenuIdentity]);

  function addSelectedExercise(entry: ExerciseCatalogEntry) {
    if (!isLeafEntry(entry)) {
      setError("Selecciona una rama final del catálogo para agregar el ejercicio.");
      return;
    }

    const next = entry.name;
    const nextIdentity = routineExerciseIdentity({ name: next, group: entry.group });
    // Se decide con el estado actual: el updater de setState corre mas tarde y no
    // sirve para saber aqui si se agrego (antes el modal nunca se cerraba).
    const duplicated = draftExercises.some((value) => routineExerciseIdentity(value) === nextIdentity);
    setError(duplicated ? "Ese ejercicio ya está en la rutina." : "");
    if (!duplicated) {
      setDraftExercises((prev) => [
        ...prev,
        {
          name: next,
          group: entry.group,
          target_sets: String(DEFAULT_TARGET_SETS),
          target_reps_min: String(DEFAULT_TARGET_REPS_MIN),
          target_reps_max: String(DEFAULT_TARGET_REPS_MAX),
          ...splitRestSeconds(DEFAULT_REST_SECONDS),
        },
      ]);
    }
  }

  function removeDraftExercise(identityValue: string) {
    if (draggedExerciseIdentity === identityValue || dragArmedExerciseIdentity === identityValue) {
      clearDragState();
    }
    setOpenCardMenuIdentity(null);
    setDraftExercises((prev) => prev.filter((entry) => routineExerciseIdentity(entry) !== identityValue));
  }

  function applyDraftSettingsToAll(identityValue: string) {
    setOpenCardMenuIdentity(null);

    const source = draftExercises.find((entry) => routineExerciseIdentity(entry) === identityValue);
    if (!source || draftExercises.length < 2) return;

    const previousDraft = draftExercises;
    setDraftExercises((prev) =>
      prev.map((entry) => ({
        ...entry,
        target_sets: source.target_sets,
        target_reps_min: source.target_reps_min,
        target_reps_max: source.target_reps_max,
        rest_minutes: source.rest_minutes,
        rest_seconds: source.rest_seconds,
      })),
    );

    const affected = draftExercises.length - 1;
    setError("");
    setFeedback(`Ajustes aplicados a ${affected} ejercicio${affected === 1 ? "" : "s"}.`);
    registerUndo({
      message: "Ajustes aplicados a todos los ejercicios.",
      onUndo: () => {
        setDraftExercises(previousDraft);
        setFeedback("Ajustes restaurados.");
        setError("");
      },
    });
  }

  function updateDraftExercise(identityValue: string, patch: DraftExercisePatch) {
    if (patch.name !== undefined) {
      // Cambiar la lateralidad cambia el nombre: no puede chocar con otro ejercicio de la rutina.
      const source = draftExercises.find((entry) => routineExerciseIdentity(entry) === identityValue);
      const nextIdentity = source ? routineExerciseIdentity({ name: patch.name, group: source.group }) : identityValue;
      if (nextIdentity !== identityValue && draftExercises.some((entry) => routineExerciseIdentity(entry) === nextIdentity)) {
        setError("Ya existe ese ejercicio en la rutina con esa lateralidad.");
        return;
      }
      setError("");
    }
    setDraftExercises((prev) =>
      prev.map((entry) => (routineExerciseIdentity(entry) === identityValue ? { ...entry, ...patch } : entry)),
    );
  }

  function clearFilters() {
    setSelectedGroup(ALL);
    setSelectedZone(ALL_EXERCISE_ZONE_FILTER);
    setSearch("");
  }

  function selectGroupFromTree(groupValue: string) {
    setSelectedGroup((prev) => (prev === groupValue ? ALL : groupValue));
  }

  function openNewRoutineBuilder() {
    resetDraft();
    setBuilderOpen(true);
    setError("");
    setFeedback("");
  }

  function resetDraft() {
    setBuilderOpen(false);
    setName("");
    setDraftExercises([]);
    setEditingRoutineId(null);
    resetDragState();
    setOpenCardMenuIdentity(null);
  }

  function startEditRoutine(routine: RoutineTemplate) {
    setBuilderOpen(true);
    setEditingRoutineId(routine.id);
    setName(routine.name);
    setDraftExercises(routine.exercises.map((exercise) => toDraftExercise(exercise)));
    resetDragState();
    setError("");
    setFeedback("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveRoutineDraft() {
    setError("");
    setFeedback("");
    const trimmed = name.trim();

    if (!athleteId) {
      setError("Selecciona un sujeto activo para gestionar rutinas.");
      return;
    }

    if (!trimmed) {
      setError("Escribe un nombre para la rutina.");
      return;
    }

    if (draftExercises.length === 0) {
      setError("Agrega al menos un ejercicio.");
      return;
    }

    const hasMissingReps = draftExercises.some(
      (exercise) => exercise.target_reps_min.trim() === "" || exercise.target_reps_max.trim() === "",
    );
    if (hasMissingReps) {
      setError("Completa Reps min y Reps max en todos los ejercicios antes de guardar.");
      return;
    }

    const hasInvalidSeries = draftExercises.some((exercise) => parseSetsRangeText(exercise.target_sets) === null);
    if (hasInvalidSeries) {
      setError("Completa el campo Series en todos los ejercicios antes de guardar (ej: 3 o 3-4).");
      return;
    }

    const exists = items.some(
      (entry) => entry.name.toLowerCase() === trimmed.toLowerCase() && entry.id !== editingRoutineId,
    );
    if (exists) {
      setError("Ya existe una rutina con ese nombre.");
      return;
    }

    const normalizedExercises: RoutineExerciseTemplate[] = draftExercises.map((exercise) => {
      const parsedMin = parseBoundedInt(exercise.target_reps_min, DEFAULT_TARGET_REPS_MIN, 1, 100);
      const parsedMax = parseBoundedInt(exercise.target_reps_max, DEFAULT_TARGET_REPS_MAX, 1, 100);
      const parsedSets = parseSetsRangeText(exercise.target_sets) ?? {
        min: DEFAULT_TARGET_SETS,
        max: DEFAULT_TARGET_SETS,
      };
      const explicitGroup = normalizeGroupLabel(exercise.group);
      const inferredGroup =
        inferLegacyExerciseGroup(exercise.name) || catalogGroupByName.get(normalizeLookupText(exercise.name)) || "";
      const nextGroup = explicitGroup || inferredGroup;

      return {
        name: exercise.name,
        group: nextGroup || undefined,
        target_sets_min: parsedSets.min,
        target_sets_max: parsedSets.max,
        target_reps_min: Math.min(parsedMin, parsedMax),
        target_reps_max: Math.max(parsedMin, parsedMax),
        rest_seconds: normalizeDraftRestSeconds(exercise),
      };
    });

    const timestamp = new Date().toISOString();

    if (editingRoutineId) {
      const sourceAthleteId = athleteId;
      const previous = items.find((entry) => entry.id === editingRoutineId);
      if (!previous) {
        setError("No se encontro la rutina seleccionada para editar.");
        return;
      }
      const previousRoutine = cloneRoutine(previous);

      const next = items.map((entry) =>
        entry.id !== editingRoutineId
          ? entry
          : {
              ...entry,
              name: trimmed,
              exercises: normalizedExercises,
              shared_routine_id: entry.shared_routine_id || uid("srt"),
              updated_at_utc: timestamp,
            },
      );

      const propagationSnapshots: Array<{ athlete_id: string; routine: RoutineTemplate }> = [];
      let propagationResult:
        | {
            updated_count: number;
            athlete_ids: string[];
          }
        | null = null;
      if (coachView) {
        const candidateAthleteIds = subjects.map((subject) => subject.id).filter((id) => id !== athleteId);
        const targets = listRoutinePropagationTargets({
          source_athlete_id: athleteId,
          source_routine_id: editingRoutineId,
          athlete_ids: candidateAthleteIds,
        });

        if (targets.length > 0) {
          const preview = targets
            .slice(0, 3)
            .map((target) => subjectLabelById.get(target.athlete_id) || target.athlete_id)
            .join(", ");
          const previewSuffix = targets.length > 3 ? ", ..." : "";
          const shouldPropagate = await confirm({
            title: "Actualizar a otros usuarios",
            message: `Desea actualizar esta rutina para todos tus usuarios que la posean?\nCoincidencias: ${targets.length} (${preview}${previewSuffix})`,
            confirmLabel: "Actualizar a todos",
            cancelLabel: "Solo esta",
          });

          if (shouldPropagate) {
            for (const target of targets) {
              const targetRoutine = loadRoutines(target.athlete_id).find((entry) => entry.id === target.routine_id);
              if (!targetRoutine) continue;
              propagationSnapshots.push({
                athlete_id: target.athlete_id,
                routine: cloneRoutine(targetRoutine),
              });
            }
            propagationResult = propagateRoutineUpdate({
              source_athlete_id: athleteId,
              source_routine_id: editingRoutineId,
              next_name: trimmed,
              next_exercises: normalizedExercises,
              athlete_ids: candidateAthleteIds,
            });
          }
        }
      }

      setItems(next);
      saveRoutines(next, athleteId);
      resetDraft();

      registerUndo({
        message:
          propagationResult && propagationResult.updated_count > 0
            ? `Se actualizaron ${propagationResult.updated_count} rutina(s).`
            : "Rutina actualizada.",
        onUndo: async () => {
          const sourceRoutines = loadRoutines(sourceAthleteId);
          let sourceRestored = false;
          const restoredSource = sourceRoutines.map((entry) => {
            if (entry.id !== previousRoutine.id) return entry;
            sourceRestored = true;
            return cloneRoutine(previousRoutine);
          });
          if (!sourceRestored) {
            restoredSource.push(cloneRoutine(previousRoutine));
          }
          saveRoutines(restoredSource, sourceAthleteId);

          for (const snapshot of propagationSnapshots) {
            const targetRoutines = loadRoutines(snapshot.athlete_id);
            let targetRestored = false;
            const restoredTarget = targetRoutines.map((entry) => {
              if (entry.id !== snapshot.routine.id) return entry;
              targetRestored = true;
              return cloneRoutine(snapshot.routine);
            });
            if (!targetRestored) {
              restoredTarget.push(cloneRoutine(snapshot.routine));
            }
            saveRoutines(restoredTarget, snapshot.athlete_id);
          }

          if (athleteIdRef.current === sourceAthleteId) {
            setItems(loadRoutines(sourceAthleteId));
          }
          setFeedback("Cambios de rutina deshechos.");
          setError("");
        },
      });

      if (propagationResult && propagationResult.updated_count > 0) {
        const updatedLabels = propagationResult.athlete_ids
          .map((id) => subjectLabelById.get(id) || id)
          .join(", ");
        setFeedback(`Rutina actualizada en ${propagationResult.athlete_ids.length} usuario(s): ${updatedLabels}.`);
      } else {
        setFeedback("Rutina actualizada.");
      }
      return;
    }

    const next: RoutineTemplate[] = [
      ...items,
      {
        id: uid("rt"),
        name: trimmed,
        exercises: normalizedExercises,
        created_at_utc: timestamp,
        shared_routine_id: uid("srt"),
        updated_at_utc: timestamp,
      },
    ];

    setItems(next);
    saveRoutines(next, athleteId);
    resetDraft();
    setFeedback("Rutina guardada.");
  }

  function duplicateRoutine(routine: RoutineTemplate) {
    if (!athleteId) return;
    const timestamp = new Date().toISOString();
    const copy: RoutineTemplate = {
      ...cloneRoutine(routine),
      id: uid("rt"),
      name: `${routine.name} (copia)`,
      created_at_utc: timestamp,
      updated_at_utc: timestamp,
      shared_routine_id: uid("srt"),
    };
    const next = [...items, copy];
    setItems(next);
    saveRoutines(next, athleteId);
    setFeedback("Rutina duplicada.");
  }

  function removeRoutine(id: string) {
    if (!athleteId) return;
    const sourceAthleteId = athleteId;
    const removedRoutine = items.find((entry) => entry.id === id);
    if (!removedRoutine) return;
    const next = items.filter((entry) => entry.id !== id);
    setItems(next);
    saveRoutines(next, athleteId);
    if (editingRoutineId === id) {
      resetDraft();
    }
    if (infoRoutineId === id) {
      setInfoRoutineId(null);
    }
    setFeedback("Rutina eliminada.");
    registerUndo({
      message: `Rutina "${removedRoutine.name}" eliminada.`,
      onUndo: async () => {
        const current = loadRoutines(sourceAthleteId);
        if (current.some((entry) => entry.id === removedRoutine.id)) return;
        const restored = [...current, cloneRoutine(removedRoutine)];
        saveRoutines(restored, sourceAthleteId);
        if (athleteIdRef.current === sourceAthleteId) {
          setItems(restored);
        }
        setFeedback("Rutina restaurada.");
        setError("");
      },
    });
  }

  return (
    <>
      {dialog}
      {syncError ? <div className="message error">{syncError}</div> : null}
      {error ? <div className="message error">{error}</div> : null}
      {feedback ? <div className="message">{feedback}</div> : null}

      {!athleteId ? (
        <section className="surface">
          <div className="emptyState">No hay sujeto seleccionado.</div>
        </section>
      ) : null}

      {athleteId && showBuilder ? (
        <section className="surface">
          <div className="sectionHead">
            <h3>{isEditing ? "Editar rutina" : "Nueva rutina"}</h3>
          </div>

          <label className="smallLabel">Nombre</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Push A" />

          <div className="routineBuilderBlock">
            <div className="sectionHead homeHead">
              <h3>Ejercicios</h3>
              {draftExercises.length > 0 ? (
                <span className="small">{`${draftExercises.length} · ${draftTotalSeries} series`}</span>
              ) : null}
            </div>
            {draftExercises.length > 1 ? (
              <p className="small">Mantén pulsado y arrastra para reordenar.</p>
            ) : null}


            {draftExercises.length === 0 ? (
              <button
                type="button"
                className="btn primary btnAddFirstExercise"
                style={{ marginTop: 12 }}
                onClick={() => setPickerOpen(true)}
              >
                + Agregar ejercicio
              </button>
            ) : (
              <div
                className={`treeLeafList routineSortableList ${draggedExerciseIdentity ? "routineSortableListDragging" : ""}`}
                style={{ marginTop: 12 }}
                onDragOverCapture={handleSortableListDragOverCapture}
              >
                {draftExercises.map((exercise, exerciseIndex) => {
                  const exerciseIdentity = routineExerciseIdentity(exercise);
                  return (
                    <DraftExerciseCard
                      key={`${exerciseIdentity}_${exerciseIndex}`}
                      exercise={exercise}
                      exerciseIdentity={exerciseIdentity}
                      exerciseIndex={exerciseIndex}
                      totalExercises={draftExercises.length}
                      isDragged={draggedExerciseIdentity === exerciseIdentity}
                      isDragArmed={dragArmedExerciseIdentity === exerciseIdentity}
                      menuOpen={openCardMenuIdentity === exerciseIdentity}
                      beforeSlotIsActive={dropSlotIndex === exerciseIndex}
                      onToggleMenu={(identity) =>
                        setOpenCardMenuIdentity((prev) => (prev === identity ? null : identity))
                      }
                      onApplyToAll={applyDraftSettingsToAll}
                      onRemove={removeDraftExercise}
                      onUpdate={updateDraftExercise}
                      onSlotDragOver={handleDropSlotDragOver}
                      onSlotDrop={handleDropSlotDrop}
                      onPointerDown={handleExercisePointerDown}
                      onPointerRelease={handleExercisePointerRelease}
                      onDragStart={handleExerciseDragStart}
                      onDragEnd={clearDragState}
                    />
                  );
                })}
                <div
                  className={`routineDropSlot ${dropSlotIndex === draftExercises.length ? "active" : ""}`}
                  onDragOver={(event) => handleDropSlotDragOver(event, draftExercises.length)}
                  onDragEnter={(event) => handleDropSlotDragOver(event, draftExercises.length)}
                  onDrop={(event) => handleDropSlotDrop(event, draftExercises.length)}
                />
              </div>
            )}

            {draftExercises.length > 0 ? (
              <button type="button" className="btn btnAddFirstExercise" style={{ marginTop: 12 }} onClick={() => setPickerOpen(true)}>
                + Agregar ejercicio
              </button>
            ) : null}
          </div>

          <div className="routineBuilderActions">
            <button className="btn primary" onClick={saveRoutineDraft} disabled={!canSaveRoutine}>
              {isEditing ? "Guardar cambios" : "Guardar rutina"}
            </button>
            <button className="btn ghost" onClick={resetDraft}>
              Cancelar
            </button>
            {loading ? <span className="small">Sincronizando...</span> : null}
          </div>
        </section>
      ) : null}

      {pickerOpen ? (
        <ExercisePickerModal
          selectedZone={selectedZone}
          selectedGroup={selectedGroup}
          search={search}
          catalogCount={catalogEntries.length}
          resultsCount={filteredEntries.length}
          tree={tree}
          expandAll={searchTokens.length > 0}
          activeRootLabel={activeRootLabel}
          onZoneChange={setSelectedZone}
          onSearchChange={setSearch}
          onClearFilters={clearFilters}
          onClose={() => setPickerOpen(false)}
          onAdd={addSelectedExercise}
          canAdd={isLeafEntry}
          isAdded={(entry) => {
            const id = routineExerciseIdentity({ name: entry.name, group: entry.group });
            return draftExercises.some((value) => routineExerciseIdentity(value) === id);
          }}
          addedCount={draftExercises.length}
          onSelectGroup={selectGroupFromTree}
        />
      ) : null}

      {infoRoutine ? (
        <RoutineInfoModal
          routine={infoRoutine}
          seriesByGroup={infoRoutineSeriesByGroup}
          maxSeries={infoRoutineMaxSeries}
          radar={infoRoutineRadar}
          onClose={() => setInfoRoutineId(null)}
        />
      ) : null}

      {athleteId && !showBuilder ? (
        <div className="routineCards">
          <div className="routineCardsHead">
            <button type="button" className="btn" onClick={openNewRoutineBuilder}>
              + Nueva rutina
            </button>
          </div>
          {sorted.length === 0 ? (
            <section className="surface">
              <div className="emptyState">Aún no tienes rutinas guardadas.</div>
            </section>
          ) : (
            sorted.map((routine) => (
              <section key={routine.id} className="surface routineCard">
                <button type="button" className="rowMain" onClick={() => setInfoRoutineId(routine.id)}>
                  <strong>{routine.name}</strong>
                  <span className="small">{routineSummaryLine(routine)}</span>
                </button>
                <KebabMenu
                  ariaLabel={`Opciones de ${routine.name}`}
                  actions={[
                    { label: "Ver detalle", onSelect: () => setInfoRoutineId(routine.id) },
                    { label: "Editar", onSelect: () => startEditRoutine(routine) },
                    { label: "Duplicar", onSelect: () => duplicateRoutine(routine) },
                    { label: "Eliminar", destructive: true, onSelect: () => removeRoutine(routine.id) },
                  ]}
                />
              </section>
            ))
          )}
        </div>
      ) : null}
    </>
  );
}
