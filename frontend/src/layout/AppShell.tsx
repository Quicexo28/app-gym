import { NavLink, Outlet } from "react-router-dom";

import { useAthleteAccess } from "../state/athlete";
import { useAuth } from "../state/auth";
import { usePreferences } from "../state/preferences";

type NavItemDef = {
  to: string;
  label: string;
};

const NAV_ITEMS: NavItemDef[] = [
  { to: "/home", label: "Home" },
  { to: "/profile", label: "Perfil" },
  { to: "/session/new", label: "Nueva sesion" },
  { to: "/history", label: "Historial" },
  { to: "/exercises", label: "Ejercicios" },
  { to: "/routines", label: "Rutinas" },
  { to: "/settings", label: "Ajustes" },
];

function Item({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `navItem ${isActive ? "active" : ""}`}
      end={to === "/home"}
    >
      <span className="navLabel">{label}</span>
    </NavLink>
  );
}

export default function AppShell() {
  const { athleteId, athleteIds, canSwitch, ready: athleteReady, setAthleteId } = useAthleteAccess();
  const { prefs, resolvedTheme, toggleTheme } = usePreferences();
  const { logout } = useAuth();

  const themeLabel = prefs.theme === "system" ? `Sistema (${resolvedTheme})` : prefs.theme === "dark" ? "Oscuro" : "Claro";

  return (
    <div className="shell2">
      <header className="topbar2">
        <div className="topbarRow">
          <div className="brand2">
            <div className="brandTitle">Coach AI Engineer</div>
            <div className="brandSub">seguimiento rapido para decisiones de entrenamiento</div>
          </div>

          <div className="hstack compact topbarActions">
            {canSwitch ? (
              <div className="toolbarGroup">
                <label className="smallLabel" htmlFor="athlete-id-input">
                  Atleta
                </label>
                <select
                  id="athlete-id-input"
                  className="input athleteInput"
                  value={athleteId}
                  onChange={(e) => setAthleteId(e.target.value)}
                  disabled={!athleteReady || athleteIds.length === 0}
                >
                  {athleteIds.length === 0 ? (
                    <option value="">Sin atletas asignados</option>
                  ) : (
                    athleteIds.map((id, idx) => (
                      <option key={id} value={id}>
                        {`Atleta ${idx + 1}`}
                      </option>
                    ))
                  )}
                </select>
              </div>
            ) : null}
            <button type="button" className="btn" onClick={toggleTheme}>
              Tema: {themeLabel}
            </button>
            <button type="button" className="btn" onClick={logout}>
              Salir
            </button>
          </div>
        </div>

        <nav className="topnav2" aria-label="Navegacion principal">
          {NAV_ITEMS.map((item) => (
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
