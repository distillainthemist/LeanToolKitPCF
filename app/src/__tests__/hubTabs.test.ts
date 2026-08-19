import { describe, expect, it } from "vitest";
import { DEFAULT_TAB_ORDER, effectiveTabs, parseHubTabs, serializeHubTabs } from "../../../shared/schema/hubTabs";

describe("hub tabs (per-site enablement)", () => {
  it("default order puts Priorities before Actions and Documents", () => {
    expect(DEFAULT_TAB_ORDER).toEqual(["myday", "calendar", "priorities", "actions", "documents"]);
  });
  it("parses, drops unknown keys, never locks a site out", () => {
    expect(parseHubTabs("")).toBeNull();
    expect(parseHubTabs('["actions","bogus","myday"]')).toEqual(["actions", "myday"]);
    expect(parseHubTabs("[]")).toBeNull();
    expect(parseHubTabs("{oops")).toBeNull();
  });
  it("effective tabs keep the default order; serialize round-trips and blanks 'all'", () => {
    expect(effectiveTabs(["documents", "myday"])).toEqual(["myday", "documents"]);
    expect(effectiveTabs(null)).toEqual(DEFAULT_TAB_ORDER);
    expect(serializeHubTabs(["documents", "myday"])).toBe('["myday","documents"]');
    expect(serializeHubTabs(DEFAULT_TAB_ORDER.slice().reverse())).toBe("");
    expect(serializeHubTabs(null)).toBe("");
  });
});
