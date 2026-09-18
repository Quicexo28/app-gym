import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";

import ActiveSessionBar from "../components/ActiveSessionBar";
import Select from "../components/Select";
import SideMenu, { type MenuGroup } from "../components/SideMenu";
import Switch from "../components/Switch";
import UndoBar from "../components/UndoBar";
import {
  MEAL_OUTBOX_CHANGED_EVENT,
  flushMealOutbox,
  installMealOutboxAutoFlush,
  mealOutboxCount,
} from "../lib/nutrition/mealOutbox";
import {
  OUTBOX_CHANGED_EVENT,
  flushSessionOutbox,
  installSessionOutboxAutoFlush,
  outboxCount,
} from "../lib/sessionOutbox";
import { hydrateRoutinesFromBackend } from "../lib/storage";
import { useAthleteAccess } from "../state/athlete";
import { useAuth } from "../state/auth";
import { useViewScopes } from "../state/viewScopes";

type NavItemDef = {
  to: string;
  label: string;
};

const NAV_ITEMS: NavItemDef[] = [
  { to: "/home", label: "Home" },
  { to: "/diet", label: "Dieta" },
  { to: "/training", label: "Rutina" },
  { to: "/predictions", label: "Predicción" },
  { to: "/profile", label: "Perfil" },
];

export default function AppShell() {
  const { subjects, athleteId, canSwitch, ready: athleteReady, setAthleteId } = useAthleteAccess();
  const { isAdmin, logout } = useAuth();
  const { adminView, coachView, canAdminView, canCoachView, setAdminView, setCoachView } = useViewScopes();

  const [pendingUploads, setPendingUploads] = useState(() => outboxCount() + mealOutboxCount());
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    void hydrateRoutinesFromBackend();
    installSessionOutboxAutoFlush();
    void flushSessionOutbox();
    installMealOutboxAutoFlush();
    void flushMealOutbox();

    const update = () => setPendingUploads(outboxCount() + mealOutboxCount());
    window.addEventListener(OUTBOX_CHANGED_EVENT, update);
    window.addEventListener(MEAL_OUTBOX_CHANGED_EVENT, update);
    return () => {
      window.removeEventListener(OUTBOX_CHANGED_EVENT, update);
      window.removeEventListener(MEAL_OUTBOX_CHANGED_EVENT, update);
    };
  }, []);

  const canSwitchSubject = canSwitch && coachView;

  const menuGroups = useMemo<MenuGroup[]>(() => {
    const profileLinks = [
      { to: "/profile", label: "Cuenta", end: true },
      { to: "/profile/progress", label: "Progreso", end: true },
      { to: "/profile/progress/cargas", label: "Cargas" },
      { to: "/profile/progress/photos", label: "Fotos" },
      { to: "/profile/preferences", label: "Ajustes" },
    ];
    if (isAdmin && adminView) {
      profileLinks.push({ to: "/profile/admin", label: "Admin" });
    }

    const groups: MenuGroup[] = [
      {
        title: "Principal",
        links: [
          { to: "/home", label: "Home", end: true },
          { to: "/session/new", label: "Nueva sesión" },
          { to: "/diet", label: "Dieta" },
        ],
      },
      {
        title: "Rutina",
        links: [
          { to: "/training", label: "Rutinas", end: true },
          { to: "/training/plan", label: "Programación" },
          { to: "/training/exercises", label: "Ejercicios" },
        ],
      },
      {
        title: "Predicción",
        links: [{ to: "/predictions", label: "Escenarios", end: true }],
      },
      { title: "Perfil", links: profileLinks },
    ];

    if (coachView) {
      groups.push({
        title: "Coach",
        links: [
          { to: "/users", label: "Usuarios" },
          { to: "/coach/invite", label: "Invitaciones y cupo" },
        ],
      });
    }

    return groups;
  }, [adminView, coachView, isAdmin]);

  return (
    <div className="shell2">
      <header className="topbar2">
        <div className="topbarRow">
          <div className="hstack compact">
            <button
              type="button"
              className="menuBtn"
              aria-label="Abrir menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <span className="menuBtnBars" aria-hidden="true" />
            </button>
            <div className="brandTitle">Alzo</div>
          </div>

          <div className="hstack compact topbarActions">
            {canAdminView ? (
              <Switch compact label="Admin" checked={adminView} onChange={setAdminView} />
            ) : null}
            {canCoachView ? (
              <Switch compact label="Coach" checked={coachView} onChange={setCoachView} />
            ) : null}

            {pendingUploads > 0 ? (
              <span
                className="chip"
                title="Sesiones y comidas guardadas sin conexión; se subirán automáticamente al reconectar."
              >
                {pendingUploads} por subir
              </span>
            ) : null}

            {canSwitchSubject ? (
              <Select
                ariaLabel="Sujeto"
                className="athleteInput"
                value={athleteId}
                onChange={setAthleteId}
                disabled={!athleteReady || subjects.length === 0}
                options={
                  subjects.length === 0
                    ? [{ value: "", label: "Sin sujetos" }]
                    : subjects.map((subject) => ({ value: subject.id, label: subject.label }))
                }
              />
            ) : null}
          </div>
        </div>
      </header>

      <SideMenu
        open={menuOpen}
        groups={menuGroups}
        onClose={closeMenu}
        footer={
          <button type="button" className="btn ghost btnBlock" onClick={logout}>
            Salir
          </button>
        }
      />

      <main className="content2">
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Navegacion principal">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `tabItem ${isActive ? "active" : ""}`}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <ActiveSessionBar />
      <UndoBar />
    </div>
  );
}
