import { describe, expect, it } from "vitest";
import {
  parseEmbedNotes,
  parseHeadings,
  sanitizeRichHtml,
  serializeEmbedNotes,
} from "../../../controls/EmbedCard/types";

describe("parseHeadings", () => {
  it("splits lines, trims, dedupes case-insensitively", () => {
    expect(parseHeadings("Observations\n  Decisions \n\nobservations\nRisks")).toEqual([
      "Observations",
      "Decisions",
      "Risks",
    ]);
  });

  it("is empty for blank config (pane off)", () => {
    expect(parseHeadings("")).toEqual([]);
    expect(parseHeadings("  \n ")).toEqual([]);
  });
});

describe("sanitizeRichHtml", () => {
  it("keeps the toolbar's tags, bare", () => {
    expect(sanitizeRichHtml("<b>bold</b> and <ul><li>item</li></ul>")).toBe(
      "<b>bold</b> and <ul><li>item</li></ul>"
    );
  });

  it("drops attributes and non-whitelisted tags", () => {
    expect(
      sanitizeRichHtml('<div onclick="x()">hi</div><script>evil()</script><img src=x onerror=y>')
    ).toBe("<div>hi</div>evil()");
    expect(sanitizeRichHtml('<a href="javascript:alert(1)">link</a>')).toBe("link");
  });

  it("normalises br and survives malformed tags", () => {
    expect(sanitizeRichHtml("a<br/>b<")).toBe("a<br>b");
  });
});

describe("embed notes envelope", () => {
  it("round-trips notes and sanitizes on parse", () => {
    const env = parseEmbedNotes("").envelope;
    env.data.notes = { Observations: "<b>tight</b>", Decisions: "" };
    env.meta.updated = "2026-07-25T00:00:00.000Z";
    const round = parseEmbedNotes(serializeEmbedNotes(env)).envelope;
    expect(round.data.notes.Observations).toBe("<b>tight</b>");
  });

  it("scrubs stored markup on parse (defence in depth)", () => {
    const raw = JSON.stringify({
      schema: "ltk/embednotes@1",
      meta: { title: "", updated: "" },
      data: { notes: { Observations: '<img src=x onerror=steal()>ok' } },
    });
    expect(parseEmbedNotes(raw).envelope.data.notes.Observations).toBe("ok");
  });
});
