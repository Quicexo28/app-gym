import type { ReactNode } from "react";

import type { PlanningTemplateItem } from "../../api";
import KebabMenu from "../../components/KebabMenu";
import Select from "../../components/Select";
import {
  OBJECTIVE_PRESET_MAP,
  durationLabel,
  type BuilderConfig,
  type LinkBuilder,
  type LinkLevel,
  type LinkSlot,
} from "../../lib/planning/builders";
import ObjectiveControls from "./ObjectiveControls";

type Props = {
  level: LinkLevel;
  builder: LinkBuilder;
  durationDraft: string | null;
  selectedSlot: LinkSlot | null;
  childTemplates: PlanningTemplateItem[];
  childMap: Map<string, PlanningTemplateItem>;
  templateCards: ReactNode;
  onSave: () => void;
  onReset: () => void;
  onConfigChange: (patch: Partial<BuilderConfig>) => void;
  onDurationChange: (rawValue: string) => void;
  onDurationBlur: () => void;
  onSelectPreset: (presetId: string) => void;
  onSelectSlot: (index: number) => void;
  onSlotChange: (index: number, childTemplateId: string) => void;
};

export default function HierarchyTab({
  level,
  builder,
  durationDraft,
  selectedSlot,
  childTemplates,
  childMap,
  templateCards,
  onSave,
  onReset,
  onConfigChange,
  onDurationChange,
  onDurationBlur,
  onSelectPreset,
  onSelectSlot,
  onSlotChange,
}: Props) {
  const sectionTitle = level === "meso" ? "Mesociclo" : "Macrociclo";
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
    <section className="surface stack planningSurface">
      <div className="planningTopRow">
        <div className="quickActions">
          <button className="btn primary" onClick={onSave}>
            Guardar
          </button>
          <KebabMenu
            ariaLabel={`Más opciones del ${sectionTitle.toLowerCase()}`}
            actions={[{ label: "Nuevo limpio", onSelect: onReset }]}
          />
        </div>
      </div>

      <div className="planningEditor">
        <aside className="planningConfigCard">
          <label className="smallLabel">Nombre</label>
          <input
            className="input"
            value={builder.name}
            onChange={(e) => onConfigChange({ name: e.target.value })}
          />

          <label className="smallLabel">{durationLabel(level)}</label>
          <input
            className="input"
            type="number"
            min={1}
            value={durationDraft ?? builder.duration}
            onChange={(e) => onDurationChange(e.target.value)}
            onBlur={onDurationBlur}
            inputMode="numeric"
          />

          <ObjectiveControls
            builder={builder}
            onSelectPreset={onSelectPreset}
            onObjectiveChange={(value) => onConfigChange({ objective: value })}
          />
        </aside>

        <div className="planningEditorMain">
          <div className="planningHeaderCard">
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
                onClick={() => onSelectSlot(slot.index)}
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
              <Select
                value={selectedSlot.childTemplateId}
                onChange={(v) => onSlotChange(selectedSlot.index, v)}
                options={[
                  { value: "", label: "Sin asignar" },
                  ...childTemplates.map((item) => ({
                    value: item.id,
                    label: item.name,
                    disabled: usedIds.has(item.id) && item.id !== selectedSlot.childTemplateId,
                  })),
                ]}
              />
            </aside>
          ) : null}
        </div>
      </div>

      {templateCards}
    </section>
  );
}
