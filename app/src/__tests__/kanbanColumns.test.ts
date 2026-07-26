// ActionBoard kanban columns: the group-by setting must actually reach the
// card (it validated against the wrong list and silently ignored "By issue"),
// and a maker can now name the columns instead of taking whatever the
// actions happen to be tagged with.

import { describe, expect, it } from "vitest";
import { parseKanbanColumns } from "../../../controls/ActionBoard/editor";
import { cardSpec } from "../../../controls/CardSettings/registry";
import { parseDraft, serializeDraft } from "../../../controls/CardSettings/types";

/** The mounter's own read of a config value (mirrors cardRegistry). */
function cfgRaw(config: Record<string, unknown>, key: string): string {
  const v = config[key];
  if (typeof v === "string") return v;
  if (v === undefined || v === null) return "";
  return JSON.stringify(v);
}

/** Settings as they come back off a saved board manifest. */
function storedConfig(settings: Record<string, unknown>): Record<string, unknown> {
  const raw = serializeDraft(parseDraft(JSON.stringify(settings)));
  const doc = JSON.parse(raw) as { config?: Record<string, unknown> };
  return doc.config ?? {};
}

/** The fixed validation from the ActionBoard mounter. */
const groupByOf = (v: string) => (v === "issue" ? "issue" : "status");

describe("kanban group-by reaches the card", () => {
  it("the registry offers exactly what the mounter accepts", () => {
    const spec = cardSpec("ActionBoard")!;
    const offered = spec.config
      .find((f) => f.key === "kanbanGroupBy")!
      .options!.map((o) => o.value);
    expect(offered).toEqual(["status", "issue"]);
    // every offered value must survive the mounter's validation — the bug
    // was that "issue" did not, so the setting did nothing at all
    for (const value of offered) expect(groupByOf(value)).toBe(value);
  });

  it("anything unrecognised still falls back to status", () => {
    expect(groupByOf("")).toBe("status");
    expect(groupByOf("assignee")).toBe("status"); // a value never offered
  });

  it("the chosen grouping survives the settings round-trip", () => {
    const config = storedConfig({
      cardType: "ActionBoard",
      config: { view: "kanban", kanbanGroupBy: "issue" },
    });
    expect(groupByOf(cfgRaw(config, "kanbanGroupBy"))).toBe("issue");
  });
});

describe("parseKanbanColumns", () => {
  it("reads a chip array or comma-separated text", () => {
    expect(parseKanbanColumns('["Safety","Quality"]')).toEqual(["Safety", "Quality"]);
    expect(parseKanbanColumns("Safety, Quality")).toEqual(["Safety", "Quality"]);
  });

  it("keeps the maker's order — the columns are a sequence, not a set", () => {
    expect(parseKanbanColumns("Delivery, Safety, Cost")).toEqual([
      "Delivery",
      "Safety",
      "Cost",
    ]);
  });

  it("drops blanks and collapses duplicates (each column is a drop target)", () => {
    expect(parseKanbanColumns("Safety, , Safety , safety, Quality")).toEqual([
      "Safety",
      "Quality",
    ]);
  });

  it("unset means discover the columns from the actions", () => {
    expect(parseKanbanColumns("")).toEqual([]);
    expect(parseKanbanColumns(undefined)).toEqual([]);
    expect(parseKanbanColumns("[]")).toEqual([]);
  });

  it("reaches the card through the stored settings", () => {
    const config = storedConfig({
      cardType: "ActionBoard",
      config: { kanbanColumns: ["Safety", "Quality", "Delivery"] },
    });
    expect(parseKanbanColumns(cfgRaw(config, "kanbanColumns"))).toEqual([
      "Safety",
      "Quality",
      "Delivery",
    ]);
  });
});
