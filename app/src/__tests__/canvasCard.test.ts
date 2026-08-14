// CanvasCard pure model — config parsing (id stability, clamps), value
// shapes and coercers, the rich-text sanitiser policy, and required
// emptiness (docs/leanboard-canvas-card-plan.md C0).

import { describe, expect, it } from "vitest";
import {
  clampPercent,
  clampRating,
  isEmptyValue,
  missingRequired,
  parseCanvas,
  parseCanvasConfig,
  richTextPlain,
  sanitizeRichText,
  serializeCanvas,
  vChecklist,
  vPeople,
  vRange,
  vRows,
  vStrings,
} from "../../../controls/CanvasCard/types";

describe("parseCanvasConfig", () => {
  it("defaults: 2 columns, empty fields; junk survives as empty", () => {
    expect(parseCanvasConfig("")).toEqual({ cols: 2, fields: [] });
    expect(parseCanvasConfig("not json")).toEqual({ cols: 2, fields: [] });
    expect(parseCanvasConfig("[1,2]").fields).toEqual([]);
  });

  it("clamps cols, spans and heights; unknown types fall back to text", () => {
    const cfg = parseCanvasConfig(
      JSON.stringify({
        cols: 7,
        fields: [
          { id: "a", label: "A", type: "sparkline", w: 9, h: 99 },
          { id: "b", label: "B", type: "longtext" },
        ],
      })
    );
    expect(cfg.cols).toBe(3);
    expect(cfg.fields[0]).toMatchObject({ type: "text", w: 3, h: 8 });
    // block types get taller defaults
    expect(cfg.fields[1].h).toBe(3);
  });

  it("derives missing ids deterministically and dedupes", () => {
    const raw = JSON.stringify({
      cols: 2,
      fields: [
        { label: "Problem statement", type: "longtext" },
        { label: "", type: "text" },
        { id: "problem_statement", label: "Duplicate", type: "text" },
      ],
    });
    const a = parseCanvasConfig(raw);
    const b = parseCanvasConfig(raw);
    expect(a.fields.map((f) => f.id)).toEqual(b.fields.map((f) => f.id));
    expect(a.fields[0].id).toBe("problem_statement");
    expect(a.fields[1].id).toBe("field_2");
    expect(a.fields[2].id).toBe("problem_statement_3");
  });

  it("headings can never be required; minitable gets default columns", () => {
    const cfg = parseCanvasConfig(
      JSON.stringify({
        fields: [
          { id: "h", label: "Team", type: "heading", required: true },
          { id: "m", label: "Milestones", type: "minitable" },
          {
            id: "m2",
            label: "Risks",
            type: "minitable",
            columns: [{ key: "risk", label: "Risk", type: "text" }],
          },
        ],
      })
    );
    expect(cfg.fields[0].required).toBe(false);
    expect(cfg.fields[1].columns.map((c) => c.key)).toEqual(["entry"]);
    expect(cfg.fields[2].columns.map((c) => c.key)).toEqual(["risk"]);
  });
});

describe("canvas values", () => {
  it("keeps legal shapes, drops illegal ones, preserves orphans", () => {
    const raw = JSON.stringify({
      schema: "ltk/canvas@1",
      meta: { title: "", updated: "" },
      data: {
        values: {
          t: "text",
          n: 4.5,
          y: true,
          multi: ["a", "b"],
          who: [{ id: "p1", name: "Ana" }],
          list: [{ text: "step", done: false }],
          rows: [{ id: "r1", rowKey: "", cells: { entry: "x" } }],
          range: { start: "2026-08-01", end: "" },
          orphan_of_deleted_field: "still here",
          bad: { some: "object" },
        },
      },
    });
    const values = parseCanvas(raw).envelope.data.values;
    expect(values.t).toBe("text");
    expect(values.orphan_of_deleted_field).toBe("still here");
    expect(values.bad).toBeUndefined();
    expect(vPeople(values.who)).toEqual([{ id: "p1", name: "Ana" }]);
    expect(vChecklist(values.list)).toEqual([{ text: "step", done: false }]);
    expect(vRows(values.rows)[0].cells.entry).toBe("x");
    expect(vRange(values.range)).toEqual({ start: "2026-08-01", end: "" });
    // round-trip survives
    const again = parseCanvas(serializeCanvas(parseCanvas(raw).envelope));
    expect(again.envelope.data.values.orphan_of_deleted_field).toBe("still here");
  });

  it("coercers are forgiving at the read boundary", () => {
    expect(vStrings("solo")).toEqual(["solo"]);
    expect(vStrings(undefined)).toEqual([]);
    expect(vRange("2026")).toEqual({ start: "", end: "" });
    expect(clampPercent(140)).toBe(100);
    expect(clampPercent(-3)).toBe(0);
    expect(clampRating(9)).toBe(5);
    expect(clampRating(0)).toBe(0);
  });
});

describe("sanitizeRichText", () => {
  it("keeps the allowlist and closes what the input left open", () => {
    expect(sanitizeRichText("<p><b>bold</b> and <i>italic</i></p>")).toBe(
      "<p><b>bold</b> and <i>italic</i></p>"
    );
    expect(sanitizeRichText("<ul><li>one</li><li>two</li></ul>")).toBe(
      "<ul><li>one</li><li>two</li></ul>"
    );
    expect(sanitizeRichText("<b>unclosed")).toBe("<b>unclosed</b>");
    expect(sanitizeRichText("stray</b> close")).toBe("stray close");
  });

  it("strips script/style including their contents", () => {
    expect(sanitizeRichText('a<script>alert("x")</script>b')).toBe("ab");
    expect(sanitizeRichText("a<style>p{color:red}</style>b")).toBe("ab");
  });

  it("rebuilds tags without carried attributes", () => {
    expect(sanitizeRichText('<p onclick="alert(1)" style="x">hi</p>')).toBe("<p>hi</p>");
    expect(sanitizeRichText('<b class="x">y</b>')).toBe("<b>y</b>");
  });

  it("links: https kept with rel/target, javascript: vanishes, text survives", () => {
    expect(sanitizeRichText('<a href="https://ex.com/a?b=1">go</a>')).toBe(
      '<a href="https://ex.com/a?b=1" target="_blank" rel="noopener noreferrer">go</a>'
    );
    expect(sanitizeRichText("<a href='javascript:alert(1)'>go</a>")).toBe("go");
    expect(sanitizeRichText("<a>bare</a>")).toBe("bare");
  });

  it("unknown tags drop but their text survives; entities normalise stably", () => {
    expect(sanitizeRichText('<div><img src="x">text</div>')).toBe("text");
    const once = sanitizeRichText("fish &amp; chips <are> good");
    expect(once).toBe("fish &amp; chips  good");
    expect(sanitizeRichText(once)).toBe(once); // idempotent
  });

  it("caps length and reports plain text", () => {
    expect(sanitizeRichText("x".repeat(30000)).length).toBeLessThanOrEqual(20000 + 20);
    expect(richTextPlain("<p><b>Scope</b>: <i>all lines</i></p>")).toBe("Scope : all lines");
    expect(richTextPlain("<p><br></p>")).toBe("");
  });
});

describe("required", () => {
  const f = (id: string, type: string, required = true) =>
    parseCanvasConfig(JSON.stringify({ fields: [{ id, label: id, type, required }] }))
      .fields[0];

  it("per-type emptiness — false IS a yes/no answer", () => {
    expect(isEmptyValue("yesno", undefined)).toBe(true);
    expect(isEmptyValue("yesno", false)).toBe(false);
    expect(isEmptyValue("rating", 0)).toBe(true);
    expect(isEmptyValue("rating", 3)).toBe(false);
    expect(isEmptyValue("richtext", "<p><br></p>")).toBe(true);
    expect(isEmptyValue("daterange", { start: "", end: "" })).toBe(true);
    expect(isEmptyValue("daterange", { start: "2026-01-01", end: "" })).toBe(false);
    expect(isEmptyValue("text", "  ")).toBe(true);
  });

  it("missingRequired lists unanswered required labels only", () => {
    const fields = [f("sponsor", "person"), f("scope", "longtext"), f("notes", "text", false)];
    expect(missingRequired(fields, { scope: "All packing lines" })).toEqual(["sponsor"]);
    expect(
      missingRequired(fields, {
        scope: "x",
        sponsor: [{ id: "p1", name: "Ana" }],
      })
    ).toEqual([]);
  });
});
