type SwitchProps = {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  hint?: string;
  /** Versión reducida para barras (topbar): sin hint y con pista más chica. */
  compact?: boolean;
};

export default function Switch({ label, checked, onChange, hint, compact }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`switch ${compact ? "compact" : ""} ${checked ? "on" : ""}`.replace(/\s+/g, " ").trim()}
      onClick={() => onChange(!checked)}
    >
      <span className="switchText">
        <span className="switchLabel">{label}</span>
        {hint && !compact ? <span className="small switchHint">{hint}</span> : null}
      </span>
      <span className="switchTrack" aria-hidden="true">
        <span className="switchKnob" />
      </span>
    </button>
  );
}
