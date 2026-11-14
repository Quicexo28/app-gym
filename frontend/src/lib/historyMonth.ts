import { addDays, dayKey, weekdayIndex } from "./dates";

export type MonthView = { year: number; month: number };

export function monthOf(date: Date): MonthView {
  return { year: date.getFullYear(), month: date.getMonth() };
}

export function shiftMonth(view: MonthView, delta: number): MonthView {
  return monthOf(new Date(view.year, view.month + delta, 1));
}

export function sameMonth(a: MonthView, b: MonthView): boolean {
  return a.year === b.year && a.month === b.month;
}

/** Primer y último día del mes, como claves "YYYY-MM-DD". */
export function monthRange(view: MonthView): { from: string; to: string } {
  return {
    from: dayKey(new Date(view.year, view.month, 1)),
    to: dayKey(new Date(view.year, view.month + 1, 0)),
  };
}

/** Semanas (lunes a domingo) que cubren el mes. Los días de otro mes salen como null. */
export function buildMonthWeeks(view: MonthView): Array<Array<string | null>> {
  const first = new Date(view.year, view.month, 1);
  const start = addDays(first, -weekdayIndex(first));
  const weeks: Array<Array<string | null>> = [];
  for (let w = 0; w < 6; w++) {
    const row: Array<string | null> = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, w * 7 + d);
      row.push(date.getMonth() === view.month ? dayKey(date) : null);
    }
    if (row.every((cell) => cell === null)) break;
    weeks.push(row);
  }
  return weeks;
}
