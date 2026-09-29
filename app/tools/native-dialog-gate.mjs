// Native-dialog gate (2026-09-29): window.prompt / confirm / alert render
// unstyled, name the hosting domain in their title and cannot be themed —
// Ben met one on the stage move. Every question goes through
// app/src/prompts.ts (the app) or shared/ui/dialog.ts (the controls).
//
// Run from app/: node tools/native-dialog-gate.mjs
// Exit 1 on any native call, with the file and line printed.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(process.cwd(), "..");
const DIRS = ["app/src", "controls", "shared"];
const SKIP = new Set(["node_modules", "generated", "__tests__", "out", "dist"]);
const NATIVE = /(^|[^A-Za-z0-9_.$])(?:window\.)?(prompt|confirm|alert)\s*\(/;

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.ts$/.test(name) && !/\.(test|d)\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const hits = [];
let scanned = 0;
for (const d of DIRS) {
  for (const f of files(join(ROOT, d))) {
    scanned++;
    readFileSync(f, "utf8")
      .split("\n")
      .forEach((line, n) => {
        // comments and string contents are not calls
        const code = line.replace(/\/\/.*$/, "").replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
        if (NATIVE.test(code)) hits.push(`${f.slice(ROOT.length + 1)}:${n + 1}  ${line.trim().slice(0, 100)}`);
      });
  }
}
if (hits.length > 0) {
  console.error(`native-dialog-gate: ${hits.length} browser-native dialog call(s) — use app/src/prompts.ts or shared/ui/dialog.ts:`);
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`native-dialog-gate: OK — ${scanned} files, no prompt / confirm / alert`);
