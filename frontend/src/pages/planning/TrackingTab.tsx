import type {
  CycleStatus,
  PlanningAssignment,
  PlanningAssignmentDetail,
  PlanningAssignmentMetrics,
  PlanningAthleteOverview,
} from "../../api";
import { levelLabel, statusLabel, unitLabelPlural, unitLabelSingular } from "../../lib/planning/builders";

type Props = {
  loadingAssignments: boolean;
  assignments: PlanningAssignment[];
  selectedAssignmentId: string;
  assignmentDetail: PlanningAssignmentDetail | null;
  assignmentMetrics: PlanningAssignmentMetrics | null;
  overview: PlanningAthleteOverview | null;
  onSelectAssignment: (assignmentId: string) => void;
  onReconcile: (assignmentId: string) => void;
  onChangeStatus: (assignmentId: string, status: CycleStatus) => void;
};

export default function TrackingTab({
  loadingAssignments,
  assignments,
  selectedAssignmentId,
  assignmentDetail,
  assignmentMetrics,
  overview,
  onSelectAssignment,
  onReconcile,
  onChangeStatus,
}: Props) {
  return (
    <section className="surface stack planningSurface">
      <div className="sectionHead">
        <h3>Seguimiento</h3>
      </div>

      {loadingAssignments ? <div className="emptyState">Cargando asignaciones...</div> : null}
      {!loadingAssignments ? (
        <div className="gridCards">
          {assignments.map((item) => (
            <article key={item.id} className="surfaceButton">
              <strong>{item.template_name || item.template_id}</strong>
              <span className="small">{`${levelLabel(item.level)} | ${statusLabel(item.status)}`}</span>
              <span className="small">{`Adherencia: ${Math.round((item.adherence || 0) * 100)}%`}</span>
              <div className="quickActions">
                <button className="btn" onClick={() => onSelectAssignment(item.id)}>
                  Detalle
                </button>
                <button className="btn" onClick={() => onReconcile(item.id)}>
                  Reconciliar
                </button>
                <button className="btn" onClick={() => onChangeStatus(item.id, "archived")}>
                  Archivar
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {selectedAssignmentId && assignmentDetail ? (
        <article className="surface">
          <div className="sectionHead">
            <h4>Detalle asignación</h4>
            <p>{assignmentDetail.template_name || assignmentDetail.template_id}</p>
          </div>
          <div className="chipRow" style={{ marginTop: 10 }}>
            <span className="chip">{`Estado: ${statusLabel(assignmentDetail.status)}`}</span>
            <span className="chip">
              {`${unitLabelPlural(assignmentDetail.level)}: ${assignmentDetail.blocks_completed || 0}/${
                assignmentDetail.blocks_total || 0
              }`}
            </span>
            <button className="btn" onClick={() => onChangeStatus(selectedAssignmentId, "active")}>
              Activar
            </button>
            <button className="btn" onClick={() => onChangeStatus(selectedAssignmentId, "completed")}>
              Completar
            </button>
          </div>
          <div className="stack compactStack" style={{ marginTop: 10 }}>
            {assignmentDetail.blocks.slice(0, 12).map((block) => (
              <article key={block.id} className="listItem">
                <div className="listMain">
                  <strong>{block.title}</strong>
                  <span className="small">{`${unitLabelSingular(assignmentDetail.level)} ${block.relative_day}`}</span>
                </div>
                <div className="listMeta">
                  <span className="small">{`Estado: ${block.status}`}</span>
                  <span className="small">{`Objetivo: ${block.target_date || "-"}`}</span>
                </div>
              </article>
            ))}
          </div>
        </article>
      ) : null}

      {assignmentMetrics ? (
        <article className="surface">
          <div className="sectionHead">
            <h4>Métricas</h4>
          </div>
          <div className="statsGrid" style={{ marginTop: 10 }}>
            <article className="statCard">
              <div className="smallLabel">Volumen</div>
              <strong>{Math.round(assignmentMetrics.totals.volume_load_kg)}</strong>
            </article>
            <article className="statCard">
              <div className="smallLabel">Fatiga</div>
              <strong>{Math.round(assignmentMetrics.totals.fatigue_load)}</strong>
            </article>
            <article className="statCard">
              <div className="smallLabel">Frecuencia</div>
              <strong>{assignmentMetrics.totals.frequency_sessions}</strong>
            </article>
            <article className="statCard">
              <div className="smallLabel">Adherencia</div>
              <strong>{`${Math.round(assignmentMetrics.totals.adherence * 100)}%`}</strong>
            </article>
          </div>
        </article>
      ) : null}

      {overview ? (
        <article className="surface">
          <div className="sectionHead">
            <h4>Overview sujeto</h4>
            <p>{`Activos: ${overview.active_assignments.length}`}</p>
          </div>
          <ul className="compactList">
            {overview.active_assignments.slice(0, 5).map((item) => (
              <li key={`ov_${item.id}`}>{`${item.template_name || item.template_id} (${statusLabel(item.status)})`}</li>
            ))}
          </ul>
        </article>
      ) : null}
    </section>
  );
}
