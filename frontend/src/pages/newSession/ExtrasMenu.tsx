import { useEffect, useState } from "react";

type Props = {
  onChangeRoutine: () => void;
  onCloseRoutine: () => void;
};

export default function ExtrasMenu({ onChangeRoutine, onCloseRoutine }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="extrasMenu">
      <button
        type="button"
        className="menuBtn"
        aria-label="Funciones extra"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="menuBtnBars" aria-hidden="true" />
      </button>

      {open ? (
        <>
          <div className="extrasMenuBackdrop" onClick={() => setOpen(false)} />
          <div className="extrasMenuPanel" role="menu" aria-label="Funciones extra">
            <button
              className="extrasMenuItem"
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onChangeRoutine();
              }}
            >
              Cambiar rutina
            </button>
            <button
              className="extrasMenuItem danger"
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onCloseRoutine();
              }}
            >
              Cerrar rutina
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
