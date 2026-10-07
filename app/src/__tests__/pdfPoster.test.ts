// The priorities poster (2026-10-08): pure layout — colours, pillar
// spans, column paging, card measure, page flow — and the writer's
// size-agnostic assembly at A3.

import { describe, expect, it } from "vitest";
import { buildPagesPdf } from "../issues/pdf";
import {
  A3_H,
  A3_W,
  MIN_COLUMN_W,
  PosterColumn,
  PosterPriority,
  cardHeight,
  exportDateLabel,
  layoutPoster,
  pillarSpansOf,
  rgb,
} from "../priorities/pdfPoster";

const prio = (n: number, statement = `Priority ${n}`): PosterPriority => ({
  statement,
  owner: "Jane Smith",
  color: "#1f7a3f",
  tallies: [{ glyph: "✓", count: 2, color: "#1f7a3f" }, { glyph: "!", count: 1, color: "#b45309" }, { glyph: "✕", count: 0, color: "#b3261e" }],
  total: 3,
  objectives: [{ name: "Lost-time injuries", objective: "None for twelve months", plan: "0", actual: "1", color: "#b3261e" }],
  flags: [],
});
const col = (name: string, pillar: string, priorities: PosterPriority[] = []): PosterColumn => ({
  name, color: "", pillarName: pillar, pillarColor: "#2563eb", priorities,
});

describe("exportDateLabel", () => {
  it("is dd-MMM-yyyy", () => {
    expect(exportDateLabel(new Date(2026, 9, 8))).toBe("08-Oct-2026");
    expect(exportDateLabel(new Date(2026, 0, 31))).toBe("31-Jan-2026");
  });
});

describe("rgb", () => {
  it("turns a hex colour into PDF components and falls back to grey", () => {
    expect(rgb("#ff0000")).toBe("1 0 0");
    expect(rgb("#000000")).toBe("0 0 0");
    expect(rgb("teal")).toBe("0.6 0.58 0.54");
  });
});

describe("pillarSpansOf", () => {
  it("merges consecutive columns of one pillar and splits on a change", () => {
    const spans = pillarSpansOf([col("A", "Safety"), col("B", "Safety"), col("C", "Cost"), col("D", "Safety")]);
    expect(spans.map((s) => [s.name, s.from, s.count])).toEqual([["Safety", 0, 2], ["Cost", 2, 1], ["Safety", 3, 1]]);
  });
});

describe("layoutPoster", () => {
  const doc = (columns: PosterColumn[]) => ({ title: "FY27 Cascaded Priorities", subtitle: "Alcoa › Bell Bay", vision: "Safe, reliable, low-cost metal.", columns, footer: "LeanBoard" });
  it("draws one page for a small view with the title, vision, heads and cards at full scale", () => {
    const pages = layoutPoster(doc([col("Casting", "Operations", [prio(1)]), col("Rodding", "Operations", [prio(2), prio(3)])]));
    expect(pages).toHaveLength(1);
    const ops = pages[0].ops.join("\n");
    expect(ops).toContain("(FY27 Cascaded Priorities)");
    expect(ops).toContain("(Safe, reliable, low-cost metal.)");
    expect(ops).toContain("(Casting)");
    expect(ops).toContain("(Priority 3)");
    expect(ops).toContain("(Lost-time injuries: None for twelve months)");
    expect(ops).toContain("q 1 0 0 1 ");
  });
  it("keeps a long column on the one page by scaling the matrix down", () => {
    const many = Array.from({ length: 40 }, (_, i) => prio(i, `A long statement number ${i} with enough words to wrap onto a second line in a narrow column`));
    const pages = layoutPoster(doc([col("Casting", "Operations", many)]));
    expect(pages).toHaveLength(1);
    const ops = pages[0].ops.join("\n");
    const cm = /q (0\.\d+) 0 0 \1 /.exec(ops);
    expect(cm).not.toBeNull();
    expect(Number(cm![1])).toBeLessThan(1);
    const drawn = pages[0].ops.filter((o) => /\(A long statement number \d+/.test(o)).length;
    expect(drawn).toBeGreaterThanOrEqual(40);
  });
  it("keeps many columns on the one page at the minimum column width, scaled", () => {
    const cols = Array.from({ length: 14 }, (_, i) => col(`Column ${i}`, "P", [prio(i)]));
    const pages = layoutPoster(doc(cols));
    expect(pages).toHaveLength(1);
    expect(MIN_COLUMN_W).toBe(150);
    expect(/q (0\.\d+) 0 0 \1 /.test(pages[0].ops.join("\n"))).toBe(true);
  });
  it("wraps a long head and never writes a page count", () => {
    const pages = layoutPoster(doc([col("Continuous improvement - licence to operate and social value", "Strong sustainability & social licence", [prio(1)])]));
    const ops = pages[0].ops.join("\n");
    expect(ops).toContain("(Continuous improvement - licence to");
    expect(ops).not.toContain("page 1 of");
  });
  it("says so when no columns are visible", () => {
    expect(layoutPoster(doc([]))[0].ops.join("\n")).toContain("No sub-pillars are visible");
  });
});

describe("cardHeight", () => {
  it("grows with a wrapping statement", () => {
    const short = cardHeight(prio(1, "Short"), 200);
    const long = cardHeight(prio(1, "A statement long enough to need three or four lines when the column is narrow"), 120);
    expect(long).toBeGreaterThan(short);
  });
});

describe("buildPagesPdf", () => {
  it("assembles an A3 landscape document", () => {
    const bytes = buildPagesPdf(layoutPoster({ title: "T", subtitle: "", vision: "", columns: [], footer: "" }), { title: "T" }, A3_W, A3_H);
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/MediaBox [0 0 1190.55 841.89]");
    expect(text).toContain("%%EOF");
  });
});
