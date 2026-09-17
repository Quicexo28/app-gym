import { Outlet } from "react-router-dom";

import HubTabs from "../components/HubTabs";

export default function Training() {
  return (
    <div className="container stack">
      <HubTabs
        ariaLabel="Secciones de rutina"
        tabs={[
          { to: "/training", label: "Rutinas", end: true },
          { to: "/training/plan", label: "Programación" },
          { to: "/training/exercises", label: "Ejercicios" },
        ]}
      />
      <Outlet />
    </div>
  );
}
