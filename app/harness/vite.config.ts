import path from "node:path";
import { defineConfig } from "vite";
// the grid talks to the card-series store; the harness swaps in memory
export default defineConfig({
  resolve: {
    alias: [{ find: /^(\.\.\/)+store\/series$/, replacement: path.resolve(__dirname, "seriesStub.ts") }],
  },
});
