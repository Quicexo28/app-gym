import { useState } from "react";

import Modal from "../../components/Modal";
import { MAX_REST_MINUTES, parseBoundedInt, splitRestSeconds } from "../../lib/routines/draft";
import { isUnilateralName } from "../../lib/laterality";
import { formatExerciseNameForCard } from "../../lib/session/format";
import type { RoutineExerciseDraft } from "../../lib/session/types";

export type ExerciseSettings = {
  sets: number;
  reps_min: number;
  reps_max: number;
  rest_seconds: number;
  unilateral: boolean;
};

type ExerciseEditModalProps = {
  exercise: RoutineExerciseDraft;
  onSave: (settings: ExerciseSettings) => void;
  onClose: () => void;
};

/** Card para ajustar series, rango de reps y descanso de un ejercicio de la sesión activa. */
export default function ExerciseEditModal({ exercise, onSave, onClose }: ExerciseEditModalProps) {
  const rest = splitRestSeconds(exercise.rest_seconds);
  const [sets, setSets] = useState(String(exercise.sets.length));
  const [repsMin, setRepsMin] = useState(String(exercise.target_reps_min));
  const [repsMax, setRepsMax] = useState(String(exercise.target_reps_max));
  const [restMin, setRestMin] = useState(rest.rest_minutes);
  const [restSec, setRestSec] = useState(rest.rest_seconds);
  const [unilateral, setUnilateral] = useState(isUnilateralName(exercise.name));

  function save() {
    const min = parseBoundedInt(repsMin, exercise.target_reps_min, 1, 100);
    const max = parseBoundedInt(repsMax, exercise.target_reps_max, 1, 100);
    const restTotal =
      parseBoundedInt(restMin, 0, 0, MAX_REST_MINUTES) * 60 + parseBoundedInt(restSec, 0, 0, 59);
    onSave({
      sets: parseBoundedInt(sets, exercise.sets.length, 1, 30),
      reps_min: Math.min(min, max),
      reps_max: Math.max(min, max),
      rest_seconds: Math.min(restTotal, MAX_REST_MINUTES * 60),
      unilateral,
    });
  }

  return (
    <Modal role="dialog" aria-modal="true" aria-label="Editar ejercicio" onClose={onClose} onClick={onClose}>
      <div className="modalCard closeRoutineModal" onClick={(event) => event.stopPropagation()}>
        <div className="sectionHead">
          <h3>Editar ejercicio</h3>
          <p>{formatExerciseNameForCard(exercise.name)}</p>
        </div>

        <div className="splitGrid" style={{ marginTop: 12 }}>
          <div>
            <label className="smallLabel">Series</label>
            <input className="input" type="number" min={1} max={30} inputMode="numeric" value={sets} onChange={(e) => setSets(e.target.value)} />
          </div>
          <div>
            <label className="smallLabel">Reps mínimo</label>
            <input className="input" type="number" min={1} max={100} inputMode="numeric" value={repsMin} onChange={(e) => setRepsMin(e.target.value)} />
          </div>
          <div>
            <label className="smallLabel">Reps máximo</label>
            <input className="input" type="number" min={1} max={100} inputMode="numeric" value={repsMax} onChange={(e) => setRepsMax(e.target.value)} />
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
                value={restMin}
                onChange={(e) => setRestMin(e.target.value)}
              />
              <span className="smallLabel" style={{ margin: 0 }}>min</span>
              <input
                className="input"
                type="number"
                min={0}
                max={59}
                inputMode="numeric"
                style={{ width: 62, minWidth: 62, padding: "8px 8px", textAlign: "center" }}
                value={restSec}
                onChange={(e) => setRestSec(e.target.value)}
              />
              <span className="smallLabel" style={{ margin: 0 }}>seg</span>
            </div>
          </div>
        </div>
        <label className="hstack compact" style={{ gap: 6, marginTop: 12 }}>
          <input type="checkbox" checked={unilateral} onChange={(e) => setUnilateral(e.target.checked)} />
          <span>Unilateral (un lado a la vez)</span>
        </label>
        <p className="small" style={{ marginTop: 8 }}>
          Si bajas las series, solo se quitan las últimas series vacías.
        </p>

        <div className="closeRoutineActions">
          <button className="btn primary" type="button" onClick={save}>
            Guardar
          </button>
          <button className="btn ghost" type="button" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </div>
    </Modal>
  );
}
