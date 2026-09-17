import { Outlet } from "react-router-dom";

import HubTabs from "../components/HubTabs";

export default function Diet() {
  return (
    <div className="container stack">
      <HubTabs
        ariaLabel="Secciones de dieta"
        tabs={[
          { to: "/diet", label: "Diario", end: true },
          { to: "/diet/alimentos", label: "Alimentos" },
        ]}
      />

      <Outlet />
    </div>
  );
}
