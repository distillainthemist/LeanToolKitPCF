#!/usr/bin/env node
// Serve a built control in the pcf-start harness on a configurable port.
// pcf-start hardcodes port 8181, so two harnesses (e.g. two Claude/dev
// sessions, or Safari + the browser pane) can't run side by side. This is
// the same browser-sync setup pcf-start's RunTask uses, with the port taken
// from $PORT (default 8181).
//
//   PORT=8282 node tools/pcf-serve.js out/controls/CardSettings

"use strict";

const path = require("path");
const fs = require("fs");
const bs = require("browser-sync");

const codePath = process.argv[2] || ".";
const resolved = path.resolve(process.cwd(), codePath);
if (!fs.existsSync(resolved)) {
  console.error(`The specified codePath '${codePath}' does not exist.`);
  process.exit(1);
}

const port = Number(process.env.PORT) || 8181;
const pcfStartRoot = path.dirname(
  require.resolve("pcf-start/package.json")
);

bs.init({
  online: false,
  port,
  reloadDelay: 1000,
  server: {
    baseDir: resolved,
    routes: { "/": pcfStartRoot },
  },
  ui: false,
  watch: true,
});
