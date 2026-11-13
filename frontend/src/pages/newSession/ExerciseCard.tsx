import type { CoachNote } from "../../api";
import KebabMenu from "../../components/KebabMenu";
import { APP_LOCALE } from "../../lib/locale";
import { formatExerciseNameForCard, formatRepsRange, formatRestRecommendation } from "../../lib/session/format";
import { setRowAnimationKey } from "../../lib/session/setAnimation";
import type { RoutineExerciseDraft, SessionDraftCommand } from "../../lib/session/types";
import type { EffortScale, WeightUnit } from "../../state/preferences";

type ExerciseCardProps = {
  exercise: RoutineExerciseDraft;
  exIdx: number;
  exerciseNotes: CoachNote[];
  noteExpanded: boolean;
  weightUnit: WeightUnit;
  effortScale: EffortScale;
  uncheckingSetKeys: string[];
  deletingSetKeys: string[];
  hasPendingSetDelete: boolean;
  onToggleNote: (exIdx: number, notes: CoachNote[]) => void;
  onAthleteNoteChange: (exIdx: number, value: string) => void;
  onCommand: (command: SessionDraftCommand) => void;
  onToggleSetCompleted: (exIdx: number, setIdx: number, completed: boolean) => void;
  onRemoveSet: (exIdx: number, setIdx: number) => void;
  onAddSet: (exIdx: number) => void;
  onDuplicateLastSet: (exIdx: number) => void;
  onEditExercise: (exIdx: number) => void;
  onReplaceExercise: (exIdx: number) => void;
  onRemoveExercise: (exIdx: number) => void;
};

export default function ExerciseCard({
  exercise,
  exIdx,
  exerciseNotes,
  noteExpanded,
  weightUnit,
  effortScale,
  uncheckingSetKeys,
  deletingSetKeys,
  hasPendingSetDelete,
  onToggleNote,
  onAthleteNoteChange,
  onCommand,
  onToggleSetCompleted,
  onRemoveSet,
  onAddSet,
  onDuplicateLastSet,
  onEditExercise,
  onReplaceExercise,
  onRemoveExercise,
}: ExerciseCardProps) {
  const hasUnreadNote = exerciseNotes.some((note) => !note.read_at_utc);
  return (
    <div className="exerciseCard">
      <div className="hstack" style={{ justifyContent: "space-between" }}>
        <div>
          <label className="smallLabel">Ejercicio</label>
          <strong>{formatExerciseNameForCard(exercise.name)}</strong>
        </div>
        <div className="hstack compact">
          <span className="chip">Sets: {exercise.sets.length}</span>
          <button
            type="button"
            className={`btn iconBtn notepadBtn ${noteExpanded ? "active" : ""}`}
            onClick={() => onToggleNote(exIdx, exerciseNotes)}
            aria-label={hasUnreadNote ? "Indicacion del entrenador sin leer" : "Notas del ejercicio"}
            title={hasUnreadNote ? "Indicacion del entrenador sin leer" : "Notas del ejercicio"}
          >
            <svg className="iconGlyph" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 3h9l3 3v15H6z" />
              <path d="M6 8h9" />
              <path d="M6 12h9" />
              <path d="M6 16h6" />
            </svg>
            {hasUnreadNote ? <span className="notifyDot" aria-hidden="true" /> : null}
          </button>
          <KebabMenu
            ariaLabel="Opciones del ejercicio"
            actions={[
              { label: "Editar ejercicio", onSelect: () => onEditExercise(exIdx) },
              { label: "Reemplazar", onSelect: () => onReplaceExercise(exIdx) },
              { label: "Eliminar", destructive: true, onSelect: () => onRemoveExercise(exIdx) },
            ]}
          />
        </div>
      </div>
      <div className="chipRow" style={{ marginTop: 8 }}>
        <span className="chip">{`Reps objetivo: ${formatRepsRange(exercise.target_reps_min, exercise.target_reps_max)}`}</span>
        <span className="chip">{`Descanso recomendado: ${formatRestRecommendation(exercise.rest_seconds)}`}</span>
      </div>

      {noteExpanded ? (
        <div className="exerciseNotePanel" style={{ marginTop: 8 }}>
          {exerciseNotes.length === 0 ? (
            <p className="small">Sin indicaciones del entrenador para este ejercicio.</p>
          ) : (
            exerciseNotes.map((note) => (
              <div key={note.id} className="coachNoteBubble">
                <p>{note.body}</p>
                <span className="smallLabel">{new Date(note.created_at_utc).toLocaleString(APP_LOCALE)}</span>
              </div>
            ))
          )}
          <label className="smallLabel">Tu nota para el entrenador</label>
          <input
            className="input"
            value={exercise.athleteNote ?? ""}
            onChange={(e) => onAthleteNoteChange(exIdx, e.target.value)}
            placeholder="observaciones sobre este ejercicio"
          />
        </div>
      ) : null}

      <div className="setGrid">
        {exercise.sets.map((set, setIdx) => {
          const setKey = setRowAnimationKey(exIdx, setIdx);
          const isUnchecking = uncheckingSetKeys.includes(setKey);
          const isDeleting = deletingSetKeys.includes(setKey);

          return (
            <div
              key={setIdx}
              className={`setRowCard ${set.completed ? "completedSetRow" : ""} ${isUnchecking ? "uncheckingSetRow" : ""} ${
                isDeleting ? "deletingSetRow" : ""
              }`.trim()}
            >
              <div className="setRow">
                <span className="setTag">Set {setIdx + 1}</span>
                <div className="setFieldMini">
                  <label className="smallLabel">Peso</label>
                  <input
                    className="input setInputMini setInputWeight"
                    value={set.load}
                    onChange={(e) =>
                      onCommand({
                        type: "set_load",
                        exercise_index: exIdx,
                        set_index: setIdx,
                        value: e.target.value,
                      })
                    }
                    placeholder={weightUnit}
                  />
                </div>
                <div className="setFieldMini">
                  <label className="smallLabel">Reps</label>
                  <input
                    className="input setInputMini setInputReps"
                    value={set.reps}
                    onChange={(e) =>
                      onCommand({
                        type: "set_reps",
                        exercise_index: exIdx,
                        set_index: setIdx,
                        value: e.target.value,
                      })
                    }
                    placeholder={formatRepsRange(exercise.target_reps_min, exercise.target_reps_max)}
                  />
                </div>
                <div className="setFieldMini">
                  <label className="smallLabel">{effortScale === "rir" ? "RIR" : "RPE"}</label>
                  <input
                    className="input setInputMini setInputEffort"
                    value={set.effort}
                    onChange={(e) =>
                      onCommand({
                        type: "set_set_effort",
                        exercise_index: exIdx,
                        set_index: setIdx,
                        value: e.target.value,
                      })
                    }
                    placeholder={effortScale === "rir" ? "0-6" : "0-10"}
                  />
                </div>
                <button
                  className={`btn iconBtn setCompleteBtn completeIconBtn ${set.completed ? "active" : ""}`}
                  type="button"
                  aria-pressed={set.completed}
                  onClick={() => onToggleSetCompleted(exIdx, setIdx, set.completed)}
                  disabled={isDeleting || isUnchecking}
                  aria-label={set.completed ? "Serie completada" : "Marcar serie completada"}
                  title={set.completed ? "Serie completada" : "Marcar serie completada"}
                >
                  <svg className="iconGlyph" viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M8.5 12.2L10.8 14.5L15.6 9.7" />
                  </svg>
                </button>
                <button
                  className="btn iconBtn trashBtn compactTrashBtn"
                  onClick={() => onRemoveSet(exIdx, setIdx)}
                  disabled={exercise.sets.length <= 1 || hasPendingSetDelete || isUnchecking || isDeleting}
                  type="button"
                  aria-label="Eliminar serie"
                  title="Eliminar serie"
                >
                  <svg className="iconGlyph" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3 6h18" />
                    <path d="M8 6V4h8v2" />
                    <path d="M19 6l-1 14H6L5 6" />
                    <path d="M10 10v7" />
                    <path d="M14 10v7" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="hstack compact setActions">
        <button className="btn" onClick={() => onAddSet(exIdx)} disabled={hasPendingSetDelete}>
          + Set vacio
        </button>
        <button className="btn" onClick={() => onDuplicateLastSet(exIdx)} disabled={hasPendingSetDelete}>
          + Duplicar último set
        </button>
      </div>
    </div>
  );
}
