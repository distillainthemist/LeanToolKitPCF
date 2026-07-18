import { defineConfig } from "vite";

export default defineConfig({
  // Relative base is REQUIRED for code apps: the Power Apps appruntime
  // serves the bundle from a deep path, so absolute /assets URLs 404
  // (symptom: blank app inside the host). Learned in the Phase 0 spike.
  base: "./",
  server: { port: 5180, strictPort: true },
});
