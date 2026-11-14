import Modal from "../../components/Modal";
import { ChartPlaceholder } from "../../components/Charts";
import { formatExerciseNameForList } from "../../lib/exerciseTree";
import {
  compactLabel,
  formatRepsRange,
  formatRestSeconds,
  radarLabelAnchor,
  routineSummaryLine,
  type RoutineGroupSeries,
  type RoutineRadar,
} from "../../lib/routines/summary";
import { formatSetsRange, type RoutineTemplate } from "../../lib/storage";

type Props = {
  routine: RoutineTemplate;
  seriesByGroup: RoutineGroupSeries[];
  maxSeries: number;
  radar: RoutineRadar | null;
  onClose: () => void;
};

export default function RoutineInfoModal({ routine, seriesByGroup, maxSeries, radar, onClose }: Props) {
  return (
    <Modal role="presentation" onClose={onClose} onClick={onClose}>
      <section
        className="modalCard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="routine-info-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sectionHead">
          <h3 id="routine-info-title">{routine.name}</h3>
          <p>{`${routineSummaryLine(routine)} · ${seriesByGroup.length} grupo${seriesByGroup.length === 1 ? "" : "s"}`}</p>
        </div>

        {/* El detalle de cada ejercicio vivia como pila de chips en la lista;
            aqui, que es donde se consulta, se lee mejor. */}
        <div className="rowList" style={{ marginTop: 10 }}>
          {routine.exercises.map((exercise, index) => (
            <div key={`${routine.id}_${exercise.group || ""}_${exercise.name}_${index}`} className="rowItem">
              <div className="rowMain">
                <strong>{formatExerciseNameForList(exercise.name)}</strong>
                <span className="small">
                  {`${formatSetsRange(exercise.target_sets_min, exercise.target_sets_max)} x ${formatRepsRange(exercise.target_reps_min, exercise.target_reps_max)} · descanso ${formatRestSeconds(exercise.rest_seconds)}`}
                </span>
              </div>
            </div>
          ))}
        </div>

        {seriesByGroup.length === 0 || !radar ? (
          <div className="routineInfoLayout" style={{ marginTop: 14 }}>
            <div className="emptyState">
              Esta rutina no tiene series suficientes para mostrar un desglose por grupos.
            </div>
            <div className="routineRadarWrap">
              <ChartPlaceholder variant="radar" height={280} caption="Aún no hay datos para esta gráfica" />
            </div>
          </div>
        ) : (
          <div className="routineInfoLayout" style={{ marginTop: 14 }}>
            <div className="routineInfoList">
              {seriesByGroup.map((entry) => (
                <article key={`${routine.id}_${entry.group}`} className="routineInfoRow">
                  <strong>{entry.group}</strong>
                  <div className="routineInfoRowMeta">
                    <span>{entry.sets} series</span>
                    <span className="small">{`${Math.round(entry.ratio * 100)}%`}</span>
                  </div>
                </article>
              ))}
            </div>

            <div className="routineRadarWrap">
              <svg
                className="routineRadarSvg"
                viewBox={`0 0 ${radar.chartSize} ${radar.chartSize}`}
                role="img"
                aria-label={`Grafico de distribucion de series para ${routine.name}`}
              >
                {radar.rings.map((ring, ringIndex) => (
                  <polygon key={`ring_${ringIndex}`} className="routineRadarRing" points={ring} />
                ))}

                {radar.axes.map((axis) => (
                  <line
                    key={`axis_${axis.group}`}
                    className="routineRadarAxis"
                    x1={radar.center}
                    y1={radar.center}
                    x2={axis.axisX}
                    y2={axis.axisY}
                  />
                ))}

                <polygon className="routineRadarArea" points={radar.valuePolygon} />

                {radar.axes.map((axis) => (
                  <text
                    key={`label_${axis.group}`}
                    className="routineRadarLabel"
                    x={axis.labelX}
                    y={axis.labelY}
                    textAnchor={radarLabelAnchor(axis.labelX, radar.center)}
                  >
                    {compactLabel(axis.group)}
                  </text>
                ))}
              </svg>
              <p className="small routineRadarCaption">
                {`Anillo externo = ${maxSeries} serie${maxSeries === 1 ? "" : "s"}.`}
              </p>
            </div>
          </div>
        )}

        <div className="quickActions" style={{ marginTop: 14 }}>
          <button className="btn" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </section>
    </Modal>
  );
}
