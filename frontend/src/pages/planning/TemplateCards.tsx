import type { CycleLevel, PlanningTemplateItem } from "../../api";
import { statusLabel, unitLabelPlural } from "../../lib/planning/builders";

type Props = {
  level: CycleLevel;
  templates: PlanningTemplateItem[];
  onViewTree: (templateId: string) => void;
  onDelete: (templateId: string) => void;
};

export default function TemplateCards({ level, templates, onViewTree, onDelete }: Props) {
  if (templates.length === 0) {
    return null;
  }

  const unitLabel = unitLabelPlural(level);

  return (
    <div className="gridCards">
      {templates.map((item) => (
        <article key={item.id} className="surfaceButton">
          <strong>{item.name}</strong>
          <span className="small">{`Estado: ${statusLabel(item.status)}`}</span>
          <span className="small">{`${unitLabel}: ${item.duration_days || item.duration_weeks || "-"}`}</span>
          <div className="quickActions">
            <button className="btn" onClick={() => onViewTree(item.id)}>
              Ver estructura
            </button>
            <button className="btn" onClick={() => onDelete(item.id)}>
              Borrar
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
