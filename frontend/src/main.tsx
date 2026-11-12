import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { installAndroidBackButton } from "./lib/nativeBackButton";
import { ActiveSessionProvider } from "./state/activeSession";
import { AthleteProvider } from "./state/athlete";
import { AuthProvider } from "./state/auth";
import { ExerciseCatalogProvider } from "./state/exerciseCatalog";
import { PreferencesProvider } from "./state/preferences";
import { UndoProvider } from "./state/undo";
import { ViewScopesProvider } from "./state/viewScopes";
import "./styles.css";

installAndroidBackButton();

// WKWebView (iOS) puede ignorar user-scalable=no: bloquear el pellizco a mano.
for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
  document.addEventListener(type, (e) => e.preventDefault());
}
document.addEventListener(
  "touchmove",
  (e) => {
    if (e.touches.length > 1) e.preventDefault();
  },
  { passive: false },
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <ViewScopesProvider>
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
        </ViewScopesProvider>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

