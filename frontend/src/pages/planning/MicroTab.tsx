import type { ReactNode } from "react";

import KebabMenu from "../../components/KebabMenu";
import Select from "../../components/Select";
import { durationLabel, type MicroBuilder, type MicroSlot } from "../../lib/planning/builders";
import type { RoutineTemplate } from "../../lib/storage";

type Props = {
  builder: MicroBuilder;
  durationDraft: string | null;
  selectedSlotIndex: number;
  selectedSlotData: MicroSlot | null;
  routines: RoutineTemplate[];
  routineMap: Map<string, RoutineTemplate>;
  templateCards: ReactNode;
  onSave: () => void;
  onReset: () => void;
  onNameChange: (name: string) => void;
  onDurationChange: (rawValue: string) => void;
  onDurationBlur: () => void;
  onSelectSlot: (index: number) => void;
  onSlotChange: (index: number, patch: Partial<MicroSlot>) => void;
};

export default function MicroTab({
  builder,
  durationDraft,
  selectedSlotIndex,
  selectedSlotData,
  routines,
  routineMap,
  templateCards,
  onSave,
  onReset,
  onNameChange,
  onDurationChange,
  onDurationBlur,
  onSelectSlot,
  onSlotChange,
}: Props) {
  return (
    <section className="surface stack planningSurface">
      <div className="planningTopRow">
        <div className="quickActions">
          <button className="btn primary" onClick={onSave}>
            Guardar
          </button>
          <KebabMenu
            ariaLabel="Más opciones del microciclo"
            actions={[{ label: "Nuevo limpio", onSelect: onReset }]}
          />
        </div>
      </div>

      <div className="planningEditor">
        <aside className="planningConfigCard">
          <label className="smallLabel">Nombre</label>
          <input className="input" value={builder.name} onChange={(e) => onNameChange(e.target.value)} />

          <label className="smallLabel">{durationLabel("micro")}</label>
          <input
            className="input"
            type="number"
            min={1}
            value={durationDraft ?? builder.duration}
            onChange={(e) => onDurationChange(e.target.value)}
            onBlur={onDurationBlur}
            inputMode="numeric"
          />
        </aside>

        <div className="planningEditorMain">
          <div className="planningMosaic">
            {builder.slots.map((slot) => {
              const routineName = slot.routineId ? routineMap.get(slot.routineId)?.name : "";
              return (
                <button
                  key={`micro_slot_${slot.index}`}
                  className={`planningSquare ${selectedSlotIndex === slot.index ? "active" : ""}`}
                  onClick={() => onSelectSlot(slot.index)}
                >
                  <span className="planningSquareIdx">{`S${slot.index}`}</span>
                  <strong>{slot.title || `Sesión ${slot.index}`}</strong>
                  <span className="small">{routineName || "Elegir rutina"}</span>
                </button>
              );
            })}
          </div>

          {selectedSlotData ? (
            <aside className="planningInspector">
              <h4>{`Sesión ${selectedSlotData.index}`}</h4>
              <label className="smallLabel">Título</label>
              <input
                className="input"
                value={selectedSlotData.title}
                onChange={(e) => onSlotChange(selectedSlotData.index, { title: e.target.value })}
              />

              <label className="smallLabel">Rutina</label>
              <Select
                value={selectedSlotData.routineId}
                onChange={(v) => onSlotChange(selectedSlotData.index, { routineId: v })}
                options={[
                  { value: "", label: "Sin rutina" },
                  ...routines.map((routine) => ({ value: routine.id, label: routine.name })),
                ]}
              />

              {routines.length === 0 ? (
                <div className="small" style={{ marginTop: 8 }}>
                  No hay rutinas locales. Crea rutinas para asignarlas a las sesiones.
                </div>
              ) : null}
            </aside>
          ) : null}
        </div>
      </div>

      {templateCards}
    </section>
  );
}
