import type { DragEvent, PointerEvent as ReactPointerEvent } from "react";

import { formatExerciseNameForList } from "../../lib/exerciseTree";
import {
  MAX_REST_MINUTES,
  SERIES_SUGGESTIONS,
  repsFieldPatch,
  restFieldPatch,
  type DraftExercisePatch,
  type DraftRoutineExercise,
} from "../../lib/routines/draft";

type Props = {
  exercise: DraftRoutineExercise;
  exerciseIdentity: string;
  exerciseIndex: number;
  totalExercises: number;
  isDragged: boolean;
  isDragArmed: boolean;
  menuOpen: boolean;
  beforeSlotIsActive: boolean;
  onToggleMenu: (identity: string) => void;
  onApplyToAll: (identity: string) => void;
  onRemove: (identity: string) => void;
  onUpdate: (identity: string, patch: DraftExercisePatch) => void;
  onSlotDragOver: (event: DragEvent<HTMLDivElement>, slotIndex: number) => void;
  onSlotDrop: (event: DragEvent<HTMLDivElement>, slotIndex: number) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, identity: string) => void;
  onPointerRelease: () => void;
  onDragStart: (event: DragEvent<HTMLElement>, identity: string) => void;
  onDragEnd: () => void;
};

export default function DraftExerciseCard({
  exercise,
  exerciseIdentity,
  exerciseIndex,
  totalExercises,
  isDragged,
  isDragArmed,
  menuOpen,
  beforeSlotIsActive,
  onToggleMenu,
  onApplyToAll,
  onRemove,
  onUpdate,
  onSlotDragOver,
  onSlotDrop,
  onPointerDown,
  onPointerRelease,
  onDragStart,
  onDragEnd,
}: Props) {
  return (
    <div className="routineSortableEntry">
      <div
        className={`routineDropSlot ${beforeSlotIsActive ? "active" : ""}`}
        onDragOver={(event) => onSlotDragOver(event, exerciseIndex)}
        onDragEnter={(event) => onSlotDragOver(event, exerciseIndex)}
        onDrop={(event) => onSlotDrop(event, exerciseIndex)}
      />

      <article
        className={`exerciseCard ${isDragged ? "exerciseCardDragging" : ""} ${isDragArmed ? "exerciseCardDragArmed" : ""}`}
        draggable
        onPointerDown={(event) => onPointerDown(event, exerciseIdentity)}
        onPointerUp={onPointerRelease}
        onPointerCancel={onPointerRelease}
        onDragStart={(event) => onDragStart(event, exerciseIdentity)}
        onDragEnd={onDragEnd}
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
              aria-expanded={menuOpen}
              aria-label="Opciones del ejercicio"
              onClick={() => onToggleMenu(exerciseIdentity)}
            >
              <svg className="iconGlyph" viewBox="0 0 24 24">
                <path d="M12 6h.01M12 12h.01M12 18h.01" />
              </svg>
            </button>

            {menuOpen ? (
              <div className="cardMenuPopover" role="menu">
                <button
                  className="cardMenuItem"
                  type="button"
                  role="menuitem"
                  disabled={totalExercises < 2}
                  onClick={() => onApplyToAll(exerciseIdentity)}
                >
                  Aplicar ajustes a todos
                  <span className="cardMenuItemHint">Series, reps y descanso</span>
                </button>
                <button
                  className="cardMenuItem cardMenuItemDanger"
                  type="button"
                  role="menuitem"
                  onClick={() => onRemove(exerciseIdentity)}
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
                onUpdate(exerciseIdentity, {
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
              onChange={(e) => onUpdate(exerciseIdentity, repsFieldPatch("target_reps_min", exercise, e.target.value))}
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
              onChange={(e) => onUpdate(exerciseIdentity, repsFieldPatch("target_reps_max", exercise, e.target.value))}
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
                onChange={(e) => onUpdate(exerciseIdentity, restFieldPatch("rest_minutes", exercise, e.target.value))}
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
                onChange={(e) => onUpdate(exerciseIdentity, restFieldPatch("rest_seconds", exercise, e.target.value))}
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
}
