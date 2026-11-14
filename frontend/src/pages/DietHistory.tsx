import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { getDietSummary, getDietTargets, type DietSummaryDayItem } from "../api";
import { DietTrendChart } from "../components/NutritionCharts";
import { addDays, dayKey, formatDayShort, parseDayKey } from "../lib/dates";
import { todayKey } from "../lib/nutrition/dietApi";
import { useAthleteId } from "../state/athlete";
import { useAsyncLoad } from "../lib/useAsyncLoad";

type TrendRange = 7 | 30 | 90;

const RANGES: TrendRange[] = [7, 30, 90];

const NO_DAYS: DietSummaryDayItem[] = [];

function useDietRangeSummary(athleteId: string, range: TrendRange) {
  const { data, loading, error } = useAsyncLoad(
    async () => {
      const today = parseDayKey(todayKey());
      const fromKey = dayKey(addDays(today, -(range - 1)));
      const [summary, targets] = await Promise.all([
        getDietSummary(athleteId, fromKey, todayKey()),
        getDietTargets(athleteId),
      ]);
      return { days: summary.days, targets };
    },
    [athleteId, range],
    { skip: !athleteId },
  );
  return { days: data?.days ?? NO_DAYS, targets: data?.targets ?? null, loading, error };
}

export default function DietHistory() {
  const nav = useNavigate();
  const [athleteId] = useAthleteId();
  const [range, setRange] = useState<TrendRange>(7);
  const { days, targets, loading, error } = useDietRangeSummary(athleteId, range);

  const loggedDays = useMemo(() => days.filter((day) => day.totals.energy_kcal > 0), [days]);

  const avgKcal =
    loggedDays.length > 0
      ? Math.round(loggedDays.reduce((acc, day) => acc + day.totals.energy_kcal, 0) / loggedDays.length)
      : 0;
  const avgProtein =
    loggedDays.length > 0
      ? Math.round(loggedDays.reduce((acc, day) => acc + day.totals.protein_g, 0) / loggedDays.length)
      : 0;

  const energyTarget = targets?.energy_kcal || 0;
  const adherencePct =
    energyTarget > 0 && loggedDays.length > 0
      ? Math.round(
          (loggedDays.filter((day) => day.totals.energy_kcal <= energyTarget * 1.1).length / loggedDays.length) *
            100,
        )
      : null;

  const chartPoints = useMemo(
    () =>
      days.map((day) => ({
        label: formatDayShort(parseDayKey(day.date)),
        value: Math.round(day.totals.energy_kcal),
      })),
    [days],
  );

  return (
    <div className="container stack">
      <header className="titleBlock">
        <h1>Historial de dieta</h1>
      </header>

      {error ? <section className="message error">{error}</section> : null}

      <section className="surface">
        <div className="sectionHead homeHead">
          <h3>Rango</h3>
          <div className="chipRow">
            {RANGES.map((value) => (
              <button
                key={value}
                type="button"
                className={`chipButton ${range === value ? "activeChipButton" : ""}`}
                onClick={() => setRange(value)}
              >
                {`${value} días`}
              </button>
            ))}
          </div>
        </div>
        <div className="quickActions" style={{ marginTop: 10 }}>
          <button type="button" className="btn" onClick={() => nav("/diet")}>
            Volver a Hoy
          </button>
        </div>
      </section>

      {loading ? (
        <section className="surface">
          <div className="emptyState">Cargando histórico...</div>
        </section>
      ) : (
        <>
          <section className="surface">
            <div className="statsGrid">
              <article className="statCard">
                <div className="smallLabel">Promedio kcal</div>
                <strong>{loggedDays.length > 0 ? `${avgKcal} kcal` : "Sin datos"}</strong>
              </article>
              <article className="statCard">
                <div className="smallLabel">Promedio proteína</div>
                <strong>{loggedDays.length > 0 ? `${avgProtein} g` : "Sin datos"}</strong>
              </article>
              <article className="statCard">
                <div className="smallLabel">Días registrados</div>
                <strong>{`${loggedDays.length} / ${days.length}`}</strong>
              </article>
              <article className="statCard">
                <div className="smallLabel">Dentro del objetivo</div>
                <strong>{adherencePct !== null ? `${adherencePct}%` : "Sin objetivo"}</strong>
              </article>
            </div>
          </section>

          <section className="surface">
            <div className="sectionHead">
              <h3>Calorías por día</h3>
              <p>Línea de energía registrada, con el objetivo diario como referencia.</p>
            </div>
            <div style={{ marginTop: 12 }}>
              <DietTrendChart points={chartPoints} target={energyTarget > 0 ? energyTarget : null} unit="kcal" />
            </div>
          </section>

          <section className="surface">
            <div className="sectionHead">
              <h3>Día a día</h3>
            </div>
            <div className="stack compactStack" style={{ marginTop: 12 }}>
              {[...days].reverse().map((day) => (
                <article key={day.date} className="listItem">
                  <div className="listMain">
                    <strong>{formatDayShort(parseDayKey(day.date))}</strong>
                    <span className="small">
                      {day.totals.energy_kcal > 0
                        ? `${Math.round(day.totals.energy_kcal)} kcal | P ${Math.round(day.totals.protein_g)} g | C ${Math.round(day.totals.carbs_g)} g | G ${Math.round(day.totals.fat_g)} g`
                        : "Sin registros"}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
