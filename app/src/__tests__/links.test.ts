import { afterEach, describe, expect, it } from "vitest";
import { boardUrl, latestInstanceIso, launchTarget, setAppHost } from "../links";

const NOW = Date.parse("2026-07-23T09:00:00Z");

const HOST = {
  appId: "82469410-d9ad-45cf-bf87-da62f880f4e3",
  environmentId: "5636a57c-b563-ea93-9772-1c883cc88cc0",
  tenantId: "346199b2-daee-4f51-a061-4b547660c94d",
  queryParams: {} as Record<string, string>,
};

afterEach(() => setAppHost(null));

describe("boardUrl", () => {
  it("builds a player URL carrying the ritual as a launch parameter", () => {
    setAppHost(HOST);
    expect(boardUrl("ritual-1")).toBe(
      `https://apps.powerapps.com/play/e/${HOST.environmentId}/app/${HOST.appId}` +
        `?tenantId=${HOST.tenantId}&ritual=ritual-1#/board/ritual-1/latest`
    );
  });
});

describe("launchTarget", () => {
  it("routes to the ritual named by the host's parameters", () => {
    setAppHost({ ...HOST, queryParams: { Ritual: "ritual-2" } });
    expect(launchTarget()).toBe("#/board/ritual-2/latest");
  });

  it("is empty when the app opened plainly", () => {
    setAppHost(HOST);
    expect(launchTarget()).toBe("");
  });
});

describe("latestInstanceIso", () => {
  it("picks the most recent meeting at or before now", () => {
    const iso = latestInstanceIso(
      [
        { when: "2026-07-21T06:00:00Z" },
        { when: "2026-07-23T06:00:00Z" },
        { when: "2026-07-22T06:00:00Z" },
        { when: "2026-07-24T06:00:00Z" },
      ],
      NOW
    );
    expect(iso).toBe("2026-07-23T06:00");
  });

  it("falls forward to the next meeting when none have happened", () => {
    const iso = latestInstanceIso(
      [{ when: "2026-07-30T06:00:00Z" }, { when: "2026-07-25T06:00:00Z" }],
      NOW
    );
    expect(iso).toBe("2026-07-25T06:00");
  });

  it("returns nothing for a ritual with no records", () => {
    expect(latestInstanceIso([], NOW)).toBe("");
  });

  it("ignores unparseable dates", () => {
    const iso = latestInstanceIso(
      [{ when: "not a date" }, { when: "2026-07-20T06:00:00Z" }],
      NOW
    );
    expect(iso).toBe("2026-07-20T06:00");
  });
});
