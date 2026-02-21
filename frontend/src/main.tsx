import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ActiveSessionProvider } from "./state/activeSession";
import { AthleteProvider } from "./state/athlete";
import { AuthProvider } from "./state/auth";
import { ExerciseCatalogProvider } from "./state/exerciseCatalog";
import { PreferencesProvider } from "./state/preferences";
import { UndoProvider } from "./state/undo";
import { ViewModeProvider } from "./state/viewMode";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <ViewModeProvider>
        <AthleteProvider>
          <PreferencesProvider>
            <ExerciseCatalogProvider>
              <UndoProvider>
                <ActiveSessionProvider>
                  <BrowserRouter>
                    <App />
                  </BrowserRouter>
                </ActiveSessionProvider>
              </UndoProvider>
            </ExerciseCatalogProvider>
          </PreferencesProvider>
        </AthleteProvider>
      </ViewModeProvider>
    </AuthProvider>
  </React.StrictMode>,
);

