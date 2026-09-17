import { useEffect, useRef, useState } from "react";

import { useClampPopover } from "../lib/useClampPopover";

type TimePickerProps = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
};

function parseTime(value: string): { hour: number; minute: number } {
  const [h, m] = value.split(":").map((part) => Number(part));
  return {
    hour: Number.isFinite(h) ? Math.min(23, Math.max(0, h)) : 0,
    minute: Number.isFinite(m) ? Math.min(59, Math.max(0, m)) : 0,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

const HOURS = Array.from({ length: 24 }, (_, idx) => idx);
const MINUTES = Array.from({ length: 60 }, (_, idx) => idx);

export default function TimePicker({ value, onChange, label }: TimePickerProps) {
  const { hour, minute } = parseTime(value);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const hourListRef = useRef<HTMLDivElement | null>(null);
  const minuteListRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    if (!open) return;
    hourListRef.current?.querySelector(".timePickerOptionSelected")?.scrollIntoView({ block: "center" });
    minuteListRef.current?.querySelector(".timePickerOptionSelected")?.scrollIntoView({ block: "center" });
  }, [open]);

  function setHour(nextHour: number): void {
    onChange(`${pad(nextHour)}:${pad(minute)}`);
  }

  function setMinute(nextMinute: number): void {
    onChange(`${pad(hour)}:${pad(nextMinute)}`);
  }

  return (
    <div className="datePicker" ref={rootRef}>
      {label ? <span className="smallLabel">{label}</span> : null}
      <button type="button" className="input datePickerTrigger" onClick={() => setOpen((prev) => !prev)}>
        <span>{`${pad(hour)}:${pad(minute)}`}</span>
        <svg className="iconGlyph datePickerIcon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3.5 2" />
        </svg>
      </button>

      {open ? (
        <div
          ref={popoverRef}
          className="datePickerPopover timePickerPopover"
          style={shiftX !== 0 ? { transform: `translateX(${shiftX}px)` } : undefined}
          role="dialog"
          aria-label="Selector de hora"
        >
          <div className="timePickerColumns">
            <div className="timePickerColumn" ref={hourListRef}>
              {HOURS.map((h) => (
                <button
                  key={h}
                  type="button"
                  className={`timePickerOption ${h === hour ? "timePickerOptionSelected" : ""}`}
                  onClick={() => setHour(h)}
                >
                  {pad(h)}
                </button>
              ))}
            </div>
            <div className="timePickerColumn" ref={minuteListRef}>
              {MINUTES.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`timePickerOption ${m === minute ? "timePickerOptionSelected" : ""}`}
                  onClick={() => setMinute(m)}
                >
                  {pad(m)}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
