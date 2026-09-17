import { useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";

import {
  ALL_EXERCISE_FILTER as ALL,
  ALL_EXERCISE_MOVEMENT_FILTER,
  ALL_EXERCISE_ZONE_FILTER,
  buildExerciseCatalogBrowser,
  computeExerciseEntrySearchScore,
  EXERCISE_ZONE_LOWER,
  EXERCISE_ZONE_UPPER,
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
import { ChartPlaceholder } from "../components/Charts";
import KebabMenu from "../components/KebabMenu";
import Select from "../components/Select";
import type { RoutineExerciseTemplate, RoutineTemplate } from "../lib/storage";
import { useExerciseCatalog } from "../state/exerciseCatalog";
import { useAthleteAccess } from "../state/athlete";
import { useUndo } from "../state/undo";
import { useViewScopes } from "../state/viewScopes";

type MutableNode = {
  label: string;
  path: string[];
  children: Map<string, MutableNode>;
  items: TreeItem[];
};

type CatalogNode = {
  label: string;
  path: string[];
  children: CatalogNode[];
  items: TreeItem[];
  totalItems: number;
  maxScore: number;
};

type TreeItem = {
  entry: ExerciseCatalogEntry;
  treePath: string[];
  matchScore: number;
};

const DEFAULT_TARGET_SETS = 3;
const SERIES_SUGGESTIONS = ["1", "1-2", "2", "2-3", "3", "3-4", "4"];
const DEFAULT_TARGET_REPS_MIN = 8;
const DEFAULT_TARGET_REPS_MAX = 12;
const DEFAULT_REST_SECONDS = 90;
const MAX_REST_SECONDS = 900;
const MAX_REST_MINUTES = Math.floor(MAX_REST_SECONDS / 60);
const DRAG_HOLD_TO_REORDER_MS = 280;
const DRAG_AUTO_SCROLL_EDGE_PX = 92;
const DRAG_AUTO_SCROLL_MAX_STEP_PX = 16;

type DraftRoutineExercise = Omit<
  RoutineExerciseTemplate,
  "target_sets_min" | "target_sets_max" | "target_reps_min" | "target_reps_max" | "rest_seconds"
> & {
  target_sets: string;
  target_reps_min: string;
  target_reps_max: string;
  rest_minutes: string;
  rest_seconds: string;
};

type RoutineGroupSeries = {
  group: string;
  sets: number;
  ratio: number;
};

function formatExerciseNameForList(name: string): string {
  return name.replace(/\s*>\s*/g, " - ").trim();
}

function formatExercisePathForList(path: string[]): string {
  return path.map((segment) => formatExerciseNameForList(segment)).join(" - ");
}

function compactLabel(value: string, limit = 14): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, Math.max(1, limit - 1)).trimEnd()}...`;
}

function radarLabelAnchor(labelX: number, center: number): "start" | "middle" | "end" {
  if (labelX < center - 8) return "end";
  if (labelX > center + 8) return "start";
  return "middle";
}

function normalizePathSegment(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function pathKey(path: string[]): string {
  return path.map((segment) => normalizePathSegment(segment)).join(">");
}

function buildNonLeafPathKeys(items: ExerciseCatalogEntry[]): Set<string> {
  const nonLeafKeys = new Set<string>();

  for (const item of items) {
    for (let depth = 1; depth < item.path.length; depth += 1) {
      nonLeafKeys.add(pathKey(item.path.slice(0, depth)));
    }
  }

  return nonLeafKeys;
}

function toTreeItems(entries: ExerciseCatalogEntry[], searchTokens: string[]): TreeItem[] {
  return entries.map((entry) => {
    const matchScore = searchTokens.length > 0 ? computeExerciseEntrySearchScore(entry, searchTokens) : 0;
    return { entry, treePath: entry.path, matchScore };
  });
}

function parseBoundedInt(value: string, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function parseOptionalBoundedInt(value: string, min: number, max: number): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function clampRestSeconds(value: number): number {
  return Math.max(0, Math.min(MAX_REST_SECONDS, Math.round(value)));
}

function normalizeSetTarget(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(30, Math.round(value)));
}

function normalizeLookupText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeGroupLabel(value: string | undefined): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

function totalSeries(exercises: Array<{ target_sets_min: number; target_sets_max: number }>): {
  min: number;
  max: number;
} {
  return exercises.reduce(
    (acc, exercise) => ({
      min: acc.min + normalizeSetTarget(exercise.target_sets_min),
      max: acc.max + normalizeSetTarget(exercise.target_sets_max),
    }),
    { min: 0, max: 0 },
  );
}

/** "4 ejercicios · 12-15 series": una linea en vez de una pila de chips. */
function routineSummaryLine(routine: RoutineTemplate): string {
  const count = routine.exercises.length;
  const exercisesLabel = `${count} ejercicio${count === 1 ? "" : "s"}`;
  if (count === 0) return exercisesLabel;
  return `${exercisesLabel} · ${formatTotalSeries(routine.exercises)} series`;
}

function formatTotalSeries(exercises: Array<{ target_sets_min: number; target_sets_max: number }>): string {
  const { min, max } = totalSeries(exercises);
  return formatSetsRange(min, max);
}

function routineExerciseIdentity(exercise: Pick<RoutineExerciseTemplate, "name" | "group">): string {
  return `${normalizeLookupText(exercise.group || "")}|${normalizeLookupText(exercise.name)}`;
}

function inferLegacyExerciseGroup(name: string): string | null {
  if (!name.includes(">")) return null;
  const parts = name
    .split(">")
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  return parts[0] || null;
}

function resolveExerciseGroup(
  exercise: Pick<RoutineExerciseTemplate, "name" | "group">,
  catalogGroupByName: Map<string, string>,
): string {
  const explicitGroup = normalizeGroupLabel(exercise.group);
  if (explicitGroup) return explicitGroup;
  const fromLegacy = inferLegacyExerciseGroup(exercise.name);
  if (fromLegacy) return fromLegacy;
  return catalogGroupByName.get(normalizeLookupText(exercise.name)) || "Sin grupo";
}

function buildRoutineSeriesByGroup(
  routine: RoutineTemplate,
  catalogGroupByName: Map<string, string>,
): RoutineGroupSeries[] {
  const grouped = new Map<string, number>();
  for (const exercise of routine.exercises) {
    const sets = normalizeSetTarget(exercise.target_sets_max);
    if (sets <= 0) continue;
    const group = resolveExerciseGroup(exercise, catalogGroupByName);
    grouped.set(group, (grouped.get(group) || 0) + sets);
  }

  const total = Array.from(grouped.values()).reduce((acc, sets) => acc + sets, 0);
  return Array.from(grouped.entries())
    .map(([group, sets]) => ({
      group,
      sets,
      ratio: total > 0 ? sets / total : 0,
    }))
    .sort((a, b) => {
      if (b.sets !== a.sets) return b.sets - a.sets;
      return a.group.localeCompare(b.group);
    });
}

function formatRepsRange(min: number, max: number): string {
  if (min === max) return String(min);
  return `${min}-${max}`;
}

function splitRestSeconds(totalSeconds: number): { rest_minutes: string; rest_seconds: string } {
  const safe = clampRestSeconds(totalSeconds);
  return {
    rest_minutes: String(Math.floor(safe / 60)),
    rest_seconds: String(safe % 60),
  };
}

function normalizeDraftRestSeconds(exercise: DraftRoutineExercise): number {
  const parsedMinutes = parseOptionalBoundedInt(exercise.rest_minutes, 0, MAX_REST_MINUTES);
  const parsedSeconds = parseOptionalBoundedInt(exercise.rest_seconds, 0, 60);

  if (parsedMinutes === null && parsedSeconds === null) return 0;
  return clampRestSeconds((parsedMinutes ?? 0) * 60 + (parsedSeconds ?? 0));
}

function formatRestSeconds(restSeconds: number): string {
  if (restSeconds <= 0) return "Sin descanso";
  return `${restSeconds}s`;
}

function toDraftExercise(exercise: RoutineExerciseTemplate): DraftRoutineExercise {
  return {
    name: exercise.name,
    group: exercise.group,
    target_sets: formatSetsRange(exercise.target_sets_min, exercise.target_sets_max),
    target_reps_min: String(exercise.target_reps_min),
    target_reps_max: String(exercise.target_reps_max),
    ...splitRestSeconds(exercise.rest_seconds),
  };
}

function cloneRoutine(source: RoutineTemplate): RoutineTemplate {
  return {
    ...source,
    exercises: source.exercises.map((exercise) => ({ ...exercise })),
  };
}

function freezeNodes(source: Map<string, MutableNode>, rankBySimilarity: boolean): CatalogNode[] {
  const nodes = Array.from(source.values()).map((node) => {
    const children = freezeNodes(node.children, rankBySimilarity);
    const items = [...node.items].sort((a, b) => {
      if (rankBySimilarity && b.matchScore !== a.matchScore) {
        return b.matchScore - a.matchScore;
      }
      return a.entry.name.localeCompare(b.entry.name);
    });
    const childCount = children.reduce((acc, child) => acc + child.totalItems, 0);
    const itemMaxScore = items.reduce((maxScore, item) => Math.max(maxScore, item.matchScore), 0);
    const childMaxScore = children.reduce((maxScore, child) => Math.max(maxScore, child.maxScore), 0);

    return {
      label: node.label,
      path: node.path,
      children,
      items,
      totalItems: items.length + childCount,
      maxScore: Math.max(itemMaxScore, childMaxScore),
    };
  });

  nodes.sort((a, b) => {
    if (rankBySimilarity && b.maxScore !== a.maxScore) {
      return b.maxScore - a.maxScore;
    }
    return a.label.localeCompare(b.label);
  });

  return nodes;
}

function buildTree(items: TreeItem[], rankBySimilarity: boolean): CatalogNode[] {
  const root = new Map<string, MutableNode>();

  for (const item of items) {
    if (item.treePath.length === 0) continue;

    let cursor = root;
    const currentPath: string[] = [];
    let currentNode: MutableNode | null = null;

    for (const segment of item.treePath) {
      currentPath.push(segment);
      let node = cursor.get(segment);
      if (!node) {
        node = {
          label: segment,
          path: [...currentPath],
          children: new Map<string, MutableNode>(),
          items: [],
        };
        cursor.set(segment, node);
      }
      currentNode = node;
      cursor = node.children;
    }

    if (currentNode) currentNode.items.push(item);
  }

  return freezeNodes(root, rankBySimilarity);
}

function renderTree(
  nodes: CatalogNode[],
  onAdd: (entry: ExerciseCatalogEntry) => void,
  canAdd: (entry: ExerciseCatalogEntry) => boolean,
  expandAll: boolean,
  onSelectGroup: (group: string) => void,
  depth: number,
  activeRootLabel: string | null,
) {
  return nodes.map((node) => {
    const isRoot = depth === 1;
    const isSelectedRoot = isRoot && activeRootLabel === node.label;
    const isSiblingRoot = isRoot && activeRootLabel !== null && !isSelectedRoot;
    const isInSelectedBranch = activeRootLabel !== null && node.path[0] === activeRootLabel;
    const depthClass = depth >= 4 ? "treeNodeDepth4" : `treeNodeDepth${depth}`;
    const nodeClassName = [
      "treeNode",
      depthClass,
      isInSelectedBranch ? "treeNodeFocused" : "",
      isSelectedRoot ? "treeNodeSelectedRoot" : "",
      isSiblingRoot ? "treeNodeSiblingCollapsed" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const isOpen = isRoot && activeRootLabel !== null ? isSelectedRoot : expandAll;

    return (
      <details
        key={node.path.join(" > ")}
        className={nodeClassName}
        open={isOpen}
      >
        <summary
          className={`treeSummary ${isRoot ? "treeSummarySelectable" : ""} ${isSelectedRoot ? "treeSummarySelected" : ""}`}
          onClick={
            isRoot
              ? (event) => {
                  event.preventDefault();
                  onSelectGroup(node.label);
                }
              : undefined
          }
        >
          <span>{node.label}</span>
          <span className="chip">{node.totalItems}</span>
        </summary>

        <div className="treeChildren">
          {node.items.filter((item) => canAdd(item.entry)).length > 0 ? (
            <div className="treeLeafList">
              {node.items
                .filter((item) => canAdd(item.entry))
                .map((item) => (
                  <article key={item.entry.id} className="treeLeaf">
                    <div>
                      <strong>{formatExerciseNameForList(item.entry.name)}</strong>
                      <div className="small">{formatExercisePathForList(item.treePath)}</div>
                      <div className="chipRow" style={{ marginTop: 6 }}>
                        <span className="chip">{item.entry.scope === "global" ? "Global" : "Personal"}</span>
                      </div>
                    </div>
                    <button className="btn" onClick={() => onAdd(item.entry)}>
                      Agregar
                    </button>
                  </article>
                ))}
            </div>
          ) : null}

          {node.children.length > 0
            ? renderTree(node.children, onAdd, canAdd, expandAll, onSelectGroup, depth + 1, activeRootLabel)
            : null}
        </div>
      </details>
    );
  });
}

export default function Routines() {
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
  const [draggedExerciseIdentity, setDraggedExerciseIdentity] = useState<string | null>(null);
  const [dropSlotIndex, setDropSlotIndex] = useState<number | null>(null);
  const [dragArmedExerciseIdentity, setDragArmedExerciseIdentity] = useState<string | null>(null);
  const [openCardMenuIdentity, setOpenCardMenuIdentity] = useState<string | null>(null);

  const [selectedGroup, setSelectedGroup] = useState<string>(ALL);
  const [selectedZone, setSelectedZone] = useState<ExerciseBodyZoneFilter>(ALL_EXERCISE_ZONE_FILTER);
  const [search, setSearch] = useState("");
  const athleteIdRef = useRef<string | null>(athleteId);
  const dragHoldTimeoutRef = useRef<number | null>(null);
  const dragAutoScrollRafRef = useRef<number | null>(null);
  const dragPointerClientYRef = useRef<number | null>(null);

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
  const catalogGroupByName = useMemo(() => {
    const grouped = new Map<string, Set<string>>();
    for (const entry of catalogEntries) {
      const key = normalizeLookupText(entry.name);
      if (!key) continue;
      const bucket = grouped.get(key) || new Set<string>();
      bucket.add(entry.group);
      grouped.set(key, bucket);
    }

    const map = new Map<string, string>();
    for (const [key, groups] of grouped.entries()) {
      if (groups.size !== 1) continue;
      const [singleGroup] = Array.from(groups);
      if (!singleGroup) continue;
      map.set(key, singleGroup);
    }
    return map;
  }, [catalogEntries]);
  const infoRoutineSeriesByGroup = useMemo(() => {
    if (!infoRoutine) return [];
    return buildRoutineSeriesByGroup(infoRoutine, catalogGroupByName);
  }, [catalogGroupByName, infoRoutine]);
  const infoRoutineMaxSeries = useMemo(() => {
    if (infoRoutineSeriesByGroup.length === 0) return 1;
    return Math.max(...infoRoutineSeriesByGroup.map((entry) => entry.sets), 1);
  }, [infoRoutineSeriesByGroup]);
  const infoRoutineRadar = useMemo(() => {
    if (infoRoutineSeriesByGroup.length === 0) return null;

    const chartSize = 340;
    const center = chartSize / 2;
    const radius = 112;
    const ringCount = 4;
    const angleStep = (Math.PI * 2) / infoRoutineSeriesByGroup.length;

    const axes = infoRoutineSeriesByGroup.map((entry, index) => {
      const angle = -Math.PI / 2 + index * angleStep;
      const axisX = center + Math.cos(angle) * radius;
      const axisY = center + Math.sin(angle) * radius;
      const labelRadius = radius + 20;
      const labelX = center + Math.cos(angle) * labelRadius;
      const labelY = center + Math.sin(angle) * labelRadius;

      return {
        ...entry,
        angle,
        axisX,
        axisY,
        labelX,
        labelY,
      };
    });

    const rings = Array.from({ length: ringCount }, (_, ringIndex) => {
      const ringFactor = (ringIndex + 1) / ringCount;
      return axes
        .map((axis) => {
          const x = center + Math.cos(axis.angle) * radius * ringFactor;
          const y = center + Math.sin(axis.angle) * radius * ringFactor;
          return `${x},${y}`;
        })
        .join(" ");
    });

    const valuePolygon = axes
      .map((axis) => {
        const valueRadius = radius * (axis.sets / infoRoutineMaxSeries);
        const x = center + Math.cos(axis.angle) * valueRadius;
        const y = center + Math.sin(axis.angle) * valueRadius;
        return `${x},${y}`;
      })
      .join(" ");

    return {
      chartSize,
      center,
      axes,
      rings,
      valuePolygon,
    };
  }, [infoRoutineMaxSeries, infoRoutineSeriesByGroup]);

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
    setDraggedExerciseIdentity(null);
    setDropSlotIndex(null);
    setDragArmedExerciseIdentity(null);
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
    if (!pickerOpen && !infoRoutineId) return;

    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (infoRoutineId) {
          setInfoRoutineId(null);
          return;
        }
        setPickerOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [infoRoutineId, pickerOpen]);

  useEffect(
    () => () => {
      if (dragHoldTimeoutRef.current !== null) {
        window.clearTimeout(dragHoldTimeoutRef.current);
        dragHoldTimeoutRef.current = null;
      }
      if (dragAutoScrollRafRef.current !== null) {
        window.cancelAnimationFrame(dragAutoScrollRafRef.current);
        dragAutoScrollRafRef.current = null;
      }
      dragPointerClientYRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!dragArmedExerciseIdentity) return;

    const onPointerRelease = () => {
      if (dragHoldTimeoutRef.current !== null) {
        window.clearTimeout(dragHoldTimeoutRef.current);
        dragHoldTimeoutRef.current = null;
      }
      if (!draggedExerciseIdentity) {
        setDragArmedExerciseIdentity(null);
      }
    };

    window.addEventListener("pointerup", onPointerRelease, true);
    window.addEventListener("pointercancel", onPointerRelease, true);
    return () => {
      window.removeEventListener("pointerup", onPointerRelease, true);
      window.removeEventListener("pointercancel", onPointerRelease, true);
    };
  }, [dragArmedExerciseIdentity, draggedExerciseIdentity]);

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

    setError("");
    const next = entry.name;
    const nextIdentity = routineExerciseIdentity({ name: next, group: entry.group });
    let added = false;
    setDraftExercises((prev) => {
      if (prev.some((value) => routineExerciseIdentity(value) === nextIdentity)) return prev;
      added = true;
      return [
        ...prev,
        {
          name: next,
          group: entry.group,
          target_sets: String(DEFAULT_TARGET_SETS),
          target_reps_min: String(DEFAULT_TARGET_REPS_MIN),
          target_reps_max: String(DEFAULT_TARGET_REPS_MAX),
          ...splitRestSeconds(DEFAULT_REST_SECONDS),
        },
      ];
    });
    if (added) {
      setPickerOpen(false);
    }
  }

  function removeDraftExercise(identityValue: string) {
    if (draggedExerciseIdentity === identityValue || dragArmedExerciseIdentity === identityValue) {
      clearDraftExerciseDragState();
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

  function updateDraftExercise(
    identityValue: string,
    patch: Partial<
      Pick<DraftRoutineExercise, "target_sets" | "target_reps_min" | "target_reps_max" | "rest_minutes" | "rest_seconds">
    >,
  ) {
    setDraftExercises((prev) =>
      prev.map((entry) => (routineExerciseIdentity(entry) === identityValue ? { ...entry, ...patch } : entry)),
    );
  }

  function stopDraftAutoScroll() {
    if (dragAutoScrollRafRef.current !== null) {
      window.cancelAnimationFrame(dragAutoScrollRafRef.current);
      dragAutoScrollRafRef.current = null;
    }
    dragPointerClientYRef.current = null;
  }

  function runDraftAutoScrollLoop() {
    const pointerY = dragPointerClientYRef.current;
    if (pointerY === null) {
      dragAutoScrollRafRef.current = window.requestAnimationFrame(runDraftAutoScrollLoop);
      return;
    }

    const viewportHeight = window.innerHeight;
    const distanceToTop = pointerY;
    const distanceToBottom = viewportHeight - pointerY;
    let deltaY = 0;

    if (distanceToTop < DRAG_AUTO_SCROLL_EDGE_PX) {
      const intensity = (DRAG_AUTO_SCROLL_EDGE_PX - distanceToTop) / DRAG_AUTO_SCROLL_EDGE_PX;
      deltaY = -Math.max(1, Math.round(intensity * DRAG_AUTO_SCROLL_MAX_STEP_PX));
    } else if (distanceToBottom < DRAG_AUTO_SCROLL_EDGE_PX) {
      const intensity = (DRAG_AUTO_SCROLL_EDGE_PX - distanceToBottom) / DRAG_AUTO_SCROLL_EDGE_PX;
      deltaY = Math.max(1, Math.round(intensity * DRAG_AUTO_SCROLL_MAX_STEP_PX));
    }

    if (deltaY !== 0) {
      window.scrollBy({ top: deltaY, left: 0, behavior: "auto" });
    }

    dragAutoScrollRafRef.current = window.requestAnimationFrame(runDraftAutoScrollLoop);
  }

  function updateDraftDragPointerClientY(clientY: number) {
    if (!Number.isFinite(clientY)) return;
    dragPointerClientYRef.current = clientY;
    if (dragAutoScrollRafRef.current === null) {
      dragAutoScrollRafRef.current = window.requestAnimationFrame(runDraftAutoScrollLoop);
    }
  }

  function handleDraftSortableListDragOverCapture(event: DragEvent<HTMLDivElement>) {
    updateDraftDragPointerClientY(event.clientY);
  }

  function clearDraftExerciseDragState() {
    if (dragHoldTimeoutRef.current !== null) {
      window.clearTimeout(dragHoldTimeoutRef.current);
      dragHoldTimeoutRef.current = null;
    }
    stopDraftAutoScroll();
    setDraggedExerciseIdentity(null);
    setDropSlotIndex(null);
    setDragArmedExerciseIdentity(null);
  }

  function moveDraftExercise(identityValue: string, slotIndexValue: number) {
    setDraftExercises((prev) => {
      if (prev.length <= 1) return prev;
      const sourceIndex = prev.findIndex((entry) => routineExerciseIdentity(entry) === identityValue);
      if (sourceIndex < 0) return prev;

      const boundedSlotIndex = Math.max(0, Math.min(prev.length, slotIndexValue));
      const destinationIndex = sourceIndex < boundedSlotIndex ? boundedSlotIndex - 1 : boundedSlotIndex;
      if (destinationIndex === sourceIndex) return prev;

      const next = [...prev];
      const [moved] = next.splice(sourceIndex, 1);
      if (!moved) return prev;
      next.splice(destinationIndex, 0, moved);
      return next;
    });
  }

  function armDraftExerciseDrag(identityValue: string) {
    if (dragHoldTimeoutRef.current !== null) {
      window.clearTimeout(dragHoldTimeoutRef.current);
      dragHoldTimeoutRef.current = null;
    }

    setDragArmedExerciseIdentity(null);
    dragHoldTimeoutRef.current = window.setTimeout(() => {
      setDragArmedExerciseIdentity(identityValue);
      dragHoldTimeoutRef.current = null;
    }, DRAG_HOLD_TO_REORDER_MS);
  }

  function releaseDraftExerciseDragArm() {
    if (dragHoldTimeoutRef.current !== null) {
      window.clearTimeout(dragHoldTimeoutRef.current);
      dragHoldTimeoutRef.current = null;
    }
    if (!draggedExerciseIdentity) {
      setDragArmedExerciseIdentity(null);
    }
  }

  function handleDraftExercisePointerDown(event: ReactPointerEvent<HTMLElement>, identityValue: string) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (draggedExerciseIdentity) return;
    armDraftExerciseDrag(identityValue);
  }

  function handleDraftExercisePointerRelease() {
    releaseDraftExerciseDragArm();
  }

  function handleDraftExerciseDragStart(event: DragEvent<HTMLElement>, identityValue: string) {
    if (dragArmedExerciseIdentity !== identityValue) {
      event.preventDefault();
      clearDraftExerciseDragState();
      return;
    }

    setDraggedExerciseIdentity(identityValue);
    setDropSlotIndex(null);
    setDragArmedExerciseIdentity(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", identityValue);
    updateDraftDragPointerClientY(event.clientY);
  }

  function handleDraftDropSlotDragOver(event: DragEvent<HTMLDivElement>, slotIndexValue: number) {
    const identityFromEvent = event.dataTransfer.getData("text/plain");
    const nextIdentity = draggedExerciseIdentity || identityFromEvent;
    if (!nextIdentity) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    updateDraftDragPointerClientY(event.clientY);
    if (dropSlotIndex !== slotIndexValue) {
      setDropSlotIndex(slotIndexValue);
    }
  }

  function handleDraftDropSlotDrop(event: DragEvent<HTMLDivElement>, slotIndexValue: number) {
    event.preventDefault();
    const identityFromEvent = event.dataTransfer.getData("text/plain");
    const nextIdentity = draggedExerciseIdentity || identityFromEvent;
    if (!nextIdentity) {
      clearDraftExerciseDragState();
      return;
    }
    moveDraftExercise(nextIdentity, slotIndexValue);
    clearDraftExerciseDragState();
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
    setDraggedExerciseIdentity(null);
    setDropSlotIndex(null);
    setDragArmedExerciseIdentity(null);
    setOpenCardMenuIdentity(null);
  }

  function startEditRoutine(routine: RoutineTemplate) {
    setBuilderOpen(true);
    setEditingRoutineId(routine.id);
    setName(routine.name);
    setDraftExercises(routine.exercises.map((exercise) => toDraftExercise(exercise)));
    setDraggedExerciseIdentity(null);
    setDropSlotIndex(null);
    setDragArmedExerciseIdentity(null);
    setError("");
    setFeedback("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function saveRoutineDraft() {
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
          const shouldPropagate = window.confirm(
            `Desea actualizar esta rutina para todos tus usuarios que la posean?\nCoincidencias: ${targets.length} (${preview}${previewSuffix})`,
          );

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
          <div className="emptyState" style={{ marginTop: 12 }}>
            Aún no agregaste ejercicios a la rutina.
          </div>
        ) : (
          <div
            className={`treeLeafList routineSortableList ${draggedExerciseIdentity ? "routineSortableListDragging" : ""}`}
            style={{ marginTop: 12 }}
            onDragOverCapture={handleDraftSortableListDragOverCapture}
          >
            {draftExercises.map((exercise, exerciseIndex) => {
              const exerciseIdentity = routineExerciseIdentity(exercise);
              const beforeSlotIsActive = dropSlotIndex === exerciseIndex;
              const isDragged = draggedExerciseIdentity === exerciseIdentity;
              const isDragArmed = dragArmedExerciseIdentity === exerciseIdentity;
              return (
                <div key={`${exerciseIdentity}_${exerciseIndex}`} className="routineSortableEntry">
                  <div
                    className={`routineDropSlot ${beforeSlotIsActive ? "active" : ""}`}
                    onDragOver={(event) => handleDraftDropSlotDragOver(event, exerciseIndex)}
                    onDragEnter={(event) => handleDraftDropSlotDragOver(event, exerciseIndex)}
                    onDrop={(event) => handleDraftDropSlotDrop(event, exerciseIndex)}
                  />

                  <article
                    className={`exerciseCard ${isDragged ? "exerciseCardDragging" : ""} ${isDragArmed ? "exerciseCardDragArmed" : ""}`}
                    draggable
                    onPointerDown={(event) => handleDraftExercisePointerDown(event, exerciseIdentity)}
                    onPointerUp={handleDraftExercisePointerRelease}
                    onPointerCancel={handleDraftExercisePointerRelease}
                    onDragStart={(event) => handleDraftExerciseDragStart(event, exerciseIdentity)}
                    onDragEnd={clearDraftExerciseDragState}
                  >
                    <div className="hstack" style={{ justifyContent: "space-between" }}>
                      <div className="hstack compact">
                        <span className={`chip routineDragHandle ${isDragArmed ? "routineDragHandleArmed" : ""}`} aria-hidden="true">
                          <svg className="iconGlyph routineDragHandleIcon" viewBox="0 0 24 24">
                            <path d="M4 7h16M4 12h16M4 17h16" />
                          </svg>
                        </span>
                        <strong>{formatExerciseNameForList(exercise.name)}</strong>
                      </div>
                      <div className="cardMenu" data-card-menu onPointerDown={(event) => event.stopPropagation()}>
                        <button
                          className="cardMenuTrigger"
                          type="button"
                          aria-haspopup="menu"
                          aria-expanded={openCardMenuIdentity === exerciseIdentity}
                          aria-label="Opciones del ejercicio"
                          onClick={() =>
                            setOpenCardMenuIdentity((prev) => (prev === exerciseIdentity ? null : exerciseIdentity))
                          }
                        >
                          <svg className="iconGlyph" viewBox="0 0 24 24">
                            <path d="M12 6h.01M12 12h.01M12 18h.01" />
                          </svg>
                        </button>

                        {openCardMenuIdentity === exerciseIdentity ? (
                          <div className="cardMenuPopover" role="menu">
                            <button
                              className="cardMenuItem"
                              type="button"
                              role="menuitem"
                              disabled={draftExercises.length < 2}
                              onClick={() => applyDraftSettingsToAll(exerciseIdentity)}
                            >
                              Aplicar ajustes a todos
                              <span className="cardMenuItemHint">Series, reps y descanso</span>
                            </button>
                            <button
                              className="cardMenuItem cardMenuItemDanger"
                              type="button"
                              role="menuitem"
                              onClick={() => removeDraftExercise(exerciseIdentity)}
                            >
                              Eliminar
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="splitGrid" style={{ marginTop: 10 }}>
                      <div>
                        <label className="smallLabel">Series</label>
                        <input
                          className="input"
                          type="text"
                          inputMode="numeric"
                          list={`series-suggestions-${exerciseIndex}`}
                          placeholder="Ej: 3 o 3-4"
                          value={exercise.target_sets}
                          onChange={(e) =>
                            updateDraftExercise(exerciseIdentity, {
                              target_sets: e.target.value,
                            })
                          }
                        />
                        <datalist id={`series-suggestions-${exerciseIndex}`}>
                          {SERIES_SUGGESTIONS.map((suggestion) => (
                            <option key={suggestion} value={suggestion} />
                          ))}
                        </datalist>
                      </div>
                      <div>
                        <label className="smallLabel">Reps min</label>
                        <input
                          className="input"
                          type="number"
                          min={1}
                          max={100}
                          value={exercise.target_reps_min}
                          onChange={(e) => {
                            const rawValue = e.target.value;
                            if (rawValue === "") {
                              updateDraftExercise(exerciseIdentity, { target_reps_min: "" });
                              return;
                            }

                            const fallbackMin = parseBoundedInt(exercise.target_reps_min, DEFAULT_TARGET_REPS_MIN, 1, 100);
                            const nextMin = parseBoundedInt(rawValue, fallbackMin, 1, 100);
                            const patch: Partial<DraftRoutineExercise> = { target_reps_min: String(nextMin) };

                            if (exercise.target_reps_max.trim() !== "") {
                              const currentMax = parseBoundedInt(
                                exercise.target_reps_max,
                                DEFAULT_TARGET_REPS_MAX,
                                1,
                                100,
                              );
                              patch.target_reps_max = String(Math.max(nextMin, currentMax));
                            }

                            updateDraftExercise(exerciseIdentity, patch);
                          }}
                        />
                      </div>
                      <div>
                        <label className="smallLabel">Reps max</label>
                        <input
                          className="input"
                          type="number"
                          min={1}
                          max={100}
                          value={exercise.target_reps_max}
                          onChange={(e) => {
                            const rawValue = e.target.value;
                            if (rawValue === "") {
                              updateDraftExercise(exerciseIdentity, { target_reps_max: "" });
                              return;
                            }

                            const fallbackMax = parseBoundedInt(exercise.target_reps_max, DEFAULT_TARGET_REPS_MAX, 1, 100);
                            const nextMax = parseBoundedInt(rawValue, fallbackMax, 1, 100);
                            const patch: Partial<DraftRoutineExercise> = { target_reps_max: String(nextMax) };

                            if (exercise.target_reps_min.trim() !== "") {
                              const currentMin = parseBoundedInt(
                                exercise.target_reps_min,
                                DEFAULT_TARGET_REPS_MIN,
                                1,
                                100,
                              );
                              patch.target_reps_min = String(Math.min(currentMin, nextMax));
                            }

                            updateDraftExercise(exerciseIdentity, patch);
                          }}
                        />
                      </div>
                      <div>
                        <label className="smallLabel">Descanso</label>
                        <div className="hstack compact" style={{ flexWrap: "nowrap", gap: 6 }}>
                          <input
                            className="input"
                            type="number"
                            min={0}
                            max={MAX_REST_MINUTES}
                            inputMode="numeric"
                            style={{ width: 62, minWidth: 62, padding: "8px 8px", textAlign: "center" }}
                            value={exercise.rest_minutes}
                            onChange={(e) => {
                              const rawValue = e.target.value;
                              if (rawValue === "") {
                                updateDraftExercise(exerciseIdentity, { rest_minutes: "" });
                                return;
                              }

                              const fallbackMinutes = parseOptionalBoundedInt(
                                exercise.rest_minutes,
                                0,
                                MAX_REST_MINUTES,
                              ) ?? 0;
                              const nextMinutes = parseBoundedInt(rawValue, fallbackMinutes, 0, MAX_REST_MINUTES);
                              updateDraftExercise(exerciseIdentity, { rest_minutes: String(nextMinutes) });
                            }}
                          />
                          <span className="smallLabel" style={{ margin: 0 }}>
                            min
                          </span>
                          <input
                            className="input"
                            type="number"
                            min={0}
                            max={60}
                            inputMode="numeric"
                            style={{ width: 62, minWidth: 62, padding: "8px 8px", textAlign: "center" }}
                            value={exercise.rest_seconds}
                            onChange={(e) => {
                              const rawValue = e.target.value;
                              if (rawValue === "") {
                                updateDraftExercise(exerciseIdentity, { rest_seconds: "" });
                                return;
                              }

                              const fallbackSeconds = parseOptionalBoundedInt(exercise.rest_seconds, 0, 60) ?? 0;
                              const nextSeconds = parseBoundedInt(rawValue, fallbackSeconds, 0, 60);
                              updateDraftExercise(exerciseIdentity, { rest_seconds: String(nextSeconds) });
                            }}
                          />
                          <span className="smallLabel" style={{ margin: 0 }}>
                            seg
                          </span>
                        </div>
                      </div>
                    </div>
                  </article>
                </div>
              );
            })}
            <div
              className={`routineDropSlot ${dropSlotIndex === draftExercises.length ? "active" : ""}`}
              onDragOver={(event) => handleDraftDropSlotDragOver(event, draftExercises.length)}
              onDragEnter={(event) => handleDraftDropSlotDragOver(event, draftExercises.length)}
              onDrop={(event) => handleDraftDropSlotDrop(event, draftExercises.length)}
            />
          </div>
        )}

            <button type="button" className="linkBtn" style={{ marginTop: 12 }} onClick={() => setPickerOpen(true)}>
              + Agregar ejercicio
            </button>
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
        <div className="modalOverlay" role="presentation" onClick={() => setPickerOpen(false)}>
          <section
            className="modalCard"
            role="dialog"
            aria-modal="true"
            aria-labelledby="routine-picker-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sectionHead">
              <h3 id="routine-picker-title">Agregar nuevo ejercicio</h3>
              <p>Selecciona solo ejercicios finales de cada rama del catálogo.</p>
            </div>

            <div className="splitGrid" style={{ marginTop: 10 }}>
              <div>
                <label className="smallLabel">Zona</label>
                <Select
                  value={selectedZone}
                  onChange={(v) => setSelectedZone(v as ExerciseBodyZoneFilter)}
                  options={[
                    { value: ALL_EXERCISE_ZONE_FILTER, label: "Todas" },
                    { value: EXERCISE_ZONE_UPPER, label: "Superior" },
                    { value: EXERCISE_ZONE_LOWER, label: "Inferior" },
                  ]}
                />
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <label className="smallLabel">Buscar ejercicio</label>
              <input
                className="input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ej: sentadilla posterior smith"
              />
            </div>

            <div className="chipRow" style={{ marginTop: 10, alignItems: "center" }}>
              <span className="chip">Catálogo total: {catalogEntries.length}</span>
              <span className="chip">Resultados: {filteredEntries.length}</span>
              <span className="chip">Zona: {selectedZone === ALL_EXERCISE_ZONE_FILTER ? "Todas" : selectedZone === EXERCISE_ZONE_LOWER ? "Inferior" : "Superior"}</span>
              <span className="chip">Grupo: {selectedGroup === ALL ? "Todos" : selectedGroup}</span>
            </div>

            <div className="quickActions" style={{ marginTop: 10 }}>
              <button type="button" className="btn" onClick={clearFilters}>
                Limpiar filtros
              </button>
              <button type="button" className="btn" onClick={() => setPickerOpen(false)}>
                Cerrar
              </button>
            </div>

            {filteredEntries.length === 0 ? (
              <div className="emptyState" style={{ marginTop: 12 }}>
                Sin coincidencias para la combinación de filtros actual.
              </div>
            ) : (
              <div className="treeList" style={{ marginTop: 12 }}>
                {renderTree(tree, addSelectedExercise, isLeafEntry, searchTokens.length > 0, selectGroupFromTree, 1, activeRootLabel)}
              </div>
            )}
          </section>
        </div>
      ) : null}

      {infoRoutine ? (
        <div className="modalOverlay" role="presentation" onClick={() => setInfoRoutineId(null)}>
          <section
            className="modalCard"
            role="dialog"
            aria-modal="true"
            aria-labelledby="routine-info-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sectionHead">
              <h3 id="routine-info-title">{infoRoutine.name}</h3>
              <p>{`${routineSummaryLine(infoRoutine)} · ${infoRoutineSeriesByGroup.length} grupo${infoRoutineSeriesByGroup.length === 1 ? "" : "s"}`}</p>
            </div>

            {/* El detalle de cada ejercicio vivia como pila de chips en la lista;
                aqui, que es donde se consulta, se lee mejor. */}
            <div className="rowList" style={{ marginTop: 10 }}>
              {infoRoutine.exercises.map((exercise, index) => (
                <div key={`${infoRoutine.id}_${exercise.group || ""}_${exercise.name}_${index}`} className="rowItem">
                  <div className="rowMain">
                    <strong>{formatExerciseNameForList(exercise.name)}</strong>
                    <span className="small">
                      {`${formatSetsRange(exercise.target_sets_min, exercise.target_sets_max)} x ${formatRepsRange(exercise.target_reps_min, exercise.target_reps_max)} · descanso ${formatRestSeconds(exercise.rest_seconds)}`}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {infoRoutineSeriesByGroup.length === 0 || !infoRoutineRadar ? (
              <div className="routineInfoLayout" style={{ marginTop: 14 }}>
                <div className="emptyState">
                  Esta rutina no tiene series suficientes para mostrar un desglose por grupos.
                </div>
                <div className="routineRadarWrap">
                  <ChartPlaceholder variant="radar" height={280} caption="Aún no hay datos para esta gráfica" />
                </div>
              </div>
            ) : (
              <div className="routineInfoLayout" style={{ marginTop: 14 }}>
                <div className="routineInfoList">
                  {infoRoutineSeriesByGroup.map((entry) => (
                    <article key={`${infoRoutine.id}_${entry.group}`} className="routineInfoRow">
                      <strong>{entry.group}</strong>
                      <div className="routineInfoRowMeta">
                        <span>{entry.sets} series</span>
                        <span className="small">{`${Math.round(entry.ratio * 100)}%`}</span>
                      </div>
                    </article>
                  ))}
                </div>

                <div className="routineRadarWrap">
                  <svg
                    className="routineRadarSvg"
                    viewBox={`0 0 ${infoRoutineRadar.chartSize} ${infoRoutineRadar.chartSize}`}
                    role="img"
                    aria-label={`Grafico de distribucion de series para ${infoRoutine.name}`}
                  >
                    {infoRoutineRadar.rings.map((ring, ringIndex) => (
                      <polygon key={`ring_${ringIndex}`} className="routineRadarRing" points={ring} />
                    ))}

                    {infoRoutineRadar.axes.map((axis) => (
                      <line
                        key={`axis_${axis.group}`}
                        className="routineRadarAxis"
                        x1={infoRoutineRadar.center}
                        y1={infoRoutineRadar.center}
                        x2={axis.axisX}
                        y2={axis.axisY}
                      />
                    ))}

                    <polygon className="routineRadarArea" points={infoRoutineRadar.valuePolygon} />

                    {infoRoutineRadar.axes.map((axis) => (
                      <text
                        key={`label_${axis.group}`}
                        className="routineRadarLabel"
                        x={axis.labelX}
                        y={axis.labelY}
                        textAnchor={radarLabelAnchor(axis.labelX, infoRoutineRadar.center)}
                      >
                        {compactLabel(axis.group)}
                      </text>
                    ))}
                  </svg>
                  <p className="small routineRadarCaption">
                    {`Anillo externo = ${infoRoutineMaxSeries} serie${infoRoutineMaxSeries === 1 ? "" : "s"}.`}
                  </p>
                </div>
              </div>
            )}

            <div className="quickActions" style={{ marginTop: 14 }}>
              <button className="btn" onClick={() => setInfoRoutineId(null)}>
                Cerrar
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {athleteId && !showBuilder ? (
        <section className="surface">
          {sorted.length === 0 ? (
            <div className="emptyState">Aún no tienes rutinas guardadas.</div>
          ) : (
            <div className="rowList">
              {sorted.map((routine) => (
                <div key={routine.id} className="rowItem">
                  <button type="button" className="rowMain" onClick={() => setInfoRoutineId(routine.id)}>
                    <strong>{routine.name}</strong>
                    <span className="small">{routineSummaryLine(routine)}</span>
                  </button>
                  <KebabMenu
                    ariaLabel={`Opciones de ${routine.name}`}
                    actions={[
                      { label: "Editar", onSelect: () => startEditRoutine(routine) },
                      { label: "Ver detalle", onSelect: () => setInfoRoutineId(routine.id) },
                      { label: "Eliminar", destructive: true, onSelect: () => removeRoutine(routine.id) },
                    ]}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="rowListActions">
            <button type="button" className="linkBtn" onClick={openNewRoutineBuilder}>
              + Nueva rutina
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
