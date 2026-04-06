import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import ActiveSessionBar from "../components/ActiveSessionBar";
import UndoBar from "../components/UndoBar";
import { getSessions } from "../api";
import type { SessionRecord } from "../api";
import { DEFAULT_PROFILE_AVATAR_URL, loadProfileAvatarUrl, PROFILE_AVATAR_CHANGED_EVENT } from "../lib/profileAvatar";
import { useAthleteAccess } from "../state/athlete";
import { useAuth } from "../state/auth";
import { usePreferences } from "../state/preferences";
import { useViewMode, viewModeLabel } from "../state/viewMode";

type NavItemDef = {
  to: string;
  label: string;
};

type NavSections = {
  primary: NavItemDef[];
  more: NavItemDef[];
};

function buildNavSections(mode: "admin" | "coach" | "user_plus" | "user_normal"): NavSections {
  const sharedPrimary: NavItemDef[] = [
    { to: "/home", label: "Inicio" },
    { to: "/session/new", label: "Nueva sesión" },
    { to: "/history", label: "Historial" },
    { to: "/planning", label: "Planificación" },
    { to: "/routines", label: "Rutinas" },
  ];

  const sharedMore: NavItemDef[] = [
    { to: "/measurements", label: "Medidas" },
    { to: "/exercises", label: "Ejercicios" },
    { to: "/achievements", label: "Logros" },
  ];

  if (mode === "admin") {
    return {
      primary: [...sharedPrimary, { to: "/users", label: "Usuarios" }],
      more: sharedMore,
    };
  }

  if (mode === "coach") {
    return {
      primary: [...sharedPrimary, { to: "/users", label: "Usuarios" }],
      more: sharedMore,
    };
  }

  return {
    primary: sharedPrimary,
    more: sharedMore,
  };
}

function pathMatches(pathname: string, to: string): boolean {
  if (to === "/home") {
    return pathname === "/" || pathname === "/home";
  }
  return pathname === to || pathname.startsWith(`${to}/`);
}

function Item({ to, label }: { to: string; label: string }) {
  return (
    <NavLink to={to} className={({ isActive }) => `navItem ${isActive ? "active" : ""}`} end={to === "/home"}>
      <span className="navLabel">{label}</span>
    </NavLink>
  );
}

function MoreMenu({ items, pathname }: { items: NavItemDef[]; pathname: string }) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const isAnyItemActive = items.some((item) => pathMatches(pathname, item.to));

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", closeOnOutsideClick);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsideClick);
    };
  }, [open]);

  return (
    <div className="moreMenu" ref={popoverRef}>
      <button
        type="button"
        className={`navItem moreTrigger ${open || isAnyItemActive ? "active" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Más secciones"
        onClick={() => setOpen((value) => !value)}
      >
        Más
      </button>

      {open ? (
        <div className="morePopover" role="menu" aria-label="Más secciones">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `moreItem ${isActive ? "active" : ""}`}
              role="menuitem"
              end={item.to === "/home"}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function AppShell() {
  const location = useLocation();
  const { subjects, athleteId, canSwitch, ready: athleteReady, setAthleteId } = useAthleteAccess();
  const { prefs, resolvedTheme, toggleTheme } = usePreferences();
  const { user, logout } = useAuth();
  const { viewMode, allowedModes, canSwitchMode, setViewMode } = useViewMode();
  const [sessionsData, setSessionsData] = useState<SessionRecord[]>([]);
  const [todayMs] = useState<number>(() => Date.now());
  const [, setAvatarRefreshCounter] = useState(0);
  const nav = useNavigate();

  const navSections = buildNavSections(viewMode);
  const avatarUrl = loadProfileAvatarUrl(user?.id) || DEFAULT_PROFILE_AVATAR_URL;
  const themeLabel =
    prefs.theme === "system" ? `Sistema (${resolvedTheme})` : prefs.theme === "dark" ? "Oscuro" : "Claro";
  const selectedSubjectLabel = subjects.find((subject) => subject.id === athleteId)?.label || "Sin sujeto";
  const canSwitchSubject = canSwitch && (viewMode === "coach" || viewMode === "admin");

  useEffect(() => {
    if (!athleteId) {
      return;
    }

    let cancelled = false;
    getSessions(athleteId)
      .then((sessions) => {
        if (cancelled) return;
        const ordered = [...sessions].sort((a, b) => String(b.start_time).localeCompare(String(a.start_time)));
        setSessionsData(ordered);
      })
      .catch(() => {
        if (cancelled) return;
        setSessionsData([]);
      });

    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  const streakDays = useMemo(() => {
    if (!athleteId || sessionsData.length === 0) return 0;
    const dayKeys = Array.from(
      new Set(
        sessionsData
          .map((session) => String(session.start_time || "").slice(0, 10))
          .filter((value) => value.length === 10),
      ),
    ).sort((a, b) => b.localeCompare(a));

    if (dayKeys.length === 0) return 0;

    const todayKey = new Date(todayMs).toISOString().slice(0, 10);
    const yesterdayKey = new Date(todayMs - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (dayKeys[0] !== todayKey && dayKeys[0] !== yesterdayKey) return 0;

    let streak = 1;
    for (let i = 1; i < dayKeys.length; i += 1) {
      const prev = new Date(`${dayKeys[i - 1]}T00:00:00Z`).getTime();
      const current = new Date(`${dayKeys[i]}T00:00:00Z`).getTime();
      if (prev - current === 24 * 60 * 60 * 1000) streak += 1;
      else break;
    }
    return streak;
  }, [athleteId, sessionsData, todayMs]);

  const hasSessionToday = useMemo(() => {
    if (sessionsData.length === 0) return false;
    const todayKey = new Date(todayMs).toISOString().slice(0, 10);
    return sessionsData.some((session) => String(session.start_time || "").slice(0, 10) === todayKey);
  }, [sessionsData, todayMs]);

  const streakVisualState = useMemo<"ashes" | "inactive" | "active">(() => {
    if (streakDays <= 0) return "ashes";
    return hasSessionToday ? "active" : "inactive";
  }, [hasSessionToday, streakDays]);

  const onStreakClick = () => {
    if (streakVisualState === "active") {
      nav("/history");
      return;
    }
    nav("/session/new");
  };

  useEffect(() => {
    const onAvatarChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string; avatarUrl?: string | null }>).detail;
      const changedUserId = (detail?.userId || "").trim();
      if (!user?.id || changedUserId !== user.id) return;
      setAvatarRefreshCounter((value) => value + 1);
    };

    window.addEventListener(PROFILE_AVATAR_CHANGED_EVENT, onAvatarChanged);
    return () => {
      window.removeEventListener(PROFILE_AVATAR_CHANGED_EVENT, onAvatarChanged);
    };
  }, [user?.id]);

  return (
    <div className="shell2">
      <header className="topbar2">
        <div className="topbarCornerActions" aria-label="Accesos de cuenta">
          <NavLink to="/settings" className={({ isActive }) => `cornerIconBtn ${isActive ? "active" : ""}`} aria-label="Ajustes">
            <svg className="cornerIconGlyph" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3.25l2.05.45.8 1.82 1.95.72 1.63-1.07 1.45 1.45-1.07 1.63.72 1.95 1.82.8.45 2.05-.45 2.05-1.82.8-.72 1.95 1.07 1.63-1.45 1.45-1.63-1.07-1.95.72-.8 1.82-2.05.45-2.05-.45-.8-1.82-1.95-.72-1.63 1.07-1.45-1.45 1.07-1.63-.72-1.95-1.82-.8-.45-2.05.45-2.05 1.82-.8.72-1.95-1.07-1.63 1.45-1.45 1.63 1.07 1.95-.72.8-1.82z" />
              <circle cx="12" cy="12" r="3.1" />
            </svg>
          </NavLink>

          <NavLink to="/profile" className={({ isActive }) => `profileAvatarBtn ${isActive ? "active" : ""}`} aria-label="Perfil">
            <img src={avatarUrl} alt="Foto de perfil" className="profileAvatarImg" loading="lazy" />
          </NavLink>
        </div>

        <div className="topbarRow">
          <div className="brand2">
            <div className="brandTitle">Coach AI Engineer</div>
            <div className="brandSub">Seguimiento simple para decisiones de entrenamiento</div>
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

            <button
              type="button"
              className={`streakIconButton ${streakVisualState}`}
              onClick={onStreakClick}
              title={
                streakVisualState === "active"
                  ? "Racha activa hoy. Toca para ver historial."
                  : streakVisualState === "inactive"
                    ? "Tienes racha, pero hoy aún no entrenas. Toca para iniciar sesión."
                    : "Sin racha activa. Toca para crear tu primera sesión."
              }
              aria-label={`Racha: ${streakDays} día${streakDays === 1 ? "" : "s"}`}
            >
              <span className="streakIconCore" aria-hidden="true">
                <span className="streakFlameOuter" />
                <span className="streakFlameInner" />
                <span className="streakAshPile" />
              </span>
              <span className="streakIconLabel">{`${streakDays} día${streakDays === 1 ? "" : "s"}`}</span>
            </button>

            <button type="button" className="btn" onClick={toggleTheme}>
              Tema: {themeLabel}
            </button>
            <button type="button" className="btn" onClick={logout}>
              Salir
            </button>
          </div>
        </div>

        <nav className="topnav2" aria-label="Navegacion principal">
          {navSections.primary.map((item) => (
            <Item key={item.to} to={item.to} label={item.label} />
          ))}
          {navSections.more.length > 0 ? (
            <MoreMenu key={`more_${location.pathname}`} items={navSections.more} pathname={location.pathname} />
          ) : null}
        </nav>
      </header>

      <main className="content2">
        <Outlet />
      </main>
      <ActiveSessionBar />
      <UndoBar />
    </div>
  );
}
