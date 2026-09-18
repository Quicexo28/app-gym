import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getRunSummary } from "../api";
import type { AthleteInsights, RunSummaryResponse, TrainingEvent } from "../api";
import { formatDateTime } from "../lib/locale";

const EVENT_LABEL: Record<TrainingEvent["kind"], string> = {
  personal_record: "Marca personal",
  stall: "Estancado",
  dropped_exercise: "Sin entrenar",
  volume_drop: "Bajó el volumen",
};

/** Agrupa por tipo para no repetir la misma regla en cada linea. */
function groupEvents(events: TrainingEvent[]): [TrainingEvent["kind"], TrainingEvent[]][] {
  const grouped = new Map<TrainingEvent["kind"], TrainingEvent[]>();
  for (const event of events) {
    const bucket = grouped.get(event.kind);
    if (bucket) bucket.push(event);
    else grouped.set(event.kind, [event]);
  }
  return [...grouped.entries()];
}

function kg(value: number): string {
  return `${Math.round(value * 10) / 10} kg`;
}

/**
 * Lo que el motor puede sostener con datos: el último tope y un intervalo
 * medido sobre el historial del propio atleta. El valor puntual es la
 * persistencia a propósito — en tres backtests ningún modelo ajustado le ganó.
 */
function Predictions({ insights }: { insights: AthleteInsights }) {
  if (insights.predictions.length === 0) {
    return (
      <div className="emptyState">
        Aún no hay historial suficiente para estimar tus próximas series.
      </div>
    );
  }

  return (
    <div className="rowList">
      {insights.predictions.map((prediction) => (
        <div key={prediction.exercise} className="rowItem">
          <div className="rowMain">
            <strong>{prediction.exercise}</strong>
            <span className="small">
              {`${kg(prediction.low_kg)} a ${kg(prediction.high_kg)} · ${Math.round(
                prediction.coverage * 100,
              )}% de las veces · ${prediction.basis_sessions} sesiones`}
            </span>
          </div>
          <span className="chip">{kg(prediction.point_kg)}</span>
        </div>
      ))}
    </div>
  );
}

export default function RunDetail() {
  const params = useParams();
  const runId = decodeURIComponent(params.runId || "");
  const [data, setData] = useState<RunSummaryResponse | null>(null);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    getRunSummary(runId)
      .then((response) => {
        if (cancelled) return;
        setData(response);
        setErr("");
      })
      .catch((e) => {
        if (cancelled) return;
        setData(null);
        setErr(String(e?.message || e));
      });

    return () => {
      cancelled = true;
    };
  }, [runId]);

  const insights = data?.insights ?? null;
  const record = data?.prediction_track_record ?? null;

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Tu entrenamiento</h1>
        <div className="quickActions">
          <Link className="btn" to="/predictions">
            Volver
          </Link>
        </div>
      </header>

      {err ? <section className="message error">{err}</section> : null}

      {!data ? (
        <section className="surface">
          <div className="emptyState">Cargando...</div>
        </section>
      ) : (
        <>
          <section className="surface">
            <div className="sectionHead">
              <h3>Próxima serie tope</h3>
              <p>
                Estimación a partir de tu historial: el peso de tu última serie tope y el rango en
                el que sueles moverte.
              </p>
            </div>
            {insights ? (
              <Predictions insights={insights} />
            ) : (
              <div className="emptyState">Sin datos suficientes.</div>
            )}
            {record && record.resueltas > 0 ? (
              <p className="small" style={{ marginTop: 12 }}>
                {`Aciertos comprobados: ${record.resueltas} estimaciones ya se contrastaron` +
                  (record.cobertura_intervalo != null
                    ? ` · el valor real cayó dentro del rango el ${Math.round(
                        record.cobertura_intervalo * 100,
                      )}% de las veces`
                    : "")}
              </p>
            ) : null}
          </section>

          {insights && insights.events.length > 0 ? (
            <section className="surface">
              <div className="sectionHead">
                <h3>Qué pasó</h3>
                <p>Cada aviso trae la regla que lo detectó, para que puedas discutirlo.</p>
              </div>
              {groupEvents(insights.events).map(([kind, events]) => (
                <div key={kind} className="eventGroup">
                  <div className="sectionHead homeHead">
                    <h4>{EVENT_LABEL[kind] || kind}</h4>
                    <span className="chip">{events.length}</span>
                  </div>
                  {/* La regla va una vez por grupo: repetirla en cada linea era
                      ruido, pero sin ella el aviso no se puede auditar. */}
                  <p className="eventRule">{events[0].rule}</p>
                  <div className="rowList">
                    {events.slice(0, 6).map((event, index) => (
                      <div key={`${event.exercise}_${index}`} className="rowItem">
                        <div className="rowMain">
                          <span className="small">{event.detail}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ) : null}

          {insights && insights.exercises.length > 0 ? (
            <section className="surface">
              <div className="sectionHead homeHead">
                <h3>Estado por ejercicio</h3>
                <span className="small">{`${insights.sessions_last_4w} sesiones en 4 semanas`}</span>
              </div>
              <div className="rowList">
                {insights.exercises.map((exercise) => (
                  <div key={exercise.name} className="rowItem">
                    <div className="rowMain">
                      <strong>{exercise.name}</strong>
                      <span className="small">
                        {`Tope ${kg(exercise.last_top_load_kg)} · mejor ${kg(
                          exercise.best_top_load_kg,
                        )} · 1RM est. ${kg(exercise.e1rm_kg)} · ${exercise.sets_last_4w} series en 4 semanas`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="surface">
            <p className="small">
              {`Cálculo del ${formatDateTime(data.generated_at_utc)}. Las estimaciones salen de tu
              propio historial: no predicen tu progreso a meses vista, y el rango es honesto sobre
              lo que no se puede saber.`}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
