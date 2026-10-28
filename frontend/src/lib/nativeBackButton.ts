import { Capacitor } from "@capacitor/core";

// Android: con un listener de backButton el plugin App deja de navegar solo,
// asi que se cubren los dos casos. En la raiz se minimiza, como una app nativa.
export function installAndroidBackButton(): void {
  if (Capacitor.getPlatform() !== "android") return;
  void import("@capacitor/app").then(({ App }) =>
    App.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack) window.history.back();
      else void App.minimizeApp();
    }),
  );
}
