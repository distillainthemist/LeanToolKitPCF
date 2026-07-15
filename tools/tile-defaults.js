#!/usr/bin/env node
// Serve the tile-defaults generator (tools/tile-defaults.html) over the built
// control bundles. The page instantiates every snapshot-capable control with
// EMPTY inputs, harvests its empty-state svgExport, and offers the combined
// tile-defaults.json for download — the seed for the LTK Card Catalog table
// (see docs/master-leanboard.md, "Tile defaults").
//
//   npm run build
//   PORT=8295 node tools/tile-defaults.js     → open http://localhost:8295
//
// Regenerate per release and commit tools/tile-defaults.json.

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
    const file =
      url === "/" || url === "/tile-defaults.html"
        ? page
        : url === "/safari-tile-spike.html"
          ? path.resolve(__dirname, "safari-tile-spike.html")
          : path.join(root, path.normalize(url).replace(/^([.][.][/\\])+/, ""));
    const spike = path.resolve(__dirname, "safari-tile-spike.html");
    if (!file.startsWith(root) && file !== page && file !== spike) {
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
