import { NavLink } from "react-router-dom";

export type HubTabDef = {
  to: string;
  label: string;
  end?: boolean;
};

export default function HubTabs({ tabs, ariaLabel }: { tabs: HubTabDef[]; ariaLabel: string }) {
  return (
    <nav className="hubTabs" aria-label={ariaLabel}>
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) => `hubTab ${isActive ? "active" : ""}`}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
