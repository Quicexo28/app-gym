import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAthleteId } from "../state/athlete";

function TabLink({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `tablink ${isActive ? "active" : ""}`}
      end={to === "/home"}
    >
      {label}
    </NavLink>
  );
}

export default function AppShell() {
  const [athleteId, setAthleteId] = useAthleteId();
  const nav = useNavigate();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand" onClick={() => nav("/home")} role="button" tabIndex={0}>
          Coach AI Engineer
          <span className="brandSub">scenarios, no órdenes</span>
        </div>

        <div className="athleteBox">
          <label className="small" style={{ fontWeight: 700 }}>
            Athlete
          </label>
          <input
            className="input"
            value={athleteId}
            onChange={(e) => setAthleteId(e.target.value)}
            placeholder="a1"
            style={{ width: 160 }}
          />
        </div>
      </header>

      <nav className="tabs">
        <TabLink to="/home" label="Home" />
        <TabLink to="/session/new" label="Nueva sesión" />
        <TabLink to="/history" label="Historial" />
        <TabLink to="/exercises" label="Ejercicios" />
        <TabLink to="/routines" label="Rutinas" />
        <TabLink to="/ingest" label="Import (avanzado)" />
      </nav>

      <main className="content">
        <Outlet />
      </main>

      <footer className="tabbar">
        <TabLink to="/home" label="Home" />
        <TabLink to="/session/new" label="Nueva" />
        <TabLink to="/history" label="Historial" />
        <TabLink to="/exercises" label="Ejercicios" />
        <TabLink to="/routines" label="Rutinas" />
      </footer>
    </div>
  );
}
