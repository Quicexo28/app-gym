import { Outlet } from "react-router-dom";

import HubTabs from "../components/HubTabs";

export default function CargasHub() {
  return (
    <>
      <HubTabs
        ariaLabel="Secciones de cargas"
        tabs={[
          { to: "/profile/progress/cargas", label: "Rutinas", end: true },
          { to: "/profile/progress/cargas/ejercicios", label: "Ejercicios" },
        ]}
      />
      <Outlet />
    </>
  );
}
