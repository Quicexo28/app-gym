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
  plugins: {
    SocialLogin: {
      // Solo Google y Apple. Con facebook: false el hook de `cap sync` no
      // empaqueta el SDK de Facebook, que mete AD_ID y ACCESS_ADSERVICES_*
      // en el manifest (choca con "sin ID de publicidad" en Data Safety).
      providers: {
        google: true,
        apple: true,
        facebook: false,
        twitter: false,
        telegram: false,
      },
    },
  },
};

export default config;
