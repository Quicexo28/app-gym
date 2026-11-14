import { Outlet } from "react-router-dom";

import HubTabs from "../components/HubTabs";

export default function Historial() {
  return (
    <div className="container stack">
      <HubTabs
        ariaLabel="Secciones del historial"
        tabs={[
          { to: "/historial", label: "Sesiones", end: true },
          { to: "/historial/dieta", label: "Dieta" },
        ]}
      />
      <Outlet />
    </div>
  );
}
