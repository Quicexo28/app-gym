import { OBJECTIVE_PRESETS, type BuilderConfig } from "../../lib/planning/builders";

type Props = {
  builder: BuilderConfig;
  onSelectPreset: (presetId: string) => void;
  onObjectiveChange: (value: string) => void;
};

export default function ObjectiveControls({ builder, onSelectPreset, onObjectiveChange }: Props) {
  return (
    <>
      <label className="smallLabel">Categoria / objetivo base</label>
      <div className="chipRow">
        {OBJECTIVE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`chipButton ${builder.objectivePresetId === preset.id ? "activeChipButton" : ""}`}
            onClick={() => onSelectPreset(preset.id)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <label className="smallLabel">Objetivo final</label>
      <input
        className="input"
        value={builder.objective}
        onChange={(e) => onObjectiveChange(e.target.value)}
        placeholder="Puedes personalizar el objetivo aquí"
      />
    </>
  );
}
