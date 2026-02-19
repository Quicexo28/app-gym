import { NavLink, Outlet } from "react-router-dom";

import { useAthleteAccess } from "../state/athlete";
import { useAuth } from "../state/auth";
import { usePreferences } from "../state/preferences";
import { useViewMode, viewModeLabel } from "../state/viewMode";

type NavItemDef = {
  to: string;
  label: string;
};

function buildNavItems(mode: "admin" | "coach" | "user_plus" | "user_normal"): NavItemDef[] {
  if (mode === "admin") {
    return [
      { to: "/home", label: "Dashboard" },
      { to: "/users", label: "Usuarios" },
      { to: "/session/new", label: "Nueva sesion" },
      { to: "/exercises", label: "Ejercicios" },
      { to: "/planning", label: "Planificacion" },
      { to: "/settings", label: "Ajustes" },
    ];
  }

  if (mode === "coach") {
    return [
      { to: "/home", label: "Dashboard" },
      { to: "/users", label: "Usuarios" },
      { to: "/session/new", label: "Nueva sesion" },
      { to: "/exercises", label: "Ejercicios" },
      { to: "/planning", label: "Planificacion" },
      { to: "/history", label: "Historial" },
      { to: "/routines", label: "Rutinas" },
      { to: "/profile", label: "Perfil" },
      { to: "/settings", label: "Ajustes" },
    ];
  }

  return [
    { to: "/home", label: "Dashboard" },
    { to: "/session/new", label: "Nueva sesion" },
    { to: "/history", label: "Historial" },
    { to: "/exercises", label: "Ejercicios" },
    { to: "/planning", label: "Planificacion" },
    { to: "/routines", label: "Rutinas" },
    { to: "/profile", label: "Perfil" },
    { to: "/settings", label: "Ajustes" },
  ];
}

function Item({ to, label }: { to: string; label: string }) {
  return (
    <NavLink to={to} className={({ isActive }) => `navItem ${isActive ? "active" : ""}`} end={to === "/home"}>
      <span className="navLabel">{label}</span>
    </NavLink>
  );
}

export default function AppShell() {
  const { subjects, athleteId, canSwitch, ready: athleteReady, setAthleteId } = useAthleteAccess();
  const { prefs, resolvedTheme, toggleTheme } = usePreferences();
  const { logout } = useAuth();
  const { viewMode, allowedModes, canSwitchMode, setViewMode } = useViewMode();

  const navItems = buildNavItems(viewMode);
  const themeLabel =
    prefs.theme === "system" ? `Sistema (${resolvedTheme})` : prefs.theme === "dark" ? "Oscuro" : "Claro";
  const selectedSubjectLabel = subjects.find((subject) => subject.id === athleteId)?.label || "Sin sujeto";
  const canSwitchSubject = canSwitch && (viewMode === "coach" || viewMode === "admin");

  return (
    <div className="shell2">
      <header className="topbar2">
        <div className="topbarRow">
          <div className="brand2">
            <div className="brandTitle">Coach AI Engineer</div>
            <div className="brandSub">seguimiento rapido para decisiones de entrenamiento</div>
          </div>

          <div className="hstack compact topbarActions">
            {canSwitchMode ? (
              <div className="toolbarGroup">
                <label className="smallLabel" htmlFor="view-mode-input">
                  Vista
                </label>
                <select
                  id="view-mode-input"
                  className="input athleteInput"
                  value={viewMode}
                  onChange={(e) => setViewMode(e.target.value as typeof viewMode)}
                >
                  {allowedModes.map((mode) => (
                    <option key={mode} value={mode}>
                      {viewModeLabel(mode)}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {canSwitchSubject ? (
              <div className="toolbarGroup">
                <label className="smallLabel" htmlFor="athlete-id-input">
                  Sujeto
                </label>
                <select
                  id="athlete-id-input"
                  className="input athleteInput"
                  value={athleteId}
                  onChange={(e) => setAthleteId(e.target.value)}
                  disabled={!athleteReady || subjects.length === 0}
                >
                  {subjects.length === 0 ? (
                    <option value="">Sin sujetos</option>
                  ) : (
                    subjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.label}
                      </option>
                    ))
                  )}
                </select>
              </div>
            ) : (
              <span className="chip">{selectedSubjectLabel}</span>
            )}

            <button type="button" className="btn" onClick={toggleTheme}>
              Tema: {themeLabel}
            </button>
            <button type="button" className="btn" onClick={logout}>
              Salir
            </button>
          </div>
        </div>

        <nav className="topnav2" aria-label="Navegacion principal">
          {navItems.map((item) => (
            <Item key={item.to} to={item.to} label={item.label} />
          ))}
        </nav>
      </header>

      <main className="content2">
        <Outlet />
      </main>
    </div>
  );
}
