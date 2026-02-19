import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AthleteProvider } from "./state/athlete";
import { AuthProvider } from "./state/auth";
import { ExerciseCatalogProvider } from "./state/exerciseCatalog";
import { PreferencesProvider } from "./state/preferences";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <AthleteProvider>
        <PreferencesProvider>
          <ExerciseCatalogProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </ExerciseCatalogProvider>
        </PreferencesProvider>
      </AthleteProvider>
    </AuthProvider>
  </React.StrictMode>,
);

