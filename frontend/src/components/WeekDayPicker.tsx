import { useMemo } from "react";

import { WEEKDAY_LETTERS, addDays, dayKey, formatDayRange, parseDayKey, weekdayIndex } from "../lib/dates";

export type DayMarks = { done?: boolean; planned?: boolean };

type WeekDayPickerProps = {
  selectedKey: string;
  todayKey: string;
  onSelect: (key: string) => void;
  /** Marcas por día (punto solido = done, anillo = planned). Sin esta prop no se pinta ninguna marca. */
  getMarks?: (dayKey: string) => DayMarks;
};

/**
 * Selector semanal de días (7 días, el elegido al centro con 3 antes/después),
 * extraido de `Home.tsx` para que `/diet` use la misma disposicion y
 * comportamiento en vez de una pestaña fija "Hoy".
 */
export default function WeekDayPicker({ selectedKey, todayKey, onSelect, getMarks }: WeekDayPickerProps) {
  const selectedDate = useMemo(() => parseDayKey(selectedKey), [selectedKey]);

  const windowDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, idx) => {
      const date = addDays(selectedDate, idx - 3);
      const key = dayKey(date);
      const marks = getMarks?.(key) ?? {};
      return {
        key,
        date,
        letter: WEEKDAY_LETTERS[weekdayIndex(date)],
        hasSession: !!marks.done,
        hasPlan: !!marks.planned,
      };
    });
  }, [selectedDate, getMarks]);

  function shiftDays(offsetDays: number) {
    onSelect(dayKey(addDays(selectedDate, offsetDays)));
  }

  return (
    <section className="surface weekPicker">
      <div className="weekPickerHead">
        <button type="button" className="weekNavBtn" aria-label="Semana anterior" onClick={() => shiftDays(-7)}>
          ‹
        </button>
        <div className="hstack compact weekPickerLabel">
          <span className="small">{formatDayRange(windowDays[0].date)}</span>
          {selectedKey !== todayKey ? (
            <button type="button" className="btn btnSlim" onClick={() => onSelect(todayKey)}>
              Hoy
            </button>
          ) : null}
        </div>
        <button type="button" className="weekNavBtn" aria-label="Semana siguiente" onClick={() => shiftDays(7)}>
          ›
        </button>
      </div>

      <div className="weekStrip">
        {windowDays.map((day) => (
          <button
            key={day.key}
            type="button"
            className={`dayPill ${day.key === selectedKey ? "active" : ""} ${day.key === todayKey ? "today" : ""}`.trim()}
            onClick={() => onSelect(day.key)}
            aria-pressed={day.key === selectedKey}
          >
            <span className="dayPillLetter">{day.letter}</span>
            <span className="dayPillNumber">{day.date.getDate()}</span>
            <span className="dayPillMarks">
              {day.hasSession ? <i className="dayMark done" /> : null}
              {day.hasPlan && !day.hasSession ? <i className="dayMark planned" /> : null}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
