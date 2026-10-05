import { describe, expect, it } from "vitest";
import { buildPdf, layoutPages, textWidth, winAnsiBytes, wrapText } from "../issues/pdf";

const ascii = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
};

describe("issues PDF writer", () => {
  it("maps text to WinAnsi with readable stand-ins", () => {
    expect(winAnsiBytes("Ben's café")).toEqual([66, 101, 110, 39, 115, 32, 99, 97, 102, 0xe9]);
    expect(String.fromCharCode(...winAnsiBytes("a → b ✓"))).toBe("a -> b [ok]");
    expect(winAnsiBytes("“x” — y")).toEqual([0x93, 120, 0x94, 32, 0x97, 32, 121]);
    expect(winAnsiBytes("line\nbreak")).toEqual(winAnsiBytes("linebreak"));
  });
  it("wraps by words and breaks a long word by characters", () => {
    const lines = wrapText("the quick brown fox jumps over the lazy dog", "F1", 10, 90);
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) expect(textWidth(l, "F1", 10)).toBeLessThanOrEqual(90);
    const long = wrapText("Mozilla/5.0(Macintosh;IntelMacOSX)AppleWebKit/537.36", "F3", 8.5, 100);
    expect(long.length).toBeGreaterThan(1);
    for (const l of long) expect(textWidth(l, "F3", 8.5)).toBeLessThanOrEqual(100);
    expect(wrapText("a\n\nb", "F1", 10, 500).length).toBe(3);
  });
  it("flows blocks onto pages and breaks where asked", () => {
    const blocks = [
      { kind: "title" as const, text: "Export" },
      ...Array.from({ length: 80 }, (_, i) => ({ kind: "p" as const, text: `Paragraph ${i} with enough words to make a line of text on the page.` })),
      { kind: "pagebreak" as const },
      { kind: "h1" as const, text: "Second" },
    ];
    const pages = layoutPages({ title: "t", blocks }, []);
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(pages[pages.length - 1].ops.some((o) => o.includes("(Second)"))).toBe(true);
  });
  it("builds a well-formed PDF: header, every object offset, images as XObjects, trailer", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    const image = { jpeg, width: 40, height: 20, caption: "shot.png" };
    const bytes = buildPdf({
      title: "LeanBoard issues export",
      blocks: [
        { kind: "title", text: "LeanBoard issues export" },
        { kind: "kv", key: "Issue id", value: "abc-123", mono: true },
        { kind: "image", image },
        { kind: "pagebreak" },
        { kind: "image", image },
      ],
    });
    const text = ascii(bytes);
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.endsWith("%%EOF\n")).toBe(true);
    expect(text).toContain("/Count 2");
    expect(text).toContain("/Filter /DCTDecode /Length 9");
    expect((text.match(/\/Subtype \/Image/g) ?? []).length).toBe(1); // one XObject, two uses
    expect(text).toContain("/Im1 Do");
    expect(text).toContain("(Issue id:)");
    // the xref offsets point at "n 0 obj"
    const start = Number(text.slice(text.lastIndexOf("startxref") + 10).split("\n")[0]);
    expect(text.slice(start, start + 4)).toBe("xref");
    const rows = text.slice(start).split("\n").slice(2);
    const size = Number(/\/Size (\d+)/.exec(text)![1]);
    for (let id = 1; id < size; id++) {
      const off = Number(rows[id].slice(0, 10)); // rows[0] is the free entry
      expect(text.slice(off, off + `${id} 0 obj`.length)).toBe(`${id} 0 obj`);
    }
    expect(text).toContain("page 1 of 2");
  });
});
