import { Navigate, Route, Routes } from "react-router-dom";
import Home from "./pages/Home.tsx";
import Ingest from "./pages/Ingest.tsx";
import Athlete from "./pages/Athlete.tsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/ingest" element={<Ingest />} />
      <Route path="/athlete/:athleteId" element={<Athlete />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
