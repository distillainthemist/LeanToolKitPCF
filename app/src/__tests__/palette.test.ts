// The site state palette (card-settings plan, phase 3): parsing is
// defensive, resolution accepts keys / legacy hex / empty, and the
// StatusTile + SQDPC config shapes all reach their controls.

import { describe, expect, it } from "vitest";
import {
  defaultPalette,
  defaultTitlePalette,
  mintPaletteKey,
  paletteMap,
  parsePalette,
  resolvePaletteColor,
  serializePalette,
  titleStripColor,
} from "../../../shared/palette";
import { parseStateEntries, parseStates } from "../../../controls/StatusTile/types";

describe("parsePalette", () => {
  it("empty or garbage input yields the defaults", () => {
    expect(parsePalette("")).toEqual(defaultPalette());
    expect(parsePalette("not json")).toEqual(defaultPalette());
    expect(parsePalette("{}")).toEqual(defaultPalette());
    expect(parsePalette("[]")).toEqual(defaultPalette());
  });

  it("keeps stored entries, drops broken ones and duplicate keys", () => {
    const raw = JSON.stringify([
      { key: "good", label: "Great", color: "#0b6a0b" },
      { key: "good", label: "Dup", color: "#000000" },
      { key: "", label: "No key", color: "#111111" },
      { key: "nocolor", label: "x" },
      { key: "brand", color: "#8b1e1e" }, // label falls back to the key
    ]);
    expect(parsePalette(raw)).toEqual([
      { key: "good", label: "Great", color: "#0b6a0b" },
      { key: "brand", label: "brand", color: "#8b1e1e" },
    ]);
  });

  it("round-trips through serialize", () => {
    const entries = parsePalette("");
    expect(parsePalette(serializePalette(entries))).toEqual(entries);
  });
});

describe("resolvePaletteColor", () => {
  const pal = paletteMap(parsePalette(""));

  it("resolves palette keys", () => {
    expect(resolvePaletteColor(pal, "good", "#fff")).toBe("#107c10");
  });

  it("passes legacy freeform colours through", () => {
    expect(resolvePaletteColor(pal, "#18cdf2", "#fff")).toBe("#18cdf2");
    expect(resolvePaletteColor(pal, "orange", "#fff")).toBe("orange");
  });

  it("prefers a site key over a same-named CSS colour", () => {
    expect(resolvePaletteColor({ green: "#0b6a0b" }, "green", "#fff")).toBe("#0b6a0b");
  });

  it("falls back for empty and for deleted keys", () => {
    expect(resolvePaletteColor(pal, "", "#fb1")).toBe("#fb1");
    expect(resolvePaletteColor(pal, "retiredkey", "#fb1")).toBe("#fb1");
  });
});

describe("mintPaletteKey", () => {
  it("slugs and dodges collisions", () => {
    expect(mintPaletteKey("At Risk!", new Set())).toBe("atrisk");
    expect(mintPaletteKey("At Risk!", new Set(["atrisk"]))).toBe("atrisk2");
  });
});

describe("StatusTile state entries — every stored shape", () => {
  it("objectList rows carry label + palette selection", () => {
    const raw = JSON.stringify([
      { label: "On track", palette: "good" },
      { label: "Off track", palette: "issue" },
    ]);
    expect(parseStateEntries(raw)).toEqual([
      { label: "On track", palette: "good" },
      { label: "Off track", palette: "issue" },
    ]);
  });

  it("legacy CSV and legacy JSON label arrays still parse", () => {
    expect(parseStates("A, B, C")).toEqual(["A", "B", "C"]);
    expect(parseStates('["A","B"]')).toEqual(["A", "B"]);
    expect(parseStateEntries("A, B")[0]).toEqual({ label: "A", palette: "" });
  });

  it("fewer than two usable states falls back to RAG", () => {
    expect(parseStates('[{"label":"Only"}]')).toEqual([
      "On track",
      "At risk",
      "Off track",
    ]);
  });
});

describe("title-strip palette (phase 7)", () => {
  it("parses with its own defaults, separate from the states", () => {
    const titles = parsePalette("", defaultTitlePalette);
    expect(titles.map((e) => e.key)).toContain("brick");
    expect(titles.map((e) => e.key)).not.toContain("good");
    // stored title palettes parse the same shape
    const stored = serializePalette([{ key: "brand", label: "Brand", color: "#101010" }]);
    expect(parsePalette(stored, defaultTitlePalette)).toEqual([
      { key: "brand", label: "Brand", color: "#101010" },
    ]);
  });

  it("titleStripColor: key resolves, legacy hex passes, empty/deleted = no strip", () => {
    const pal = paletteMap(defaultTitlePalette());
    expect(titleStripColor({ theme: { titlebar: "brick" } }, pal)).toBe("#8b1e1e");
    expect(titleStripColor({ theme: { titlebar: "#123456" } }, pal)).toBe("#123456");
    expect(titleStripColor({}, pal)).toBe("");
    expect(titleStripColor({ theme: { titlebar: "retired" } }, pal)).toBe("");
  });
});
