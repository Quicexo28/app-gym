import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const rootDir = dirname(fileURLToPath(import.meta.url));
const apiProxyTarget = process.env.VITE_PROXY_TARGET?.trim() || "http://127.0.0.1:8000";

export default defineConfig({
  root: rootDir,
  plugins: [react()],
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
