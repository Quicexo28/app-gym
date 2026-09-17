import { useEffect } from "react";
import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";

export type MenuLink = {
  to: string;
  label: string;
  end?: boolean;
};

export type MenuGroup = {
  title: string;
  links: MenuLink[];
};

export default function SideMenu({
  open,
  groups,
  onClose,
  footer,
}: {
  open: boolean;
  groups: MenuGroup[];
  onClose: () => void;
  footer?: ReactNode;
}) {
  const location = useLocation();

  useEffect(() => {
    onClose();
  }, [location.pathname, onClose]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="drawerBackdrop" onClick={onClose} />

      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Menu de navegacion">
        <div className="drawerHead">
          <span className="brandTitle">Alzo</span>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Cerrar menu">
            Cerrar
          </button>
        </div>

        <nav className="drawerNav">
          {groups.map((group) => (
            <div key={group.title} className="drawerGroup">
              <div className="smallLabel">{group.title}</div>
              {group.links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.end}
                  onClick={onClose}
                  className={({ isActive }) => `drawerLink ${isActive ? "active" : ""}`}
                >
                  {link.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {footer ? <div className="drawerFooter">{footer}</div> : null}
      </aside>
    </>
  );
}
