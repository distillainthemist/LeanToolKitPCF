// Grid entry for KPI values — the pure column/spec/paste model.
import { describe, expect, it } from "vitest";
import {
  bucketSpan,
  columnsWindow,
  foldValues,
  gridColumns,
  gridCsv,
  parsePasteBlock,
  ragFor,
  resolveGrid,
  specAt,
  splitGridCells,
  specCell,
} from "../improvement/vdt/gridModel";

describe("bucketSpan / gridColumns", () => {
  it("weekly buckets run Monday→Sunday and cover the window with full buckets", () => {
    expect(bucketSpan("2026-09-10", "weekly")).toEqual({ from: "2026-09-07", to: "2026-09-13" });
    const cols = gridColumns("weekly", "2026-09-10", "2026-09-22");
    expect(cols.map((c) => c.label)).toEqual(["Wk 37", "Wk 38", "Wk 39"]);
    expect(cols[0]).toMatchObject({ anchor: "2026-09-07", from: "2026-09-07", to: "2026-09-13", shift: "-", key: "2026-W37" });
    expect(cols[0].dateLabel).toBe("7 Sep 26");
    expect(columnsWindow(cols)).toEqual({ from: "2026-09-07", to: "2026-09-27" });
  });
  it("monthly / annually / daily / shiftly", () => {
    expect(gridColumns("monthly", "2026-07-15", "2026-09-01").map((c) => c.label)).toEqual(["Jul 26", "Aug 26", "Sep 26"]);
    expect(bucketSpan("2026-02-10", "monthly")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(gridColumns("annually", "2025-06-01", "2026-01-01").map((c) => c.anchor)).toEqual(["2025-01-01", "2026-01-01"]);
    expect(gridColumns("daily", "2026-09-07", "2026-09-09").map((c) => c.label)).toEqual(["7 Sep", "8 Sep", "9 Sep"]);
    const sh = gridColumns("shiftly", "2026-09-07", "2026-09-07", ["D", "N"]);
    expect(sh.map((c) => [c.label, c.shift, c.key])).toEqual([
      ["7 Sep · D", "D", "2026-09-07|D"],
      ["7 Sep · N", "N", "2026-09-07|N"],
    ]);
  });
  it("empty for an inverted window", () => {
    expect(gridColumns("weekly", "2026-09-10", "2026-09-01")).toEqual([]);
  });
});

describe("specAt (carry-forward)", () => {
  const pts = [
    { date: "2026-08-03", shift: "-", value: 100 },
    { date: "2026-09-07", shift: "-", value: 120 },
  ];
  it("takes the latest point at or before the anchor", () => {
    expect(specAt(pts, "2026-08-31")).toEqual({ value: 100, date: "2026-08-03" });
    expect(specAt(pts, "2026-09-07")).toEqual({ value: 120, date: "2026-09-07" });
    expect(specAt(pts, "2026-07-01")).toBeNull();
  });
});

describe("resolveGrid", () => {
  const cols = gridColumns("weekly", "2026-09-07", "2026-09-21");
  it("folds actuals, carries spec forward, falls back to the level, marks inherited", () => {
    const cells = resolveGrid(
      cols,
      [
        { key: "actual", date: "2026-09-07", shift: "-", value: 10 },
        { key: "actual", date: "2026-09-15", shift: "-", value: 4 },
        { key: "actual", date: "2026-09-16", shift: "-", value: 6 },
      ],
      { target: [{ date: "2026-09-14", shift: "-", value: 9 }], lsl: [], usl: [{ date: "2026-09-14", shift: "-", value: 12 }] },
      { target: 8, lsl: null, usl: 20 },
      "weekly",
      "sum"
    );
    // wk 37: one point → editable, level target 8 inherited
    expect(cells[0].actual).toMatchObject({ value: 10, count: 1, editable: true, existing: { key: "actual", date: "2026-09-07", shift: "-" } });
    expect(cells[0].target).toEqual({ value: 8, inherited: true });
    expect(cells[0].usl).toEqual({ value: 20, inherited: true });
    expect(cells[0].rag).toBe("amber"); // upper only → lower is better; 10 > 8
    // wk 38: two points folded (sum 10), read-only; spec set on this column
    expect(cells[1].actual).toMatchObject({ value: 10, count: 2, editable: false, existing: null });
    expect(cells[1].target).toEqual({ value: 9, inherited: false });
    expect(cells[1].usl).toEqual({ value: 12, inherited: false });
    // wk 39: nothing → editable empty, spec carried forward
    expect(cells[2].actual).toMatchObject({ value: null, count: 0, editable: true });
    expect(cells[2].target).toEqual({ value: 9, inherited: true });
    expect(cells[2].rag).toBeNull();
  });
  it("rag follows the column's limits", () => {
    expect(ragFor(5, 4, null, 6)).toBe("amber"); // upper only → lower is better; 5 > 4
    expect(ragFor(3, 4, null, 6)).toBe("green");
    expect(ragFor(7, 4, null, 6)).toBe("red");
    expect(ragFor(5, 4, 2, 6)).toBe("green"); // within range
    expect(ragFor(3, 4, 2, null)).toBe("amber"); // lower only → higher is better
    expect(ragFor(4, null, null, null)).toBeNull();
  });
});

describe("foldValues", () => {
  it("folds at the aggregate, ignoring blanks", () => {
    expect(foldValues([1, null, 3], "sum")).toBe(4);
    expect(foldValues([1, null, 3], "avg")).toBe(2);
    expect(foldValues([1, null, 3], "last")).toBe(3);
    expect(foldValues([null], "sum")).toBeNull();
  });
});

describe("parsePasteBlock", () => {
  it("maps labelled rows by label, drops Period/Date, keeps blanks as null", () => {
    const rows = parsePasteBlock("Period\tWk 37\tWk 38\nDate\t7-Sep-26\t14-Sep-26\nTarget\t10\t12\nLower Limit\t\t8\nUpper Limit\t15\t\nActual\t9.5\tabc");
    expect(rows).toEqual([
      { kind: "target", values: [10, 12] },
      { kind: "lsl", values: [null, 8] },
      { kind: "usl", values: [15, null] },
      { kind: "actual", values: [9.5, null] },
    ]);
  });
  it("maps unlabelled rows by position from the pasted row", () => {
    expect(parsePasteBlock("1,2\n3,4", "usl")).toEqual([
      { kind: "usl", values: [1, 2] },
      { kind: "actual", values: [3, 4] },
    ]);
    expect(parsePasteBlock("1\n2\n3\n4\n5")).toHaveLength(4);
  });
  it("strips thousands separators and currency", () => {
    expect(parsePasteBlock("Target\t$1,200\t45%")).toEqual([{ kind: "target", values: [1200, 45] }]);
  });
});

describe("gridCsv / specCell / splitGridCells", () => {
  it("writes the mock's layout", () => {
    const cols = gridColumns("weekly", "2026-09-07", "2026-09-08");
    const cells = resolveGrid(cols, [], { target: [], lsl: [], usl: [] }, { target: 5, lsl: null, usl: null }, "weekly", "sum");
    expect(gridCsv(cells, "%")).toBe("Period,Wk 37\nDate,2026-09-07\nTarget (%),5\nLower limit,\nUpper limit,\nActual,");
    expect(specCell("lsl", cols[0], 3)).toEqual({ key: "spec:lsl", date: "2026-09-07", shift: "-", value: "3" });
    expect(specCell("lsl", cols[0], null).value).toBe("");
  });
  it("splits spec from actuals by key", () => {
    const r = splitGridCells(
      [
        { key: "spec:target", date: "2026-09-07", shift: "-", value: "5" },
        { key: "actual", date: "2026-09-08", shift: "D", value: "2" },
        { key: "k1", date: "2026-09-09", shift: "-", value: "3" },
        { key: "actual", date: "2026-09-10", shift: "-", value: "" },
      ],
      (k) => k === "actual"
    );
    expect(r.spec.target).toEqual([{ date: "2026-09-07", shift: "-", value: 5 }]);
    expect(r.actuals).toEqual([{ key: "actual", date: "2026-09-08", shift: "D", value: 2 }]);
  });
});
