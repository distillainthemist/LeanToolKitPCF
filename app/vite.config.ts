import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

// The build stamps its own identity (issues plan I1): releases get the
// tag (git describe), CI tag checkouts and dev trees get tag-or-SHA,
// and a gitless build still compiles. Issue reports carry this, so
// "which version were you on?" never has to be asked.
function appVersion(): string {
  try {
    return execSync("git describe --tags --always --dirty", {
      encoding: "utf8",
    }).trim();
  } catch {
    return "dev";
  }
}

// Lets tile-defaults.html write its result straight to tools/tile-defaults.json
// (the file src/store/catalog.ts imports) instead of downloading and moving it
// by hand. Dev server only — `apply: "serve"` keeps it out of the build.
const TILE_DEFAULTS_ROUTE = "/__tile-defaults";
const TARGET = resolve(__dirname, "..", "tools", "tile-defaults.json");

function tileDefaultsWriter(): Plugin {
  return {
    name: "ltk-tile-defaults-writer",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(TILE_DEFAULTS_ROUTE, (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("POST only");
          return;
        }
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            JSON.parse(body); // never write anything the app cannot import
            writeFileSync(TARGET, body.endsWith("\n") ? body : body + "\n");
            res.statusCode = 200;
            res.end("tools/tile-defaults.json");
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [tileDefaultsWriter()],
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  // Relative base is REQUIRED for code apps: the Power Apps appruntime
  // serves the bundle from a deep path, so absolute /assets URLs 404
  // (symptom: blank app inside the host). Learned in the Phase 0 spike.
  base: "./",
  // fs.allow spans the monorepo root: app source imports ../controls and
  // ../shared, and dev-time verification imports controls via /@fs/
  server: {
    // honour an assigned port (parallel sessions each get their own via
    // PORT); 5180 stays the default for a plain `npm run dev`
    port: Number(process.env.PORT ?? "") || 5180,
    strictPort: true,
    fs: { allow: [".."] },
    // tools/tile-defaults.json is imported by src/store/catalog.ts, so a
    // write to it would trigger HMR — which reloads the generator page,
    // which regenerates and writes again. Ignoring it breaks that loop.
    watch: { ignored: ["**/tools/tile-defaults.json"] },
  },
});
