// Chunk-size report — the Standard Documents guardrail (Phase 0 of
// docs/leanboard-standard-documents-plan.md).
//
// Prints every built chunk's size against the recorded baseline, and
// FAILS only when a chunk with a ceiling exceeds it. Deliberately not a
// percentage ratchet: legitimate board work grows board chunks, and a
// perpetually re-baselined check protects nothing. Ceilings are generous
// (baseline × 1.25 + 10 KB) so they catch a docs-sized leak (tens of KB
// of connector/service code landing in the board path), not normal
// feature growth. Raising a ceiling is a deliberate act:
//
//   node tools/chunk-report.mjs --write-baseline
//
// Run from app/ AFTER `npm run build`: node tools/chunk-report.mjs

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const APP = process.cwd();
const ASSETS = resolve(APP, "dist", "assets");
const BASELINE = resolve(APP, "tools", "chunk-baseline.json");

// Chunks on (or near) the board critical path get ceilings; everything
// else is report-only. A brand-new lazy chunk (e.g. the docs area) is
// expected and unlimited — the import gate is what protects the board.
const CEILINGED = [
  "index",
  "cardRegistry",
  "mappers",
  "composer",
  "hub",
  "settings",
  "board",
  "cardEditor",
];

if (!existsSync(ASSETS)) {
  console.error("chunk-report: dist/assets missing — run `npm run build` first");
  process.exit(1);
}

// vite emits name-<hash>.js where the hash is exactly 8 chars of
// [A-Za-z0-9_-] — which can itself contain hyphens, so fold by slicing
// the fixed-length tail, never by splitting on the last hyphen
const sizes = {};
for (const file of readdirSync(ASSETS)) {
  if (!file.endsWith(".js")) continue;
  const stem = file.slice(0, -3);
  if (stem.length < 10 || stem[stem.length - 9] !== "-") continue;
  if (!/^[A-Za-z0-9_-]{8}$/.test(stem.slice(-8))) continue;
  const name = stem.slice(0, -9);
  sizes[name] = (sizes[name] ?? 0) + statSync(resolve(ASSETS, file)).size;
}

if (process.argv.includes("--write-baseline")) {
  const ceilings = {};
  for (const name of CEILINGED) {
    if (sizes[name] !== undefined) {
      ceilings[name] = Math.ceil(sizes[name] * 1.25) + 10240;
    }
  }
  writeFileSync(
    BASELINE,
    JSON.stringify({ updated: new Date().toISOString().slice(0, 10), ceilings, sizes }, null, 2) + "\n"
  );
  console.log(`chunk-report: baseline written (${Object.keys(sizes).length} chunks, ${Object.keys(ceilings).length} ceilings)`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error("chunk-report: no baseline — run with --write-baseline once");
  process.exit(1);
}
const base = JSON.parse(readFileSync(BASELINE, "utf8"));

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
const names = [...new Set([...Object.keys(sizes), ...Object.keys(base.sizes)])].sort(
  (a, b) => (sizes[b] ?? 0) - (sizes[a] ?? 0)
);

let failed = false;
console.log(`chunk-report (baseline ${base.updated}):`);
for (const name of names) {
  const now = sizes[name];
  const was = base.sizes[name];
  const ceiling = base.ceilings[name];
  let note = "";
  if (now === undefined) note = "(gone)";
  else if (was === undefined) note = "(new — report only)";
  else {
    const d = now - was;
    note = d === 0 ? "±0" : `${d > 0 ? "+" : ""}${kb(d)}`;
  }
  let flag = " ";
  if (ceiling !== undefined && now !== undefined && now > ceiling) {
    flag = "✗";
    failed = true;
    note += `  EXCEEDS ceiling ${kb(ceiling)}`;
  }
  console.log(
    `  ${flag} ${name.padEnd(22)} ${kb(now ?? 0).padStart(10)}  ${note}`
  );
}

if (failed) {
  console.error(
    "\nchunk-report: ceiling exceeded. If this is deliberate board-path growth, re-baseline with --write-baseline; if not, find the leak (import-gate should have caught a static edge — check dynamic imports pulling weight eagerly)."
  );
  process.exit(1);
}
console.log("chunk-report: OK");
