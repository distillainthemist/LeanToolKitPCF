// Value driver formulas — a small expression language parsed to an AST
// (never eval). v1 set (review decision 6, 2026-09-01): + − × ÷ ^,
// unary minus, parentheses, postfix % (5% → 0.05), and SUM / AVG / MIN /
// MAX / ABS / ROUND(x[, n]) with CHILDREN as "every driver child" inside
// the aggregate functions. Child references are stored as {id} tokens
// (the editor shows them as chips by name, so a rename never breaks a
// formula). Units are inferred with a small algebra and only ever WARN.

import { CADENCE_RANK, DriverNode, formulaChildren, Series, valueOf } from "./model";

// ---- AST ---------------------------------------------------------------------

export type Ast =
  | { t: "num"; v: number }
  | { t: "ref"; id: string }
  | { t: "children" }
  | { t: "neg"; a: Ast }
  | { t: "bin"; op: "+" | "-" | "*" | "/" | "^"; a: Ast; b: Ast }
  | { t: "fn"; name: FnName; args: Ast[] };

export type FnName = "SUM" | "AVG" | "MIN" | "MAX" | "ABS" | "ROUND";
const FNS: FnName[] = ["SUM", "AVG", "MIN", "MAX", "ABS", "ROUND"];
const AGG_FNS = new Set<FnName>(["SUM", "AVG", "MIN", "MAX"]);

export class FormulaError extends Error {}

// ---- tokenizer ------------------------------------------------------------------

type Tok =
  | { k: "num"; v: number }
  | { k: "ref"; id: string }
  | { k: "id"; v: string }
  | { k: "op"; v: string }
  | { k: "("; }
  | { k: ")"; }
  | { k: ","; }
  | { k: "%"; };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const s = src.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "{") {
      const j = s.indexOf("}", i);
      if (j < 0) throw new FormulaError("A reference is missing its closing brace");
      out.push({ k: "ref", id: s.slice(i + 1, j).trim() });
      i = j + 1;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?|^[0-9]+\.?/i.exec(s.slice(i));
      if (!m) throw new FormulaError(`Unexpected "${c}"`);
      out.push({ k: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[a-z_]/i.test(c)) {
      const m = /^[a-z_][a-z0-9_]*/i.exec(s.slice(i));
      out.push({ k: "id", v: (m as RegExpExecArray)[0] });
      i += (m as RegExpExecArray)[0].length;
      continue;
    }
    if ("+-*/^".includes(c)) {
      out.push({ k: "op", v: c });
      i++;
      continue;
    }
    if (c === "(") out.push({ k: "(" });
    else if (c === ")") out.push({ k: ")" });
    else if (c === ",") out.push({ k: "," });
    else if (c === "%") out.push({ k: "%" });
    else throw new FormulaError(`Unexpected "${c}"`);
    i++;
  }
  return out;
}

// ---- parser (precedence climbing) --------------------------------------------------

export function parseFormula(src: string): Ast {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const take = () => toks[p++];
  const expectClose = () => {
    const t = take();
    if (!t || t.k !== ")") throw new FormulaError("Expected a closing parenthesis");
  };

  const primary = (): Ast => {
    const t = take();
    if (!t) throw new FormulaError("The formula ends early");
    if (t.k === "num") return postfix({ t: "num", v: t.v });
    if (t.k === "ref") return postfix({ t: "ref", id: t.id });
    if (t.k === "(") {
      const e = expr(0);
      expectClose();
      return postfix(e);
    }
    if (t.k === "op" && t.v === "-") return { t: "neg", a: unary() };
    if (t.k === "op" && t.v === "+") return unary();
    if (t.k === "id") {
      const up = t.v.toUpperCase();
      if (up === "CHILDREN") return { t: "children" };
      if (!FNS.includes(up as FnName)) throw new FormulaError(`"${t.v}" is not a function — reference drivers as chips`);
      const open = take();
      if (!open || open.k !== "(") throw new FormulaError(`${up} needs parentheses`);
      const args: Ast[] = [];
      if (peek()?.k !== ")") {
        args.push(expr(0));
        while (peek()?.k === ",") {
          take();
          args.push(expr(0));
        }
      }
      expectClose();
      return postfix({ t: "fn", name: up as FnName, args });
    }
    throw new FormulaError("Unexpected token");
  };
  const postfix = (a: Ast): Ast => {
    let out = a;
    while (peek()?.k === "%") {
      take();
      out = { t: "bin", op: "/", a: out, b: { t: "num", v: 100 } };
    }
    return out;
  };
  const unary = (): Ast => primary();
  const prec: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 3 };
  const expr = (min: number): Ast => {
    let left = unary();
    for (;;) {
      const t = peek();
      if (!t || t.k !== "op" || prec[t.v] === undefined || prec[t.v] < min) break;
      take();
      const op = t.v as "+" | "-" | "*" | "/" | "^";
      // ^ is right-associative
      const right = expr(op === "^" ? prec[op] : prec[op] + 1);
      left = { t: "bin", op, a: left, b: right };
    }
    return left;
  };
  const ast = expr(0);
  if (p < toks.length) throw new FormulaError("Unexpected content after the formula");
  return ast;
}

// ---- evaluation --------------------------------------------------------------------

export interface EvalCtx {
  /** A child's value ("" id never occurs). null = unknown → the result is null. */
  ref: (id: string) => number | null;
  /** The ids CHILDREN expands to. */
  children: string[];
}

/** null = not computable (missing input or a divide by zero). */
export function evaluate(ast: Ast, ctx: EvalCtx): number | null {
  const args = (a: Ast[]): (number | null)[] => {
    const out: (number | null)[] = [];
    for (const x of a) {
      if (x.t === "children") for (const id of ctx.children) out.push(ctx.ref(id));
      else out.push(evaluate(x, ctx));
    }
    return out;
  };
  switch (ast.t) {
    case "num":
      return ast.v;
    case "ref":
      return ctx.ref(ast.id);
    case "children":
      return null; // only meaningful inside an aggregate
    case "neg": {
      const v = evaluate(ast.a, ctx);
      return v === null ? null : -v;
    }
    case "bin": {
      const a = evaluate(ast.a, ctx);
      const b = evaluate(ast.b, ctx);
      if (a === null || b === null) return null;
      if (ast.op === "+") return a + b;
      if (ast.op === "-") return a - b;
      if (ast.op === "*") return a * b;
      if (ast.op === "/") return b === 0 ? null : a / b;
      const r = Math.pow(a, b);
      return Number.isFinite(r) ? r : null;
    }
    case "fn": {
      const vs = args(ast.args);
      if (ast.name === "ROUND") {
        const [x, n] = vs;
        if (x === null || x === undefined) return null;
        const d = typeof n === "number" ? Math.max(0, Math.round(n)) : 0;
        const f = Math.pow(10, d);
        return Math.round(x * f) / f;
      }
      if (ast.name === "ABS") {
        const [x] = vs;
        return x === null || x === undefined ? null : Math.abs(x);
      }
      const nums = vs.filter((v): v is number => v !== null);
      if (nums.length === 0) return null;
      if (ast.name === "SUM") return nums.reduce((a, b) => a + b, 0);
      if (ast.name === "AVG") return nums.reduce((a, b) => a + b, 0) / nums.length;
      if (ast.name === "MIN") return Math.min(...nums);
      return Math.max(...nums);
    }
  }
}

// ---- units (a small algebra; warnings only) -------------------------------------

/** "kL" × "$/kL" → "$"; "$" ÷ "kL" → "$/kL"; same-unit + − keep it. "" =
 *  unitless; "?" = unclear (power / mixed). */
export function combineUnits(op: "+" | "-" | "*" | "/" | "^", a: string, b: string, warn: (m: string) => void): string {
  const A = a.trim();
  const B = b.trim();
  if (op === "+" || op === "-") {
    if (A === B || A === "" || B === "") return A || B;
    warn(`Adding ${A} to ${B} — check the units`);
    return A;
  }
  if (op === "^") {
    if (A === "") return "";
    warn(`A power of ${A} — the unit is unclear`);
    return "?";
  }
  if (op === "*") {
    if (A === "") return B;
    if (B === "") return A;
    // cancel: X/Y × Y → X, Y × X/Y → X
    const ma = /^(.+)\/(.+)$/.exec(A);
    const mb = /^(.+)\/(.+)$/.exec(B);
    if (ma && ma[2].trim() === B) return ma[1].trim();
    if (mb && mb[2].trim() === A) return mb[1].trim();
    return `${A}·${B}`;
  }
  // divide
  if (B === "") return A;
  if (A === B) return "";
  if (A === "") return `1/${B}`;
  return `${A}/${B}`;
}

export function unitOf(ast: Ast, unitOfRef: (id: string) => string, children: string[], warn: (m: string) => void): string {
  switch (ast.t) {
    case "num":
      return "";
    case "ref":
      return unitOfRef(ast.id);
    case "children": {
      const us = [...new Set(children.map(unitOfRef))];
      if (us.length > 1) warn(`Children carry different units (${us.join(", ")})`);
      return us[0] ?? "";
    }
    case "neg":
      return unitOf(ast.a, unitOfRef, children, warn);
    case "bin":
      return combineUnits(ast.op, unitOf(ast.a, unitOfRef, children, warn), unitOf(ast.b, unitOfRef, children, warn), warn);
    case "fn": {
      if (ast.name === "ROUND") return ast.args[0] ? unitOf(ast.args[0], unitOfRef, children, warn) : "";
      const us = [...new Set(ast.args.map((a) => unitOf(a, unitOfRef, children, warn)).filter((u) => u !== ""))];
      if (us.length > 1) warn(`${ast.name} mixes ${us.join(" and ")}`);
      return us[0] ?? "";
    }
  }
}

// ---- validation (the editor's sentences) -------------------------------------------

export interface FormulaCheck {
  ok: boolean;
  /** Blocks save. */
  errors: string[];
  /** Shown, never blocks. */
  warnings: string[];
  /** Ids referenced (incl. via CHILDREN). */
  used: string[];
  /** Driver children NOT used — visible so nobody forgets one. */
  unused: string[];
  unit: string;
}

export function refsOf(ast: Ast, children: string[]): string[] {
  const out = new Set<string>();
  const walk = (a: Ast) => {
    if (a.t === "ref") out.add(a.id);
    else if (a.t === "children") for (const id of children) out.add(id);
    else if (a.t === "neg") walk(a.a);
    else if (a.t === "bin") {
      walk(a.a);
      walk(a.b);
    } else if (a.t === "fn") a.args.forEach(walk);
  };
  walk(ast);
  return [...out];
}

/** Every driver-node check the editor shows, in words (spec 3.2). */
export function checkFormula(node: DriverNode, nodes: DriverNode[]): FormulaCheck {
  const kids = formulaChildren(nodes, node.id);
  const kidIds = kids.map((k) => k.id);
  const by = new Map(nodes.map((n) => [n.id, n]));
  const errors: string[] = [];
  const warnings: string[] = [];
  if (node.kind === "leading") {
    if (node.formula.trim() !== "") errors.push("A leading indicator has no formula — it is measured, not computed");
    return { ok: errors.length === 0, errors, warnings, used: [], unused: [], unit: node.unit };
  }
  const src = node.formula.trim();
  if (src === "") {
    if (kids.length > 0) warnings.push("No formula — this node won't roll its children up");
    return { ok: true, errors, warnings, used: [], unused: kidIds, unit: node.unit };
  }
  let ast: Ast;
  try {
    ast = parseFormula(src);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
    return { ok: false, errors, warnings, used: [], unused: kidIds, unit: node.unit };
  }
  // function arity
  const arity = (a: Ast) => {
    if (a.t === "fn") {
      if (a.name === "ROUND" && (a.args.length < 1 || a.args.length > 2)) errors.push("ROUND needs 1 or 2 arguments");
      if (a.name === "ABS" && a.args.length !== 1) errors.push("ABS needs exactly 1 argument");
      if (AGG_FNS.has(a.name) && a.args.length === 0) errors.push(`${a.name} needs at least one argument`);
      a.args.forEach(arity);
    } else if (a.t === "neg") arity(a.a);
    else if (a.t === "bin") {
      arity(a.a);
      arity(a.b);
    } else if (a.t === "children") errors.push("CHILDREN only works inside SUM, AVG, MIN or MAX");
  };
  // CHILDREN is fine as an aggregate's direct argument — walk accordingly
  const arityTop = (a: Ast) => {
    if (a.t === "fn" && AGG_FNS.has(a.name)) {
      if (a.args.length === 0) errors.push(`${a.name} needs at least one argument`);
      for (const x of a.args) if (x.t !== "children") arity(x);
      return;
    }
    arity(a);
  };
  const walkTop = (a: Ast) => {
    if (a.t === "fn" && AGG_FNS.has(a.name)) arityTop(a);
    else if (a.t === "neg") walkTop(a.a);
    else if (a.t === "bin") {
      walkTop(a.a);
      walkTop(a.b);
    } else if (a.t === "fn") a.args.forEach(walkTop);
    else if (a.t === "children") errors.push("CHILDREN only works inside SUM, AVG, MIN or MAX");
  };
  walkTop(ast);
  // references must be driver children of this node
  const used = refsOf(ast, kidIds);
  for (const id of used) {
    const n = by.get(id);
    if (!n) errors.push("A referenced driver no longer exists — remove the chip");
    else if (n.kind === "leading") errors.push(`'${n.name}' is a leading indicator — it can't be part of a formula`);
    else if (n.parentId !== node.id) errors.push(`'${n.name}' is not a child of this node — add it or remove the reference`);
  }
  // divide by a driver that can be zero
  const divs = (a: Ast) => {
    if (a.t === "bin") {
      if (a.op === "/" && a.b.t === "ref") {
        const n = by.get(a.b.id);
        warnings.push(`Divides by '${n?.name ?? "a driver"}' — result shows "—" when it is zero`);
      }
      divs(a.a);
      divs(a.b);
    } else if (a.t === "neg") divs(a.a);
    else if (a.t === "fn") a.args.forEach(divs);
  };
  divs(ast);
  // cadence: a node can't be finer than any driver it computes from
  for (const id of used) {
    const n = by.get(id);
    if (n && n.kind === "driver" && CADENCE_RANK[n.cadence] > CADENCE_RANK[node.cadence]) {
      errors.push(`'${n.name}' is ${n.cadence} — this ${node.cadence} node can't be computed from it`);
    }
  }
  // units
  const unit = unitOf(ast, (id) => by.get(id)?.unit ?? "", kidIds, (m) => warnings.push(m));
  if (unit !== "" && unit !== "?" && node.unit.trim() !== "" && unit !== node.unit.trim()) {
    warnings.push(`${unit} from the formula — this node says ${node.unit.trim()}`);
  }
  const unused = kidIds.filter((id) => !used.includes(id));
  return { ok: errors.length === 0, errors, warnings, used, unused, unit };
}

// ---- tree compute -------------------------------------------------------------------

/** Every node's value for a period × series: leaves from stored values,
 *  computed nodes through their formulas (leading nodes never feed a
 *  parent). Overrides let the simulation inject leaf deltas. */
export function computeTree(
  nodes: DriverNode[],
  period: string,
  series: Series,
  overrides: Map<string, number | null> = new Map()
): Map<string, number | null> {
  const by = new Map(nodes.map((n) => [n.id, n]));
  const memo = new Map<string, number | null>();
  const visiting = new Set<string>();
  const valueFor = (id: string): number | null => {
    if (memo.has(id)) return memo.get(id) as number | null;
    if (visiting.has(id)) return null; // a cycle — refuse rather than loop
    const n = by.get(id);
    if (!n) return null;
    visiting.add(id);
    let v: number | null;
    if (overrides.has(id)) v = overrides.get(id) as number | null;
    else if (n.kind === "leading" || n.formula.trim() === "") v = valueOf(n, period, series);
    else {
      const kids = formulaChildren(nodes, n.id).map((k) => k.id);
      try {
        v = evaluate(parseFormula(n.formula), { ref: valueFor, children: kids });
      } catch {
        v = null;
      }
    }
    visiting.delete(id);
    memo.set(id, v);
    return v;
  };
  for (const n of nodes) valueFor(n.id);
  return memo;
}

/** "volume × unit margin" — the formula with chips read as names. */
export function formulaInWords(src: string, nodes: DriverNode[]): string {
  const by = new Map(nodes.map((n) => [n.id, n.name]));
  return src
    .replace(/\{([^}]+)\}/g, (_, id: string) => by.get(id.trim()) ?? "?")
    .replace(/\*/g, "×")
    .replace(/\//g, "÷")
    .replace(/\s+/g, " ")
    .trim();
}

/** The path from a leaf up to the root, names first-to-last. */
export function pathToRoot(nodes: DriverNode[], id: string): DriverNode[] {
  const by = new Map(nodes.map((n) => [n.id, n]));
  const out: DriverNode[] = [];
  let cur = by.get(id);
  let guard = 0;
  while (cur && guard++ < 64) {
    out.push(cur);
    cur = cur.parentId !== "" ? by.get(cur.parentId) : undefined;
  }
  return out;
}
