// Batched series reads: the union window a single query must cover, and the
// split back into each card's own result. A bug here is not a crash — it is
// one card quietly rendering another card's data, or silently losing rows
// outside its own window, so these cases are worth being fussy about.

import { describe, expect, it } from "vitest";
import { KeyedCell, partitionSeries, unionWindow } from "../seriesMap";

const cell = (cardId: string, date: string, key = "S", value = "g"): KeyedCell => ({
  cardId,
  key,
  date,
  shift: "-",
  value,
});

describe("unionWindow", () => {
  it("is null for an empty batch", () => {
    expect(unionWindow([])).toBeNull();
  });

  it("spans the widest range across requests", () => {
    expect(
      unionWindow([
        { cardId: "a", from: "2026-07-01", to: "2026-07-31" },
        { cardId: "b", from: "2026-05-02", to: "2026-07-10" },
        { cardId: "c", from: "2026-06-01", to: "2026-08-15" },
      ])
    ).toEqual({ from: "2026-05-02", to: "2026-08-15" });
  });

  it("handles a single request unchanged", () => {
    expect(unionWindow([{ cardId: "a", from: "2026-07-01", to: "2026-07-31" }])).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });
});

describe("partitionSeries", () => {
  it("gives each card only its own rows", () => {
    const rows = [cell("a", "2026-07-02"), cell("b", "2026-07-02"), cell("a", "2026-07-03")];
    const [a, b] = partitionSeries(rows, [
      { cardId: "a", from: "2026-07-01", to: "2026-07-31" },
      { cardId: "b", from: "2026-07-01", to: "2026-07-31" },
    ]);
    expect(a.map((c) => c.date)).toEqual(["2026-07-02", "2026-07-03"]);
    expect(b.map((c) => c.date)).toEqual(["2026-07-02"]);
  });

  it("clips to each card's OWN window, not the union that was fetched", () => {
    // the batch fetched May–August because another card needed it; the
    // month card must still only see July
    const rows = [
      cell("month", "2026-06-30"),
      cell("month", "2026-07-01"),
      cell("month", "2026-07-31"),
      cell("month", "2026-08-01"),
    ];
    const [month] = partitionSeries(rows, [
      { cardId: "month", from: "2026-07-01", to: "2026-07-31" },
    ]);
    expect(month.map((c) => c.date)).toEqual(["2026-07-01", "2026-07-31"]);
  });

  it("includes both window boundaries", () => {
    const rows = [cell("a", "2026-07-01"), cell("a", "2026-07-31")];
    const [a] = partitionSeries(rows, [{ cardId: "a", from: "2026-07-01", to: "2026-07-31" }]);
    expect(a).toHaveLength(2);
  });

  it("returns an empty array for a card with no rows, not undefined", () => {
    const [a, b] = partitionSeries([cell("a", "2026-07-02")], [
      { cardId: "a", from: "2026-07-01", to: "2026-07-31" },
      { cardId: "b", from: "2026-07-01", to: "2026-07-31" },
    ]);
    expect(a).toHaveLength(1);
    expect(b).toEqual([]);
  });

  it("preserves one result per request, in order, when a card repeats", () => {
    // the same card can appear twice in a batch with different windows
    const rows = [cell("a", "2026-07-02"), cell("a", "2026-08-02")];
    const out = partitionSeries(rows, [
      { cardId: "a", from: "2026-07-01", to: "2026-07-31" },
      { cardId: "a", from: "2026-08-01", to: "2026-08-31" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].map((c) => c.date)).toEqual(["2026-07-02"]);
    expect(out[1].map((c) => c.date)).toEqual(["2026-08-02"]);
  });

  it("strips the cardId — callers get plain SeriesCells", () => {
    const [a] = partitionSeries([cell("a", "2026-07-02")], [
      { cardId: "a", from: "2026-07-01", to: "2026-07-31" },
    ]);
    expect(a[0]).toEqual({ key: "S", date: "2026-07-02", shift: "-", value: "g" });
    expect("cardId" in a[0]).toBe(false);
  });
});
