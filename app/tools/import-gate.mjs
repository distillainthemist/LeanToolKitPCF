// Import gate — the Standard Documents guardrail (Phase 0 of
// docs/leanboard-standard-documents-plan.md).
//
// The documents area lives under src/docs/ and must stay out of the
// board's critical path. Only STATIC import edges are policed — dynamic
// import() is the sanctioned door (it is what keeps bytes out of a
// chunk), and `import type` is erased at build so it carries no bytes.
//
// Rules:
//   A. The board path (main.ts, screens/board.ts, screens/hub.ts,
//      cardRegistry.ts + their static closures) must not reach src/docs/.
//   B. src/docs/ must not reach any board-path entry module.
//   C. Generated SharePoint connector services may be statically
//      imported ONLY from src/docs/ (everything else must use dynamic
//      import) — this is what keeps connector bytes out of every other
//      chunk.
//
// Run from app/: node tools/import-gate.mjs
// Exit 1 on any violation, with the offending import chain printed.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

const APP = process.cwd();
const SRC = resolve(APP, "src");
const ROOT = resolve(APP, "..");

const BOARD_ENTRIES = [
  resolve(SRC, "main.ts"),
  resolve(SRC, "cardRegistry.ts"),
  resolve(SRC, "screens", "board.ts"),
  resolve(SRC, "screens", "hub.ts"),
].filter((p) => existsSync(p));

const isDocs = (p) => p.includes(`${sep}src${sep}docs${sep}`);
const isGenerated = (p) => p.includes(`${sep}src${sep}generated${sep}`);

// SharePoint services are found from power.config.json (the authority on
// which data sources belong to which connector), matched to generated
// service files by their `dataSourceName = '<name>'` line — pac names
// files after the TABLE (DocumentsService.ts), so a filename heuristic
// cannot work.
function spServiceFiles() {
  const cfgPath = resolve(APP, "power.config.json");
  if (!existsSync(cfgPath)) return new Set();
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  const spSources = new Set();
  for (const ref of Object.values(cfg.connectionReferences ?? {})) {
    if (typeof ref.id === "string" && ref.id.endsWith("shared_sharepointonline")) {
      for (const ds of ref.dataSources ?? []) spSources.add(ds.toLowerCase());
    }
  }
  const out = new Set();
  const svcDir = resolve(SRC, "generated", "services");
  if (spSources.size === 0 || !existsSync(svcDir)) return out;
  for (const name of readdirSync(svcDir)) {
    if (!name.endsWith(".ts")) continue;
    const p = join(svcDir, name);
    const m = /dataSourceName = '([^']+)'/.exec(readFileSync(p, "utf8"));
    if (m && spSources.has(m[1].toLowerCase())) out.add(p);
  }
  return out;
}
const SP_SERVICES = spServiceFiles();
const isSpService = (p) => SP_SERVICES.has(p);

// ---- collect every .ts source the app can reach (src + shared + controls)
function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) out.push(p);
  }
}
const files = [];
walk(SRC, files);
for (const extra of ["shared", "controls"]) {
  const p = resolve(ROOT, extra);
  if (existsSync(p)) walk(p, files);
}
const fileSet = new Set(files);

// ---- static import edges per file --------------------------------------
// Matches `import ... from "x"`, `export ... from "x"`, `import "x"`.
// Skips dynamic `import("x")` (no `from`, paren excluded) and pure
// `import type` (erased at build).
const FROM_RE = /(?:^|\n)\s*(import|export)\s+([^;]*?)\sfrom\s*["']([^"']+)["']/g;
const BARE_RE = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;

function resolveSpec(from, spec) {
  if (!spec.startsWith(".")) return null; // packages are not ours to police
  const base = resolve(dirname(from), spec);
  for (const cand of [base, `${base}.ts`, join(base, "index.ts")]) {
    if (fileSet.has(cand)) return cand;
  }
  return null; // .css/.json leaves — no further edges to follow
}

const deps = new Map(); // file -> Set(file)
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const out = new Set();
  for (const m of text.matchAll(FROM_RE)) {
    if (m[1] === "import" && /^type\s/.test(m[2].trim())) continue; // type-only
    const target = resolveSpec(file, m[3]);
    if (target) out.add(target);
  }
  for (const m of text.matchAll(BARE_RE)) {
    const target = resolveSpec(file, m[1]);
    if (target) out.add(target);
  }
  deps.set(file, out);
}

// ---- closure walk with parent tracking for readable chains --------------
function closure(entries) {
  const parent = new Map();
  const queue = [...entries];
  for (const e of entries) parent.set(e, null);
  while (queue.length > 0) {
    const cur = queue.shift();
    for (const next of deps.get(cur) ?? []) {
      if (!parent.has(next)) {
        parent.set(next, cur);
        queue.push(next);
      }
    }
  }
  return parent;
}

const rel = (p) => p.replace(`${ROOT}${sep}`, "");
function chain(parent, node) {
  const path = [];
  for (let cur = node; cur; cur = parent.get(cur)) path.unshift(rel(cur));
  return path.join("\n    → ");
}

const violations = [];

// Rule A + board half of C: nothing docs-side or SharePoint-generated in
// the board path's static closure.
const boardClosure = closure(BOARD_ENTRIES);
for (const node of boardClosure.keys()) {
  if (isDocs(node)) {
    violations.push(`RULE A — board path statically reaches the docs area:\n    ${chain(boardClosure, node)}`);
  } else if (isSpService(node)) {
    violations.push(`RULE C — board path statically reaches a SharePoint service:\n    ${chain(boardClosure, node)}`);
  }
}

// Rule B: the docs area must not statically reach a board entry.
const docsFiles = files.filter(isDocs);
if (docsFiles.length > 0) {
  const docsClosure = closure(docsFiles);
  for (const entry of BOARD_ENTRIES) {
    if (docsClosure.has(entry)) {
      violations.push(`RULE B — docs area statically reaches the board path:\n    ${chain(docsClosure, entry)}`);
    }
  }
}

// Rule C (source side): outside src/docs/ and src/generated/, no file may
// statically reach a SharePoint service — including via the generated
// barrel (src/generated/index.ts re-exports every service, so a static
// import of the barrel launders the connector into the importer's chunk).
// The walk therefore continues through generated/ intermediates.
function reachesSpViaGenerated(start) {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    for (const dep of deps.get(queue.shift()) ?? []) {
      if (isSpService(dep)) return dep;
      if (isGenerated(dep) && !seen.has(dep)) {
        seen.add(dep);
        queue.push(dep);
      }
    }
  }
  return null;
}
for (const file of files) {
  if (isDocs(file) || isGenerated(file)) continue;
  const hit = reachesSpViaGenerated(file);
  if (hit) {
    violations.push(`RULE C — ${rel(file)} statically reaches ${rel(hit)} (use dynamic import, or move it under src/docs/)`);
  }
}

if (violations.length > 0) {
  console.error(`import-gate: ${violations.length} violation(s)\n`);
  for (const v of violations) console.error(`  ${v}\n`);
  process.exit(1);
}
console.log(
  `import-gate: OK — ${files.length} files, board closure ${boardClosure.size}, ` +
    `docs files ${docsFiles.length}, SharePoint services ${files.filter(isSpService).length}`
);
