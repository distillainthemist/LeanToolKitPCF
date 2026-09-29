// Header field values ↔ canvas values (2026-09-29): the row stores
// strings; every kind round-trips, and values written before a field
// changed kind still read.
import { describe, expect, it } from "vitest";
import { canvasFieldFor, canvasTypeOf, decodeFieldValue, encodeFieldValue, isFieldEmpty, plainFieldValue } from "../improvement/fieldCodec";
import { FIELD_KINDS, FieldKind, kindHasOptions, parseFields } from "../improvement/templateModel";
import { CANVAS_TYPES, CanvasValue } from "../../../controls/CanvasCard/types";

const round = (kind: FieldKind, v: CanvasValue) => decodeFieldValue(kind, encodeFieldValue(kind, v));

describe("field kinds", () => {
  it("cover every canvas VALUE type — headings, mini-tables and images stay card-only", () => {
    const covered = new Set(FIELD_KINDS.map((k) => canvasTypeOf(k.value)));
    const missing = CANVAS_TYPES.filter((t) => !covered.has(t));
    expect(missing).toEqual(["heading", "minitable", "image"]);
  });
  it("keep the names older fields carry", () => {
    expect(canvasTypeOf("picklist")).toBe("choice");
    expect(canvasTypeOf("number")).toBe("decimal");
    expect(canvasTypeOf("integer")).toBe("number");
  });
  it("parse, and fall back to text for a kind they do not know", () => {
    const fs = parseFields(JSON.stringify([{ key: "a", label: "A", kind: "richtext" }, { key: "b", label: "B", kind: "minitable" }, { key: "c", label: "C", kind: "multichoice", options: ["x", "y"] }]));
    expect(fs.map((f) => f.kind)).toEqual(["richtext", "text", "multichoice"]);
    expect(kindHasOptions("multichoice")).toBe(true);
    expect(kindHasOptions("status")).toBe(false);
  });
  it("hand the canvas its options", () => {
    const f = canvasFieldFor({ key: "k", label: "K", kind: "picklist", options: ["Low", "High"], required: true });
    expect(f.type).toBe("choice");
    expect(f.options.map((o) => o.value)).toEqual(["Low", "High"]);
    expect(f.required).toBe(true);
  });
});

describe("round trips", () => {
  it("text kinds", () => {
    expect(round("text", "  hello ")).toBe("hello");
    expect(round("longtext", "a\nb")).toBe("a\nb");
    expect(round("url", "https://x.test")).toBe("https://x.test");
    expect(round("date", "2026-09-29")).toBe("2026-09-29");
    expect(round("picklist", "High")).toBe("High");
    expect(round("status", "at_risk")).toBe("at_risk");
  });
  it("numbers", () => {
    expect(round("number", 12.5)).toBe(12.5);
    expect(round("integer", 12.6)).toBe(13);
    expect(round("percent", 140)).toBe(100);
    expect(round("rating", 4)).toBe(4);
    expect(encodeFieldValue("number", 0)).toBe("0");
    expect(decodeFieldValue("number", "0")).toBe(0);
  });
  it("yes / no — false IS an answer", () => {
    expect(encodeFieldValue("yesno", false)).toBe("no");
    expect(round("yesno", false)).toBe(false);
    expect(round("yesno", true)).toBe(true);
    expect(isFieldEmpty("yesno", "no")).toBe(false);
    expect(isFieldEmpty("yesno", "")).toBe(true);
  });
  it("structured kinds", () => {
    expect(round("daterange", { start: "2026-01-01", end: "2026-03-31" })).toEqual({ start: "2026-01-01", end: "2026-03-31" });
    expect(round("multichoice", ["a", "b"])).toEqual(["a", "b"]);
    expect(round("people", [{ id: "u1", name: "Jane" }, { id: "u2", name: "Sam" }])).toEqual([{ id: "u1", name: "Jane" }, { id: "u2", name: "Sam" }]);
    expect(round("person", [{ id: "u1", name: "Jane" }, { id: "u2", name: "Sam" }])).toEqual([{ id: "u1", name: "Jane" }]);
    expect(round("checklist", [{ text: "Brief the crew", done: true }])).toEqual([{ text: "Brief the crew", done: true }]);
  });
  it("rich text is sanitised on the way in and out", () => {
    const stored = encodeFieldValue("richtext", '<p>Line <b>one</b></p><script>alert(1)</script>');
    expect(stored).toContain("<b>one</b>");
    expect(stored).not.toContain("script");
    expect(plainFieldValue("richtext", stored)).toContain("Line one");
  });
  it("unset encodes to the empty string", () => {
    expect(encodeFieldValue("text", undefined)).toBe("");
    expect(encodeFieldValue("multichoice", [])).toBe("");
    expect(encodeFieldValue("richtext", "<p> </p>")).toBe("");
    expect(encodeFieldValue("daterange", { start: "", end: "" })).toBe("");
  });
});

describe("values from before a field changed kind", () => {
  it("plain text in a rich text field keeps its words and line breaks", () => {
    const v = decodeFieldValue("richtext", "Scrap is 4% < target\nsecond line") as string;
    expect(v).toContain("&lt; target");
    expect(v).toContain("<br>");
    expect(plainFieldValue("richtext", "Scrap is high")).toBe("Scrap is high");
  });
  it("a typed name in the old person box stays a name", () => {
    expect(decodeFieldValue("person", "Jane Smith")).toEqual([{ id: "", name: "Jane Smith" }]);
    expect(plainFieldValue("person", "Jane Smith")).toBe("Jane Smith");
  });
  it("one choice read as multi choice", () => {
    expect(decodeFieldValue("multichoice", "High")).toEqual(["High"]);
  });
  it("junk in a typed field reads as unset, never throws", () => {
    expect(decodeFieldValue("number", "abc")).toBeUndefined();
    expect(decodeFieldValue("daterange", "{broken")).toBeUndefined();
    expect(decodeFieldValue("yesno", "maybe")).toBeUndefined();
  });
});

describe("plain words", () => {
  it("say each kind as a line of text", () => {
    expect(plainFieldValue("yesno", "yes")).toBe("Yes");
    expect(plainFieldValue("percent", "40")).toBe("40%");
    expect(plainFieldValue("rating", "3")).toBe("3 / 5");
    expect(plainFieldValue("multichoice", '["a","b"]')).toBe("a, b");
    expect(plainFieldValue("people", '[{"id":"u1","name":"Jane"},{"id":"u2","name":"Sam"}]')).toBe("Jane, Sam");
    expect(plainFieldValue("checklist", '[{"text":"a","done":true},{"text":"b","done":false}]')).toBe("1 of 2 done");
    expect(plainFieldValue("status", "at_risk")).toBe("at risk");
    expect(plainFieldValue("text", "")).toBe("");
  });
});
