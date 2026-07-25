// Card settings must survive the trip from CardSettings' stored form into
// the control parsers. List fields are stored as ARRAYS and key-value
// fields as OBJECTS; reading those as plain strings yielded "" and the card
// silently fell back to its defaults (SQDPC status codes/subtitles,
// Winning conditions' conditions, Capture card columns).

import { describe, expect, it } from "vitest";
import { parseDraft, serializeDraft } from "../../../controls/CardSettings/types";
import {
  parseStatusCodes,
  parseSubtitles,
  DEFAULT_CODES,
} from "../../../controls/SqdpcCard/types";
import { parseConditionsInput } from "../../../controls/ConditionsCard/types";
import { parseColumns as parseCaptureColumns } from "../../../controls/CaptureCard/types";

/** The mounters' type-aware read (mirrors cardRegistry's cfgRaw). */
function cfgRaw(config: Record<string, unknown>, key: string): string {
  const v = config[key];
  if (typeof v === "string") return v;
  if (v === undefined || v === null) return "";
  return JSON.stringify(v);
}

/** The old string-only read, kept to prove the difference. */
function cfgStr(config: Record<string, unknown>, key: string): string {
  const v = config[key];
  return typeof v === "string" ? v : "";
}

/** Settings as they come back off a saved board manifest. */
function storedConfig(settings: Record<string, unknown>): Record<string, unknown> {
  const raw = serializeDraft(parseDraft(JSON.stringify(settings)));
  const doc = JSON.parse(raw) as { config?: Record<string, unknown> };
  return doc.config ?? {};
}

describe("SQDPC settings reach the card", () => {
  const config = storedConfig({
    cardType: "SqdpcCard",
    config: {
      dimensions: "S,Q,D",
      subtitles: { S: "Safety", Q: "Quality" },
      statusCodes: [
        { code: "ok", label: "OK", color: "#107c10", icon: "✓" },
        { code: "bad", label: "Bad", color: "#d13438", icon: "✕" },
      ],
    },
  });

  it("status codes are applied, not defaulted", () => {
    const codes = parseStatusCodes(cfgRaw(config, "statusCodes"));
    expect(codes.map((c) => c.code)).toEqual(["ok", "bad"]);
    // the previous read silently produced the built-in defaults
    expect(parseStatusCodes(cfgStr(config, "statusCodes"))).toEqual(DEFAULT_CODES);
  });

  it("subtitles are applied per dimension", () => {
    expect(parseSubtitles(cfgRaw(config, "subtitles"), ["S", "Q", "D"])).toEqual([
      "Safety",
      "Quality",
      "",
    ]);
    expect(parseSubtitles(cfgStr(config, "subtitles"), ["S", "Q", "D"])).toEqual(["", "", ""]);
  });

  it("chip fields (strings) were always fine and still are", () => {
    expect(cfgRaw(config, "dimensions")).toBe("S,Q,D");
  });
});

describe("Winning conditions settings reach the card", () => {
  const config = storedConfig({
    cardType: "ConditionsCard",
    config: {
      conditions: [
        { name: "Staffing", prompt: "enough people?" },
        { name: "Materials", prompt: "" },
      ],
    },
  });

  it("the configured conditions are used", () => {
    expect(parseConditionsInput(cfgRaw(config, "conditions")).map((c) => c.name)).toEqual([
      "Staffing",
      "Materials",
    ]);
    // defaults leaked through before the fix
    expect(parseConditionsInput(cfgStr(config, "conditions")).map((c) => c.name)).not.toEqual([
      "Staffing",
      "Materials",
    ]);
  });
});

describe("Capture card columns reach the card", () => {
  it("configured columns are used", () => {
    const config = storedConfig({
      cardType: "CaptureCard",
      config: {
        columnsJSON: [
          { key: "issue", label: "Issue", type: "text" },
          { key: "owner", label: "Owner", type: "text" },
        ],
      },
    });
    expect(parseCaptureColumns(cfgRaw(config, "columnsJSON")).map((c) => c.key)).toEqual([
      "issue",
      "owner",
    ]);
  });
});

describe("retired theme fields survive the narrowed Appearance section", () => {
  // Phase 2 removed background/foreground/accent/legend/font from the
  // editor UI. Blobs that stored them (PCF era) must round-trip untouched —
  // parsing is lossless and serialization emits whatever was set.
  it("legacy theme keys round-trip verbatim", () => {
    const stored = {
      cardType: "StatusTile",
      theme: {
        titlebar: "#8b1e1e",
        legend: "#18cdf2,#f22626",
        font: "Comic Sans MS",
        background: "#fffbe6",
      },
    };
    const raw = serializeDraft(parseDraft(JSON.stringify(stored)));
    expect(JSON.parse(raw).theme).toEqual(stored.theme);
  });
});
