import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { renderExerciseTree } from "../../components/ExerciseTree";
import Select from "../../components/Select";
import type { CatalogNode } from "../../lib/exerciseTree";
import {
  ALL_EXERCISE_FILTER as ALL,
  ALL_EXERCISE_ZONE_FILTER,
  EXERCISE_ZONE_LOWER,
  EXERCISE_ZONE_UPPER,
  type ExerciseBodyZoneFilter,
  type ExerciseCatalogEntry,
} from "../../lib/exerciseCatalog";

type Props = {
  selectedZone: ExerciseBodyZoneFilter;
  selectedGroup: string;
  search: string;
  catalogCount: number;
  resultsCount: number;
  tree: CatalogNode[];
  expandAll: boolean;
  activeRootLabel: string | null;
  onZoneChange: (zone: ExerciseBodyZoneFilter) => void;
  onSearchChange: (value: string) => void;
  onClearFilters: () => void;
  onClose: () => void;
  onAdd: (entry: ExerciseCatalogEntry) => void;
  canAdd: (entry: ExerciseCatalogEntry) => boolean;
  isAdded: (entry: ExerciseCatalogEntry) => boolean;
  addedCount: number;
  onSelectGroup: (group: string) => void;
  title?: string;
  hint?: string;
};

const CLOSE_DISTANCE_PX = 110;
const CLOSE_VELOCITY_PX_MS = 0.6;
const CLOSE_ANIMATION_MS = 200;

export default function ExercisePickerModal({
  selectedZone,
  selectedGroup,
  search,
  catalogCount,
  resultsCount,
  tree,
  expandAll,
  activeRootLabel,
  onZoneChange,
  onSearchChange,
  onClearFilters,
  onClose,
  onAdd,
  canAdd,
  isAdded,
  addedCount,
  onSelectGroup,
  title = "Agregar ejercicio",
  hint,
}: Props) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false);
  const drag = useRef<{ startY: number; startT: number; lastY: number; lastT: number } | null>(null);

  const finishClose = () => {
    setClosing(true);
    setDragY(window.innerHeight);
    window.setTimeout(onClose, CLOSE_ANIMATION_MS);
  };

  const onDragStart = (event: ReactPointerEvent<HTMLElement>) => {
    if (closing) return;
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const now = performance.now();
    drag.current = { startY: event.clientY, startT: now, lastY: event.clientY, lastT: now };
    setDragging(true);
  };

  const onDragMove = (event: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    d.lastY = event.clientY;
    d.lastT = performance.now();
    setDragY(Math.max(0, event.clientY - d.startY));
  };

  const onDragEnd = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    const distance = Math.max(0, d.lastY - d.startY);
    const velocity = distance / Math.max(1, d.lastT - d.startT);
    if (distance > CLOSE_DISTANCE_PX || (distance > 30 && velocity > CLOSE_VELOCITY_PX_MS)) {
      finishClose();
    } else {
      setDragY(0);
    }
  };

  const dragHandlers = {
    onPointerDown: onDragStart,
    onPointerMove: onDragMove,
    onPointerUp: onDragEnd,
    onPointerCancel: onDragEnd,
  };

  return (
    <div
      className="modalOverlay modalOverlaySheet"
      role="presentation"
      style={{ opacity: closing ? 0 : Math.max(0.3, 1 - dragY / 500), transition: dragging ? "none" : `opacity ${CLOSE_ANIMATION_MS}ms ease` }}
      onClick={finishClose}
    >
      <section
        className="modalCard modalCardSheet"
        style={{
          transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
          transition: dragging ? "none" : `transform ${CLOSE_ANIMATION_MS}ms ease`,
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="routine-picker-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheetGrabber" aria-hidden="true" {...dragHandlers}>
          <span className="sheetGrabberBar" />
        </div>
        <div className="sectionHead pickerHead sheetDragZone" {...dragHandlers}>
          <div>
            <h3 id="routine-picker-title">{title}</h3>
            <p>{hint ?? (addedCount > 0 ? `En la rutina: ${addedCount}` : "Elige ejercicios finales del catálogo.")}</p>
          </div>
          <button type="button" className="pickerClose" aria-label="Cerrar" onClick={finishClose}>
            <svg className="iconGlyph" viewBox="0 0 24 24">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="splitGrid" style={{ marginTop: 10 }}>
          <div>
            <label className="smallLabel">Zona</label>
            <Select
              value={selectedZone}
              onChange={(v) => onZoneChange(v as ExerciseBodyZoneFilter)}
              options={[
                { value: ALL_EXERCISE_ZONE_FILTER, label: "Todas" },
                { value: EXERCISE_ZONE_UPPER, label: "Superior" },
                { value: EXERCISE_ZONE_LOWER, label: "Inferior" },
              ]}
            />
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <label className="smallLabel" htmlFor="routines-exercise-search">Buscar ejercicio</label>
          <input
            id="routines-exercise-search"
            className="input"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="ej: sentadilla posterior smith"
          />
        </div>

        <div className="chipRow" style={{ marginTop: 10, alignItems: "center" }}>
          <span className="chip">Catálogo total: {catalogCount}</span>
          <span className="chip">Resultados: {resultsCount}</span>
          <span className="chip">Zona: {selectedZone === ALL_EXERCISE_ZONE_FILTER ? "Todas" : selectedZone === EXERCISE_ZONE_LOWER ? "Inferior" : "Superior"}</span>
          <span className="chip">Grupo: {selectedGroup === ALL ? "Todos" : selectedGroup}</span>
        </div>

        <div className="quickActions" style={{ marginTop: 10 }}>
          <button type="button" className="btn" onClick={onClearFilters}>
            Limpiar filtros
          </button>
        </div>

        {resultsCount === 0 ? (
          <div className="emptyState" style={{ marginTop: 12 }}>
            Sin coincidencias para la combinación de filtros actual.
          </div>
        ) : (
          <div className="treeList" style={{ marginTop: 12 }}>
            {renderExerciseTree(tree, {
              expandAll,
              onSelectGroup,
              activeRootLabel,
              showScopeChip: true,
              filterItem: canAdd,
              renderActions: (entry) =>
                isAdded(entry) ? (
                  <span className="chip pickerAdded">✓ Agregado</span>
                ) : (
                  <button className="btn" onClick={() => onAdd(entry)}>
                    Agregar
                  </button>
                ),
            })}
          </div>
        )}
      </section>
    </div>
  );
}
