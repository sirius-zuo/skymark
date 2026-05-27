import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  publicDir: false,
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: false,
    fs: {
      allow: [".."],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "es2020",
    minify: "esbuild",
    sourcemap: true,
    outDir: "dist",
    emptyOutDir: true,
  },
});
