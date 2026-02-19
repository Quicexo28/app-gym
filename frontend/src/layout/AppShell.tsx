import { NavLink, Outlet } from "react-router-dom";

import { useAuth } from "../state/auth";
import { usePreferences } from "../state/preferences";
import { useAthleteId } from "../state/athlete";

type NavItemDef = {
  to: string;
  label: string;
};

const NAV_ITEMS: NavItemDef[] = [
  { to: "/home", label: "Home" },
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
  const [athleteId, setAthleteId] = useAthleteId();
  const { prefs, resolvedTheme, toggleTheme } = usePreferences();
  const { user, planLabel, logout } = useAuth();

  const themeLabel =
    prefs.theme === "system" ? `Tema sistema (${resolvedTheme})` : prefs.theme === "dark" ? "Tema oscuro" : "Tema claro";

  return (
    <div className="shell2">
      <header className="topbar2">
        <div className="topbarRow">
          <div className="brand2">
            <div className="brandTitle">Coach AI Engineer</div>
            <div className="brandSub">seguimiento rapido para decisiones de entrenamiento</div>
          </div>

          <div className="hstack compact topbarActions">
            <label className="smallLabel" htmlFor="athlete-id-input">
              Athlete
            </label>
            <input
              id="athlete-id-input"
              className="input athleteInput"
              value={athleteId}
              onChange={(e) => setAthleteId(e.target.value)}
              placeholder="a1"
            />
            <button type="button" className="btn" onClick={toggleTheme}>
              {themeLabel}
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

        <div className="small topbarMeta">
          {`Cuenta: ${user?.email || "-"} | Plan: ${planLabel || "-"} | Rol: ${user?.role || "-"} | Escala: ${prefs.effortScale.toUpperCase()} | Carga: ${prefs.weightUnit}`}
        </div>
      </header>

      <main className="content2">
        <Outlet />
      </main>
    </div>
  );
}
