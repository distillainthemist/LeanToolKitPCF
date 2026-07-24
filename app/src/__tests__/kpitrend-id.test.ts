import { describe, expect, it } from "vitest";
import {
  parseKpiTrend,
  serializeKpiTrend,
} from "../../../controls/KpiTrendCard/types";

describe("KpiPoint ids (per-point actions)", () => {
  it("generates ids for points that lack them", () => {
    const env = parseKpiTrend(
      JSON.stringify({
        schema: "ltk/kpitrend@1",
        meta: { title: "", updated: "" },
        data: { points: [{ date: "2026-07-01", value: 92 }], target: null },
      })
    ).envelope;
    expect(env.data.points[0].id).toMatch(/\S/);
  });

  it("preserves an existing id across a parse/serialize round-trip", () => {
    const first = parseKpiTrend(
      JSON.stringify({
        schema: "ltk/kpitrend@1",
        meta: { title: "", updated: "" },
        data: { points: [{ id: "k-keep", date: "2026-07-01", value: 92 }] },
      })
    ).envelope;
    expect(first.data.points[0].id).toBe("k-keep");
    const round = parseKpiTrend(serializeKpiTrend(first)).envelope;
    expect(round.data.points[0].id).toBe("k-keep");
  });
});
