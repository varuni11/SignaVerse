import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

// Standalone Vite SPA config (no Lovable / TanStack Start / Nitro dependency
// required). Client-side TanStack Router handles navigation; routes are the
// same file-based route modules under src/routes.
export default defineConfig({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "./src/routes",
    }),
    react(),
    tailwindcss(),
    tsConfigPaths(),
  ],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: "dist",
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4000,
  },
});
