import type { CycleStartMode, PlanningTemplateItem } from "../../api";
import DatePicker from "../../components/DatePicker";
import Select from "../../components/Select";
import { levelLabel } from "../../lib/planning/builders";

type Props = {
  subjects: ReadonlyArray<{ id: string; label: string }>;
  allTemplates: PlanningTemplateItem[];
  athleteId: string | null | undefined;
  assignmentAthleteId: string;
  assignmentTemplateId: string;
  startMode: CycleStartMode;
  startDate: string;
  toleranceDays: string;
  timezone: string;
  onAthleteChange: (value: string) => void;
  onTemplateChange: (value: string) => void;
  onStartModeChange: (value: CycleStartMode) => void;
  onStartDateChange: (value: string) => void;
  onToleranceChange: (value: string) => void;
  onTimezoneChange: (value: string) => void;
  onSubmit: () => void;
  onReload: () => void;
};

export default function AssignmentsTab({
  subjects,
  allTemplates,
  athleteId,
  assignmentAthleteId,
  assignmentTemplateId,
  startMode,
  startDate,
  toleranceDays,
  timezone,
  onAthleteChange,
  onTemplateChange,
  onStartModeChange,
  onStartDateChange,
  onToleranceChange,
  onTimezoneChange,
  onSubmit,
  onReload,
}: Props) {
  return (
    <section className="surface stack planningSurface">
      <div className="sectionHead">
        <h3>Asignar ciclo</h3>
      </div>
      <Select
        ariaLabel="Sujeto"
        value={assignmentAthleteId}
        onChange={onAthleteChange}
        options={[
          { value: "", label: "Sujeto" },
          ...subjects.map((subject) => ({ value: subject.id, label: subject.label })),
        ]}
      />
      <Select
        ariaLabel="Plantilla"
        value={assignmentTemplateId}
        onChange={onTemplateChange}
        options={[
          { value: "", label: "Plantilla" },
          ...allTemplates.map((item) => ({ value: item.id, label: `${item.name} (${levelLabel(item.level)})` })),
        ]}
      />
      <Select
        value={startMode}
        onChange={(v) => onStartModeChange(v as CycleStartMode)}
        options={[
          { value: "auto_on_first_session", label: "Inicio auto (primera sesión)" },
          { value: "manual", label: "Inicio manual" },
        ]}
      />
      {startMode === "manual" ? <DatePicker value={startDate} onChange={onStartDateChange} /> : null}
      <input
        className="input"
        value={toleranceDays}
        onChange={(e) => onToleranceChange(e.target.value)}
        placeholder="Tolerancia días"
      />
      <input className="input" value={timezone} onChange={(e) => onTimezoneChange(e.target.value)} placeholder="Timezone" />
      <div className="quickActions">
        <button className="btn primary" onClick={onSubmit} disabled={!assignmentAthleteId || !assignmentTemplateId}>
          Crear asignación
        </button>
        <button className="btn" onClick={onReload} disabled={!athleteId}>
          Recargar
        </button>
      </div>
    </section>
  );
}
