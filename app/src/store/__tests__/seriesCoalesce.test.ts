// The batching itself: concurrent listSeries calls for one board must become
// ONE query. The partition logic is covered in seriesBatch.test.ts; this is
// about the coalescing, which is the whole point of the change.
//
// The Dataverse layer and the SDK-bound generated service are mocked, since
// importing them for real drags the Power Apps SDK into node.

import { beforeEach, describe, expect, it, vi } from "vitest";

const allWhere = vi.fn();

vi.mock("../dv", () => ({
  allWhere: (...args: unknown[]) => allWhere(...args),
  eq: (col: string, val: string) => `${col} eq '${val}'`,
  firstWhere: vi.fn(),
}));
vi.mock("../../generated/services/Ben_ltkcardseriesesService", () => ({
  Ben_ltkcardseriesesService: { getAll: vi.fn() },
}));
vi.mock("../../runtime", () => ({ currentViewer: () => ({ objectId: "u1" }) }));

const { listSeries } = await import("../series");

const row = (cardId: string, date: string, value = "g") => ({
  ben_cardid: cardId,
  ben_serieskey: "S",
  ben_date: date,
  ben_shift: "-",
  ben_value: value,
});

describe("listSeries coalescing", () => {
  beforeEach(() => {
    allWhere.mockReset();
  });

  it("merges concurrent reads for one board into a single query", async () => {
    allWhere.mockResolvedValue([row("sqdpc", "2026-07-10"), row("kpi", "2026-05-20")]);

    const [sqdpc, kpi] = await Promise.all([
      listSeries("b1", "sqdpc", "2026-07-01", "2026-07-31"),
      listSeries("b1", "kpi", "2026-05-01", "2026-07-31"),
    ]);

    expect(allWhere).toHaveBeenCalledTimes(1);
    // one query spanning the union, restricted to the cards asked for
    const filter = String(allWhere.mock.calls[0][1]);
    expect(filter).toContain("2026-05-01"); // union start (kpi's)
    expect(filter).toContain("2026-07-31");
    expect(filter).toContain("sqdpc");
    expect(filter).toContain("kpi");
    // and each caller still sees only its own rows, clipped to its window
    expect(sqdpc.map((c) => c.date)).toEqual(["2026-07-10"]);
    expect(kpi.map((c) => c.date)).toEqual(["2026-05-20"]);
  });

  it("does not mix boards into one query", async () => {
    allWhere.mockResolvedValue([]);
    await Promise.all([
      listSeries("b1", "a", "2026-07-01", "2026-07-31"),
      listSeries("b2", "a", "2026-07-01", "2026-07-31"),
    ]);
    expect(allWhere).toHaveBeenCalledTimes(2);
  });

  it("starts a fresh batch after the previous one has flushed", async () => {
    allWhere.mockResolvedValue([]);
    await listSeries("b1", "a", "2026-07-01", "2026-07-31");
    await listSeries("b1", "a", "2026-07-01", "2026-07-31");
    expect(allWhere).toHaveBeenCalledTimes(2);
  });

  it("rejects every caller when the batched query fails", async () => {
    allWhere.mockRejectedValue(new Error("dataverse down"));
    const a = listSeries("b1", "a", "2026-07-01", "2026-07-31");
    const b = listSeries("b1", "b", "2026-07-01", "2026-07-31");
    await expect(a).rejects.toThrow("dataverse down");
    await expect(b).rejects.toThrow("dataverse down");
    expect(allWhere).toHaveBeenCalledTimes(1);
  });
});
