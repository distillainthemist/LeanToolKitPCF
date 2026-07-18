// The store's pure logic: manifest parsing, policy plans, the tiles join
// fallback chain, action row mapping round-trips.

import { describe, expect, it } from "vitest";
import {
  actionFromRow,
  actionToRow,
  parseManifest,
  serializeManifest,
  slotPolicy,
} from "../mappers";
import { archiveSlots, seedPlan } from "../policies";
import { joinTiles } from "../tiles";
import type { LtkAction } from "../../../../shared/schema/actions";

const manifestRaw = JSON.stringify({
  grid: "3",
  columnTitles: ["Perform", "Improve", "Act"],
  slots: [
    {
      pos: 1, w: 2, h: 1, nav: 1, cardId: "c-sqdpc", cardType: "SqdpcCard",
      title: "Daily SQDPC", settingsJSON: { board: { policy: "carry" } },
    },
    {
      pos: 3, nav: 2, cardId: "c-kpi", cardType: "KpiTrendCard",
      title: "Line OEE",
      settingsJSON: { theme: { titlebar: "#8b1e1e" }, board: { policy: "shared" } },
    },
    {
      pos: 4, cardId: "c-link", cardType: "FiveWhys", title: "Sister issue",
      settingsJSON: { board: { policy: "link", source: { boardId: "b2", cardId: "x9" } } },
    },
    { pos: 5, cardId: "c-plain", cardType: "Fishbone", title: "Top issue", settingsJSON: {} },
  ],
});

describe("manifest", () => {
  const m = parseManifest(manifestRaw);
  it("parses slots with spans, nav, and settings objects", () => {
    expect(m.slots).toHaveLength(4);
    expect(m.slots[0]).toMatchObject({ pos: 1, w: 2, nav: 1, cardType: "SqdpcCard" });
    expect(m.columnTitles).toEqual(["Perform", "Improve", "Act"]);
  });
  it("round-trips through serialize", () => {
    expect(parseManifest(serializeManifest(m))).toEqual(m);
  });
  it("defaults policy to carry", () => {
    expect(slotPolicy(m.slots[3])).toBe("carry");
    expect(slotPolicy(m.slots[1])).toBe("shared");
  });
});

describe("policies", () => {
  const m = parseManifest(manifestRaw);
  it("plans carry/shared/link correctly", () => {
    expect(seedPlan(m.slots[0])).toMatchObject({ copyFromPrevious: true, ensureLiveRow: false });
    expect(seedPlan(m.slots[1])).toMatchObject({ copyFromPrevious: false, ensureLiveRow: true });
    expect(seedPlan(m.slots[2]).linkSource).toEqual({ boardId: "b2", cardId: "x9" });
  });
  it("archives only shared slots at close", () => {
    expect(archiveSlots(m.slots)).toEqual(["c-kpi"]);
  });
});

describe("tiles join", () => {
  const m = parseManifest(manifestRaw);
  const catalog = { SqdpcCard: "<svg sqdpc/>", KpiTrendCard: "<svg kpi/>", FiveWhys: "<svg 5y/>", Fishbone: "<svg fish/>" };
  it("prefers the instance row, then the shared live row, then catalog", () => {
    const tiles = joinTiles(
      m.slots,
      "inst-1",
      [
        { cardId: "c-sqdpc", instanceId: "inst-1", tileSvg: "<svg mine/>" },
        { cardId: "c-kpi", instanceId: "inst-1", tileSvg: "" }, // archive not stamped yet
        { cardId: "c-kpi", instanceId: "", tileSvg: "<svg live/>" },
      ],
      catalog
    );
    const byId = Object.fromEntries(tiles.map((t) => [t.cardId, t]));
    expect(byId["c-sqdpc"].svg).toBe("<svg mine/>");
    expect(byId["c-kpi"].svg).toBe("<svg live/>"); // live doc during the meeting
    expect(byId["c-plain"].svg).toBe("<svg fish/>"); // catalog default
    expect(byId["c-kpi"].barColor).toBe("#8b1e1e"); // titlebar → tile chip
    expect(byId["c-sqdpc"].w).toBe(2);
  });
});

describe("action row mapping", () => {
  const action: LtkAction = {
    id: "a_1", instanceId: "c-sqdpc", issue: "Fix guard", description: "Refit",
    assignees: [{ whoId: "p1", who: "Sam", done: false }],
    start: "", due: "2026-07-25", status: "in-progress",
    comments: [{ whoId: "p1", when: "2026-07-18", text: "ordered" }],
    escalated: true, context: { source: "fishbone", sourceId: "cause-3" },
  };
  it("round-trips through the Dataverse row shape", () => {
    const row = actionToRow(action, "board-1");
    expect(row.ben_start).toBeUndefined(); // blank date stays blank
    expect(row.ben_boardid).toBe("board-1");
    const back = actionFromRow({
      ben_ltkactionid: "guid", ben_actionid: row.ben_actionid!,
      ben_instanceid: row.ben_instanceid, ben_issue: row.ben_issue,
      ben_description: row.ben_description, ben_assigneesjson: row.ben_assigneesjson,
      ben_start: undefined, ben_due: row.ben_due, ben_status: row.ben_status,
      ben_commentsjson: row.ben_commentsjson, ben_escalated: row.ben_escalated,
      ben_acknowledgedjson: row.ben_acknowledgedjson, ben_source: row.ben_source,
      ben_sourceid: row.ben_sourceid, ben_hint: row.ben_hint,
    } as never);
    expect(back).toMatchObject({
      id: "a_1", instanceId: "c-sqdpc", due: "2026-07-25",
      status: "in-progress", escalated: true,
      context: { source: "fishbone", sourceId: "cause-3" },
    });
    expect(back.assignees).toEqual(action.assignees);
    expect(back.comments).toEqual(action.comments);
  });
});
