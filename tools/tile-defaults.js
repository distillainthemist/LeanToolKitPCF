#!/usr/bin/env node
// ⚠️  DOES NOT RUN — needs the retired PCF build.
//
// This generator serves tools/tile-defaults.html over out/controls/*/bundle.js,
// which `npm run build` produced from the PCF wrappers. Those wrappers were
// deleted when the PCF target retired
// (docs/leanboard-pcf-retirement-plan.md), so there is no out/controls to
// serve. To run it as-is, check out the v0.12.0 archive tag and build there.
//
// Its OUTPUT is still live: tools/tile-defaults.json is imported by
// app/src/store/catalog.ts and seeds each card type's empty-state tile in the
// LTK Card Catalog. That file is committed and unaffected — it simply cannot
// be regenerated until this is ported to mount the editor classes directly
// (see the retirement plan's follow-up note). The page's logic is kept as the
// reference for that port.
//
// Original usage:
//   npm run build
//   PORT=8295 node tools/tile-defaults.js     → open http://localhost:8295

"use strict";

const http = require("http");
const path = require("path");
const fs = require("fs");

const root = path.resolve(__dirname, "..", "out", "controls");
const page = path.resolve(__dirname, "tile-defaults.html");
const port = Number(process.env.PORT) || 8295;

if (!fs.existsSync(root)) {
  console.error("out/controls not found — run `npm run build` first.");
  process.exit(1);
}

const MIME = { ".js": "text/javascript", ".html": "text/html", ".json": "application/json" };

http
  .createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    // POST /save persists the generated JSON next to this script
    if (req.method === "POST" && url === "/save") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          JSON.parse(body); // validate before writing
          const target = path.resolve(__dirname, "tile-defaults.json");
          fs.writeFileSync(target, body);
          res.writeHead(200).end("saved " + target);
        } catch (e) {
          res.writeHead(400).end("invalid JSON: " + e.message);
        }
      });
      return;
    }
    // pages + data served from tools/ itself
    const toolFiles = {
      "/safari-tile-spike.html": "safari-tile-spike.html",
      "/boardgrid-demo.html": "boardgrid-demo.html",
      "/tile-defaults.json": "tile-defaults.json",
    };
    const file =
      url === "/" || url === "/tile-defaults.html"
        ? page
        : toolFiles[url]
          ? path.resolve(__dirname, toolFiles[url])
          : path.join(root, path.normalize(url).replace(/^([.][.][/\\])+/, ""));
    const allowed =
      file === page ||
      Object.values(toolFiles).some((f) => file === path.resolve(__dirname, f));
    if (!file.startsWith(root) && !allowed) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
      });
      res.end(data);
    });
  })
  .listen(port, () => console.log(`tile-defaults generator on http://localhost:${port}`));
