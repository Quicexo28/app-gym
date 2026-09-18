import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.santiagoquiceno.alzo",
  appName: "Alzo",
  webDir: "frontend/dist",
  android: {
    allowMixedContent: false,
  },
  server: {
    // El webview sirve la app desde https://localhost; las llamadas
    // relativas a /api/ requieren un backend publico (ver VITE_API_BASE_URL).
    androidScheme: "https",
  },
};

export default config;
