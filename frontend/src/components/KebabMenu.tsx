import { useEffect, useRef, useState } from "react";

import { useClampPopover } from "../lib/useClampPopover";

export type KebabAction = {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
};

type KebabMenuProps = {
  actions: KebabAction[];
  ariaLabel?: string;
};

/** Menu de "..." (3 puntos) con acciones simples, mismo patron de click-outside/Escape que `Select.tsx`. */
export default function KebabMenu({ actions, ariaLabel = "Más opciones" }: KebabMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const shiftX = useClampPopover(open, panelRef);

  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="kebabMenu">
      <button
        type="button"
        className="kebabTrigger"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        ⋯
      </button>
      {open ? (
        <div ref={panelRef} className="kebabPanel" role="menu" style={{ transform: `translateX(${shiftX}px)` }}>
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              className={`kebabItem ${action.destructive ? "destructive" : ""}`.trim()}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
