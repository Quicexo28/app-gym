import { useMemo } from "react";

import type { SessionRecord } from "../api";
import { BODY_SLUG_LABELS, type BodySlug } from "../lib/bodyMap";
import { formatDateDayMonth } from "../lib/locale";
import { buildMuscleStats, type MuscleRankEntry } from "../lib/muscleStats";
import { formatWeight } from "../lib/units";
import { usePreferences } from "../state/preferences";

type Catalog = Parameters<typeof buildMuscleStats>[1];

function RankList({
  title,
  badge,
  entries,
  format,
  empty,
}: {
  title: string;
  badge?: { text: string; calculated: boolean };
  entries: MuscleRankEntry[];
  format: (value: number) => string;
  empty: string;
}) {
  return (
    <section className="muscleRank">
      <h4>
        {title}
        {badge ? <span className={`muscleBadge ${badge.calculated ? "calc" : "real"}`}>{badge.text}</span> : null}
      </h4>
      {entries.length === 0 ? (
        <p className="small">{empty}</p>
      ) : (
        <ol>
          {entries.map((entry) => (
            <li key={entry.exercise}>
              <span className="muscleRankName">{entry.exercise.replace(/\s*>\s*/g, " - ")}</span>
              <strong>{format(entry.value)}</strong>
              <span className="small">{entry.detail}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Detalle de un grupo muscular: rutinas recientes y ranking de marcas. */
export default function MuscleDetailPanel({
  slug,
  sessions,
  catalog,
  onClose,
}: {
  slug: BodySlug;
  sessions: SessionRecord[];
  catalog: Catalog;
  onClose: () => void;
}) {
  const { prefs } = usePreferences();
  const unit = prefs.weightUnit === "lb" ? "lb" : "kg";
  const stats = useMemo(() => buildMuscleStats(sessions, catalog, slug), [sessions, catalog, slug]);
  const weight = (v: number) => formatWeight(v, unit);
  const percent = (v: number) => `+${v}%`;

  return (
    <div className="muscleDetail" aria-live="polite">
      <div className="muscleDetailHead">
        <h3>{BODY_SLUG_LABELS[slug]}</h3>
        <button type="button" className="chipButton" onClick={onClose} aria-label="Cerrar detalle">
          Cerrar
        </button>
      </div>

      <section className="muscleRank">
        <h4>Rutinas recientes</h4>
        {stats.recent.length === 0 ? (
          <p className="small">Aún no hay sesiones con trabajo de este grupo.</p>
        ) : (
          <ul>
            {stats.recent.map((item) => (
              <li key={item.start_time}>
                <strong>{item.routineName ?? "Sesión libre"}</strong>
                <span className="small">{`${formatDateDayMonth(item.start_time)} · ${item.sets} series · ${item.exercises.join(", ")}`}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <h4 className="muscleRankTitle">Ranking de marcas</h4>
      <RankList
        title="1RM real"
        badge={{ text: "medido", calculated: false }}
        entries={stats.oneRmReal}
        format={weight}
        empty="Sin series de 1 repetición."
      />
      <RankList
        title="1RM calculado"
        badge={{ text: "estimado", calculated: true }}
        entries={stats.oneRmEstimated}
        format={weight}
        empty="Sin series de 1 a 12 repeticiones con carga."
      />
      <RankList
        title="Mayor volumen en una serie"
        entries={stats.bestSetVolume}
        format={(v) => `${v} kg·rep`}
        empty="Sin series con carga."
      />
      <RankList
        title="Mayor mejora"
        badge={{ text: "estimado", calculated: true }}
        entries={stats.bestImprovement}
        format={percent}
        empty="Hace falta más de una sesión con mejora."
      />
    </div>
  );
}
