import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const rootDir = dirname(fileURLToPath(import.meta.url));
const apiProxyTarget = process.env.VITE_PROXY_TARGET?.trim() || "http://127.0.0.1:8000";

export default defineConfig({
  root: rootDir,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["vite.svg", "icons/pwa-192.png", "icons/pwa-512.png"],
      manifest: {
        name: "Coach AI Engineer",
        short_name: "Coach AI",
        description: "Registro de entrenamiento y analitica de decisiones, usable sin conexion.",
        lang: "es",
        display: "standalone",
        start_url: "/",
        scope: "/",
        theme_color: "#111418",
        background_color: "#111418",
        icons: [
          { src: "/icons/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/pwa-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/pwa-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // el chunk del reconocedor de voz pesa ~5.8MB; hay que precachearlo
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/docs/, /^\/redoc/],
        runtimeCaching: [
          {
            // lecturas del API: red primero, cache como respaldo offline
            urlPattern: ({ url, request }) =>
              url.pathname.startsWith("/api/") && request.method === "GET",
            handler: "NetworkFirst",
            options: {
              cacheName: "api-get",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 200, maxAgeSeconds: 7 * 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // modelo de voz Vosk (~40MB): cache primero, se descarga una vez
            urlPattern: ({ url }) => url.pathname.startsWith("/models/"),
            handler: "CacheFirst",
            options: {
              cacheName: "voice-models",
              expiration: { maxEntries: 3 },
              cacheableResponse: { statuses: [0, 200] },
              rangeRequests: true,
            },
          },
          {
            // script de Google Identity: no bloquear si estamos offline
            urlPattern: ({ url }) => url.hostname === "accounts.google.com",
            handler: "NetworkOnly",
          },
        ],
      },
      devOptions: {
        // service worker tambien en `vite dev` para poder probar offline en dev
        enabled: true,
        type: "module",
      },
    }),
  ],
  server: {
    proxy: {
      // todo lo que empiece con /api se redirige al backend FastAPI
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
});
