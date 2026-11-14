import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { getDietSummary, getDietTargets, type DietSummaryDayItem, type NutritionTarget } from "../../api";
import ConfirmDialog from "../../components/ConfirmDialog";
import HistoryCalendar from "../../components/HistoryCalendar";
import { deleteDietDay } from "../../lib/historyActions";
import { useHistoryDelete } from "../../lib/useHistoryDelete";
import { dayKey, formatDayLong, parseDayKey, relativeDayLabel } from "../../lib/dates";
import { monthOf, monthRange, shiftMonth, type MonthView } from "../../lib/historyMonth";
import { useAthleteId } from "../../state/athlete";
import { errorMessage } from "../../lib/errors";


export default function DietTab() {
  const [athleteId] = useAthleteId();
  const todayKey = dayKey(new Date());

  const [view, setView] = useState<MonthView>(() => monthOf(new Date()));
  const [days, setDays] = useState<DietSummaryDayItem[]>([]);
  const [targets, setTargets] = useState<NutritionTarget | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const del = useHistoryDelete();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!athleteId) {
        setDays([]);
        return;
      }
      if (reloadKey === 0) setLoading(true);
      setError("");
      const { from, to } = monthRange(view);
      try {
        const [summary, targetsRes] = await Promise.all([
          getDietSummary(athleteId, from, to),
          getDietTargets(athleteId),
        ]);
        if (cancelled) return;
        setDays(summary.days);
        setTargets(targetsRes);
      } catch (cause: unknown) {
        if (cancelled) return;
        setDays([]);
        setError(errorMessage(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [athleteId, view, reloadKey]);

  const logged = useMemo(() => days.filter((d) => d.totals.energy_kcal > 0), [days]);
  const marked = useMemo(() => Object.fromEntries(logged.map((d) => [d.date, 1])), [logged]);
  const cards = useMemo(() => [...logged].sort((a, b) => (a.date < b.date ? 1 : -1)), [logged]);

  const avgKcal = logged.length ? Math.round(logged.reduce((a, d) => a + d.totals.energy_kcal, 0) / logged.length) : 0;
  const avgProtein = logged.length ? Math.round(logged.reduce((a, d) => a + d.totals.protein_g, 0) / logged.length) : 0;
  const target = targets?.energy_kcal || 0;

  function askDeleteDay(day: DietSummaryDayItem) {
    del.requestDelete({
      busyKey: `day:${day.date}`,
      title: "Eliminar día completo",
      message: `Se borrarán todos los registros de comida del ${formatDayLong(parseDayKey(day.date))}.`,
      confirmLabel: "Eliminar día",
      undoMessage: "Día de dieta eliminado.",
      run: () => deleteDietDay(athleteId, day.date),
      onChanged: () => setReloadKey((k) => k + 1),
    });
  }

  function changeMonth(delta: number) {
    setView((prev) => shiftMonth(prev, delta));
    setSelectedDay(null);
  }

  function selectDay(key: string) {
    const next = selectedDay === key ? null : key;
    setSelectedDay(next);
    if (next) document.getElementById(`histday-${next}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="stack">
      <ConfirmDialog request={del.confirm} onClose={del.closeConfirm} />
      {error || del.error ? <section className="message error">{error || del.error}</section> : null}

      <section className="surface">
        <HistoryCalendar
          view={view}
          marked={marked}
          selected={selectedDay}
          todayKey={todayKey}
          onSelect={selectDay}
          onShiftMonth={changeMonth}
          markLabel={() => "con registro de comida"}
        />
      </section>

      <section className="histStats" aria-label="Resumen del mes">
        <article className="histStat">
          <strong>{logged.length}</strong>
          <span>días con registro</span>
        </article>
        <article className="histStat">
          <strong>{logged.length ? `${avgKcal}` : "–"}</strong>
          <span>kcal promedio</span>
        </article>
        <article className="histStat">
          <strong>{logged.length ? `${avgProtein} g` : "–"}</strong>
          <span>proteína promedio</span>
        </article>
      </section>

      {loading ? (
        <section className="surface">
          <div className="emptyState">Cargando dieta...</div>
        </section>
      ) : cards.length === 0 ? (
        <section className="surface">
          <div className="emptyState">
            Sin registros de comida este mes. <Link to="/diet">Ir a Dieta.</Link>
          </div>
        </section>
      ) : (
        cards.map((day) => {
          const date = parseDayKey(day.date);
          const rel = relativeDayLabel(day.date, todayKey);
          const pct = target > 0 ? Math.round((day.totals.energy_kcal / target) * 100) : null;
          return (
            <section
              key={day.date}
              id={`histday-${day.date}`}
              className={`surface histDay ${selectedDay === day.date ? "selected" : ""}`}
            >
              <header className="histDayHead">
                <div className="histDateBadge" aria-hidden="true">
                  <strong>{date.getDate()}</strong>
                  <span>{["dom", "lun", "mar", "mié", "jue", "vie", "sáb"][date.getDay()]}</span>
                </div>
                <div className="histDayInfo">
                  <h3>{rel || formatDayLong(date)}</h3>
                  <span className="small">
                    {pct !== null ? `${Math.round(day.totals.energy_kcal)} kcal · ${pct}% del objetivo` : `${Math.round(day.totals.energy_kcal)} kcal`}
                  </span>
                </div>
              </header>
              {pct !== null ? (
                <div className="histBar" aria-hidden="true">
                  <i style={{ width: `${Math.min(pct, 100)}%` }} className={pct > 110 ? "over" : ""} />
                </div>
              ) : null}
              <div className="histChips">
                <span className="histChip protein">{`P ${Math.round(day.totals.protein_g)} g`}</span>
                <span className="histChip carbs">{`C ${Math.round(day.totals.carbs_g)} g`}</span>
                <span className="histChip fat">{`G ${Math.round(day.totals.fat_g)} g`}</span>
              </div>
              <button
                type="button"
                className="histBtn dangerSoft histDayDelete"
                disabled={del.busyKey === `day:${day.date}`}
                onClick={() => askDeleteDay(day)}
              >
                {del.busyKey === `day:${day.date}` ? "Eliminando día..." : "Eliminar día completo"}
              </button>
            </section>
          );
        })
      )}
    </div>
  );
}
