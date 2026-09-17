import { useEffect, useMemo, useRef, useState } from "react";

import { MONTHS_LONG, WEEKDAY_LETTERS, addDays, dayKey, formatDayLong, parseDayKey, weekdayIndex } from "../lib/dates";
import { useClampPopover } from "../lib/useClampPopover";

type DatePickerProps = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  max?: string;
};

function buildMonthGrid(viewYear: number, viewMonth: number): Date[] {
  const first = new Date(viewYear, viewMonth, 1);
  const gridStart = addDays(first, -weekdayIndex(first));
  return Array.from({ length: 42 }, (_, idx) => addDays(gridStart, idx));
}

export default function DatePicker({ value, onChange, label, max }: DatePickerProps) {
  const selected = value ? parseDayKey(value) : null;
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => (selected || new Date()).getFullYear());
  const [viewMonth, setViewMonth] = useState(() => (selected || new Date()).getMonth());
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const shiftX = useClampPopover(open, popoverRef);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const grid = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewMonth, viewYear]);
  const todayKey = dayKey(new Date());
  const maxKey = max || "";

  function openPicker() {
    const base = selected || new Date();
    setViewYear(base.getFullYear());
    setViewMonth(base.getMonth());
    setOpen(true);
  }

  function shiftMonth(delta: number) {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  }

  function selectDay(day: Date) {
    const key = dayKey(day);
    if (maxKey && key > maxKey) return;
    onChange(key);
    setOpen(false);
  }

  const nextMonthDisabled = Boolean(maxKey) && dayKey(new Date(viewYear, viewMonth + 1, 1)) > maxKey;

  return (
    <div className="datePicker" ref={rootRef}>
      {label ? <span className="smallLabel">{label}</span> : null}
      <button type="button" className="input datePickerTrigger" onClick={() => (open ? setOpen(false) : openPicker())}>
        <span>{selected ? formatDayLong(selected) : "Seleccionar fecha"}</span>
        <svg className="iconGlyph datePickerIcon" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="3" />
          <path d="M3 9h18M8 3v4M16 3v4" />
        </svg>
      </button>

      {open ? (
        <div
          ref={popoverRef}
          className="datePickerPopover"
          style={shiftX !== 0 ? { transform: `translateX(${shiftX}px)` } : undefined}
          role="dialog"
          aria-label="Selector de fecha"
        >
          <div className="datePickerHeader">
            <button type="button" className="datePickerNavBtn" onClick={() => shiftMonth(-1)} aria-label="Mes anterior">
              ‹
            </button>
            <strong>{`${MONTHS_LONG[viewMonth]} ${viewYear}`}</strong>
            <button
              type="button"
              className="datePickerNavBtn"
              onClick={() => shiftMonth(1)}
              disabled={nextMonthDisabled}
              aria-label="Mes siguiente"
            >
              ›
            </button>
          </div>

          <div className="datePickerWeekdays">
            {WEEKDAY_LETTERS.map((letter, idx) => (
              <span key={`${letter}_${idx}`}>{letter}</span>
            ))}
          </div>

          <div className="datePickerGrid">
            {grid.map((day) => {
              const key = dayKey(day);
              const disabled = Boolean(maxKey) && key > maxKey;
              const className = [
                "datePickerDay",
                day.getMonth() === viewMonth ? "" : "outMonth",
                key === value ? "selected" : "",
                key === todayKey ? "today" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <button key={key} type="button" className={className} disabled={disabled} onClick={() => selectDay(day)}>
                  {day.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
