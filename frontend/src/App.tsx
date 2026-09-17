import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import AppShell from "./layout/AppShell";
import AdminTools from "./pages/AdminTools";
import Athlete from "./pages/Athlete";
import BodyMetrics from "./pages/BodyMetrics";
import CargasExerciseDetail from "./pages/CargasExerciseDetail";
import CargasExercises from "./pages/CargasExercises";
import CargasHub from "./pages/CargasHub";
import CargasRoutineDetail from "./pages/CargasRoutineDetail";
import CargasRoutines from "./pages/CargasRoutines";
import CoachInvite from "./pages/CoachInvite";
import Diet from "./pages/Diet";
import DietAddEntry from "./pages/DietAddEntry";
import DietFoods from "./pages/DietFoods";
import DietHistory from "./pages/DietHistory";
import DietNutrition from "./pages/DietNutrition";
import DietToday from "./pages/DietToday";
import Exercises from "./pages/Exercises";
import Home from "./pages/Home";
import Login from "./pages/Login";
import MeasurementLog from "./pages/MeasurementLog";
import MetricDetail from "./pages/MetricDetail";
import NewSession from "./pages/NewSession";
import Planning from "./pages/Planning";
import Predictions from "./pages/Predictions";
import Preferences from "./pages/Preferences";
import Profile from "./pages/Profile";
import ProfileHub from "./pages/ProfileHub";
import Progress from "./pages/Progress";
import ProgressPhotos from "./pages/ProgressPhotos";
import Routines from "./pages/Routines";
import RunDetail from "./pages/RunDetail";
import Steps from "./pages/Steps";
import Training from "./pages/Training";
import UsersHub from "./pages/UsersHub";
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

        <Route path="diet" element={<Diet />}>
          <Route index element={<DietToday />} />
          <Route path="alimentos" element={<DietFoods />} />
          {/* Objetivos dejo de ser pestana: se ajusta dentro del detalle nutricional. */}
          <Route path="objetivos" element={<Navigate to="/diet/nutricion" replace />} />
        </Route>
        <Route path="diet/agregar" element={<DietAddEntry />} />
        <Route path="diet/nutricion" element={<DietNutrition />} />
        <Route path="diet/historial" element={<DietHistory />} />

        <Route path="steps" element={<Steps />} />

        <Route path="training" element={<Training />}>
          <Route index element={<Routines />} />
          <Route path="plan" element={<Planning />} />
          <Route path="exercises" element={<Exercises />} />
        </Route>

        <Route path="predictions" element={<Predictions />} />
        <Route path="predictions/run/:runId" element={<RunDetail />} />

        <Route path="profile" element={<ProfileHub />}>
          <Route index element={<Profile />} />
          <Route path="progress" element={<Progress />}>
            <Route index element={<BodyMetrics />} />
            <Route path="medida/nueva" element={<MeasurementLog />} />
            <Route path="medida/:metricKey" element={<MetricDetail />} />
            <Route path="cargas" element={<CargasHub />}>
              <Route index element={<CargasRoutines />} />
              <Route path="ejercicios" element={<CargasExercises />} />
            </Route>
            <Route path="cargas/rutina/:routineId" element={<CargasRoutineDetail />} />
            <Route path="cargas/ejercicio/:exerciseKey" element={<CargasExerciseDetail />} />
            <Route path="photos" element={<ProgressPhotos />} />
          </Route>
          <Route path="measurements" element={<Navigate to="/profile/progress" replace />} />
          <Route path="preferences" element={<Preferences />} />
          <Route path="admin" element={<AdminTools />} />
        </Route>

        <Route path="session/new" element={<NewSession />} />
        <Route path="users" element={<UsersHub />} />
        <Route path="users/:athleteId" element={<Athlete />} />
        <Route path="coach/invite" element={<CoachInvite />} />
        <Route path="athlete/:athleteId" element={<Navigate to="/users" replace />} />

        {/* Rutas previas a la reestructuracion de pestañas. */}
        <Route path="history" element={<Navigate to="/home" replace />} />
        <Route path="achievements" element={<Navigate to="/home" replace />} />
        <Route path="routines" element={<Navigate to="/training" replace />} />
        <Route path="planning" element={<Navigate to="/training/plan" replace />} />
        <Route path="exercises" element={<Navigate to="/training/exercises" replace />} />
        <Route path="measurements" element={<Navigate to="/profile/progress" replace />} />
        <Route path="settings" element={<Navigate to="/profile/preferences" replace />} />
        <Route path="run/:runId" element={<Navigate to="/predictions" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
