import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import AppShell from "./layout/AppShell";
import Athlete from "./pages/Athlete";
import Exercises from "./pages/Exercises";
import History from "./pages/History";
import Home from "./pages/Home";
import Ingest from "./pages/Ingest";
import Login from "./pages/Login";
import NewSession from "./pages/NewSession";
import Routines from "./pages/Routines";
import RunDetail from "./pages/RunDetail";
import Settings from "./pages/Settings";
import { useAuth } from "./state/auth";

function RequireAuth({ children }: { children: ReactNode }) {
  const { ready, isAuthenticated } = useAuth();
  if (!ready) {
    return (
      <div className="loginWrap">
        <section className="surface loginCard">
          <div className="emptyState">Cargando sesión...</div>
        </section>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/home" replace />} />
        <Route path="home" element={<Home />} />
        <Route path="session/new" element={<NewSession />} />
        <Route path="history" element={<History />} />
        <Route path="exercises" element={<Exercises />} />
        <Route path="routines" element={<Routines />} />
        <Route path="ingest" element={<Ingest />} />
        <Route path="settings" element={<Settings />} />
        <Route path="athlete/:athleteId" element={<Athlete />} />
        <Route path="run/:runId" element={<RunDetail />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
