import { Outlet } from "react-router-dom";

import HubTabs, { type HubTabDef } from "../components/HubTabs";
import "../styles.perfil.css";

const TABS: HubTabDef[] = [
  { to: "/profile/progress", label: "Medidas", end: true },
  { to: "/profile/progress/cargas", label: "Cargas" },
  { to: "/profile/progress/photos", label: "Fotos" },
];

export default function Progress() {
  return (
    <>
      <div className="hubSub">
        <HubTabs ariaLabel="Secciones de progreso" tabs={TABS} />
      </div>
      <Outlet />
    </>
  );
}
