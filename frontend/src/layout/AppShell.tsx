import { NavLink, Outlet } from "react-router-dom";
import { useAthleteId } from "../state/athlete";

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

  return (
    <div className="shell2">
      <header className="topbar2">
        <div className="brand2">
          <div className="brandTitle">Coach AI Engineer</div>
          <div className="brandSub">escenarios con incertidumbre explícita</div>
        </div>

        <div className="athleteBox2">
          <div className="small" style={{ fontWeight: 700 }}>
            Athlete
          </div>
          <input
            className="input"
            value={athleteId}
            onChange={(e) => setAthleteId(e.target.value)}
            placeholder="a1"
            style={{ width: 160 }}
          />
        </div>
      </header>

      <div className="body2">
        <aside className="sidebar">
          <div className="sidebarTitle">Navegación</div>
          <nav className="sidebarNav">
            <Item to="/home" label="Home" />
            <Item to="/session/new" label="Nueva sesión" />
            <Item to="/history" label="Historial" />
            <Item to="/exercises" label="Ejercicios" />
            <Item to="/routines" label="Rutinas" />
            <Item to="/ingest" label="Import (avanzado)" />
          </nav>

          <div className="sidebarHint small">
            “Rutinas” = plantillas para registro (no prescripción).
          </div>
        </aside>

        <main className="content2">
          <Outlet />
        </main>
      </div>

      <footer className="tabbar2">
        <Item to="/home" label="Home" />
        <Item to="/session/new" label="Nueva" />
        <Item to="/history" label="Historial" />
        <Item to="/exercises" label="Ejercicios" />
        <Item to="/routines" label="Rutinas" />
      </footer>
    </div>
  );
}
