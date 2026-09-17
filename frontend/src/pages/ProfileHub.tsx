import { Outlet } from "react-router-dom";

import HubTabs, { type HubTabDef } from "../components/HubTabs";
import { useAuth } from "../state/auth";
import { useViewScopes } from "../state/viewScopes";

export default function ProfileHub() {
  const { isAdmin } = useAuth();
  const { adminView } = useViewScopes();

  const tabs: HubTabDef[] = [
    { to: "/profile", label: "Cuenta", end: true },
    { to: "/profile/progress", label: "Progreso" },
    { to: "/profile/preferences", label: "Ajustes" },
  ];
  if (isAdmin && adminView) {
    tabs.push({ to: "/profile/admin", label: "Admin" });
  }

  return (
    <div className="container stack">
      <HubTabs ariaLabel="Secciones de perfil" tabs={tabs} />
      <Outlet />
    </div>
  );
}
