import { MONTHS_LONG, WEEKDAY_LETTERS } from "../lib/dates";
import { buildMonthWeeks, type MonthView } from "../lib/historyMonth";

type HistoryCalendarProps = {
  view: MonthView;
  /** Día "YYYY-MM-DD" -> cuántos registros hay. Solo estos días se marcan. */
  marked: Record<string, number>;
  selected: string | null;
  todayKey: string;
  onSelect: (key: string) => void;
  onShiftMonth: (delta: number) => void;
  /** Texto accesible de un día marcado, p. ej. "2 sesiones". */
  markLabel: (count: number) => string;
};

export default function HistoryCalendar({
  view,
  marked,
  selected,
  todayKey,
  onSelect,
  onShiftMonth,
  markLabel,
}: HistoryCalendarProps) {
  const weeks = buildMonthWeeks(view);
  return (
    <div className="histCal">
      <div className="histCalHead">
        <button type="button" className="histCalNav" aria-label="Mes anterior" onClick={() => onShiftMonth(-1)}>
          ‹
        </button>
        <strong>{`${MONTHS_LONG[view.month]} ${view.year}`}</strong>
        <button type="button" className="histCalNav" aria-label="Mes siguiente" onClick={() => onShiftMonth(1)}>
          ›
        </button>
      </div>
      <div className="histCalGrid" role="grid">
        {WEEKDAY_LETTERS.map((letter) => (
          <span key={letter} className="histCalWeekday" aria-hidden="true">
            {letter}
          </span>
        ))}
        {weeks.flat().map((key, idx) => {
          if (!key) return <span key={`empty-${idx}`} className="histCalCell empty" aria-hidden="true" />;
          const count = marked[key] || 0;
          const dayNumber = Number(key.slice(8, 10));
          const classes = [
            "histCalCell",
            count > 0 ? "marked" : "",
            key === todayKey ? "today" : "",
            key === selected ? "selected" : "",
          ]
            .filter(Boolean)
            .join(" ");
          if (count === 0) {
            return (
              <span key={key} className={classes} role="gridcell">
                {dayNumber}
              </span>
            );
          }
          return (
            <button
              key={key}
              type="button"
              className={classes}
              role="gridcell"
              aria-label={`${dayNumber} de ${MONTHS_LONG[view.month]}, ${markLabel(count)}`}
              aria-pressed={key === selected}
              onClick={() => onSelect(key)}
            >
              {dayNumber}
              <i className="histCalDot" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
