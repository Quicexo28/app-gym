import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./layout/AppShell";
import Exercises from "./pages/Exercises";
import History from "./pages/History";
import Home from "./pages/Home";
import Ingest from "./pages/Ingest";
import NewSession from "./pages/NewSession";
import RunDetail from "./pages/RunDetail";
import Routines from "./pages/Routines";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AppShell />}>
        <Route index element={<Navigate to="/home" replace />} />

        <Route path="home" element={<Home />} />
        <Route path="session/new" element={<NewSession />} />
        <Route path="history" element={<History />} />
        <Route path="exercises" element={<Exercises />} />
        <Route path="routines" element={<Routines />} />

        {/* herramientas */}
        <Route path="ingest" element={<Ingest />} />
        <Route path="run/:runId" element={<RunDetail />} />

        <Route path="*" element={<Navigate to="/home" replace />} />
      </Route>
    </Routes>
  );
}
