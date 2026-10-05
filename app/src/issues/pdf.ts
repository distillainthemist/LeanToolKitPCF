// A small PDF writer for the issues export (2026-10-06): Helvetica /
// Helvetica-Bold / Courier text in WinAnsi and JPEG images, flowed onto
// A4 pages from a list of blocks. No dependency — the player's bundle
// stays lean, the PDF stays plain (text is extractable: it is written as
// text, never rasterised). Pure: no DOM, tested in vitest.

export interface PdfImage {
  /** JPEG bytes (the exporter re-encodes whatever the attachment was). */
  jpeg: Uint8Array;
  width: number;
  height: number;
  caption?: string;
}

export type Block =
  | { kind: "title" | "h1" | "h2" | "p" | "meta" | "mono"; text: string }
  | { kind: "kv"; key: string; value: string; mono?: boolean }
  | { kind: "image"; image: PdfImage }
  | { kind: "rule" }
  | { kind: "gap"; pt: number }
  | { kind: "pagebreak" };

export interface PdfDocument {
  title: string;
  author?: string;
  /** Footer left of the page counter on every page. */
  footer?: string;
  blocks: Block[];
}

// ---- metrics ----------------------------------------------------------------

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const MAX_IMAGE_H = 460;

/** Helvetica glyph widths (AFM, /1000 em) for WinAnsi 32–126; the upper
 *  half is approximated — wrapping is conservative by a few percent. */
const HELV: number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const HELV_HIGH: Record<number, number> = { 0x80: 556, 0x85: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x95: 350, 0x96: 556, 0x97: 1000, 0x99: 1000, 0xa0: 278, 0xb7: 278 };

type Font = "F1" | "F2" | "F3";

function glyphWidth(code: number, font: Font): number {
  if (font === "F3") return 600;
  let w: number;
  if (code >= 32 && code <= 126) w = HELV[code - 32];
  else w = HELV_HIGH[code] ?? 556;
  return font === "F2" ? w * 1.07 : w;
}

/** Text → WinAnsi bytes. Latin-1 maps straight across; the common
 *  typographic marks map to their WinAnsi slots; everything else becomes
 *  a readable stand-in rather than a box. */
const MARKS: Record<string, number> = { "€": 0x80, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "™": 0x99, " ": 0xa0 };
const STAND_INS: Record<string, string> = { "→": "->", "←": "<-", "↑": "^", "↓": "v", "✓": "[ok]", "✕": "[x]", "⚐": "[flag]", "⚑": "[flag]", "★": "*", "☆": "*", "▲": "^", "▼": "v", "◐": "(half)", "⏸": "||", "⌂": "home", "⚙": "settings", "＋": "+", "×": "x", "\t": "    " };
export function winAnsiBytes(text: string): number[] {
  const out: number[] = [];
  const push = (s: string) => {
    for (const ch of s) out.push(ch.charCodeAt(0));
  };
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63;
    if (code === 10 || code === 13) continue;
    if (code < 32) {
      if (STAND_INS[ch]) push(STAND_INS[ch]);
      continue;
    }
    if (code < 127) out.push(code);
    else if (MARKS[ch] !== undefined) out.push(MARKS[ch]);
    else if (STAND_INS[ch] !== undefined) push(STAND_INS[ch]);
    else if (code >= 0xa0 && code <= 0xff) out.push(code);
    else if (code >= 0x1f000 || (code >= 0x2600 && code <= 0x27bf)) out.push(63); // emoji / dingbats
    else out.push(63);
  }
  return out;
}

export function textWidth(bytes: number[], font: Font, size: number): number {
  let w = 0;
  for (const b of bytes) w += glyphWidth(b, font);
  return (w / 1000) * size;
}

/** Wrap text to `maxW` points: by words, and a word longer than a line
 *  (a URL, a user agent) by characters. Returns byte lines. */
export function wrapText(text: string, font: Font, size: number, maxW: number): number[][] {
  const lines: number[][] = [];
  for (const para of text.split(/\r?\n/)) {
    const words = para.split(" ");
    let line: number[] = [];
    const flush = () => {
      lines.push(line);
      line = [];
    };
    for (const word of words) {
      let wb = winAnsiBytes(word);
      if (wb.length === 0) {
        if (line.length > 0) line.push(32);
        continue;
      }
      // a word wider than the line breaks by characters
      while (textWidth(wb, font, size) > maxW) {
        let cut = 1;
        while (cut < wb.length && textWidth(wb.slice(0, cut + 1), font, size) <= maxW) cut++;
        if (line.length > 0) flush();
        lines.push(wb.slice(0, cut));
        wb = wb.slice(cut);
      }
      const candidate = line.length === 0 ? wb : [...line, 32, ...wb];
      if (textWidth(candidate, font, size) <= maxW) line = candidate;
      else {
        flush();
        line = wb;
      }
    }
    lines.push(line);
  }
  return lines;
}

// ---- layout -----------------------------------------------------------------

interface Page {
  ops: string[];
  /** image index → resource name on this page */
  images: Map<number, string>;
}

const STYLE: Record<"title" | "h1" | "h2" | "p" | "meta" | "mono", { font: Font; size: number; grey: number; before: number; after: number }> = {
  title: { font: "F2", size: 20, grey: 0.12, before: 0, after: 10 },
  h1: { font: "F2", size: 14, grey: 0.12, before: 6, after: 6 },
  h2: { font: "F2", size: 11, grey: 0.25, before: 8, after: 3 },
  p: { font: "F1", size: 10, grey: 0.15, before: 0, after: 4 },
  meta: { font: "F1", size: 9, grey: 0.45, before: 0, after: 4 },
  mono: { font: "F3", size: 8.5, grey: 0.3, before: 0, after: 4 },
};

function pdfString(bytes: number[]): string {
  let s = "(";
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += "\\" + String.fromCharCode(b);
    else if (b < 32 || b > 126) s += "\\" + b.toString(8).padStart(3, "0");
    else s += String.fromCharCode(b);
  }
  return s + ")";
}

const n2 = (n: number) => (Math.round(n * 100) / 100).toString();

export function layoutPages(doc: PdfDocument, images: PdfImage[]): Page[] {
  const pages: Page[] = [];
  let page: Page = { ops: [], images: new Map() };
  let y = PAGE_H - MARGIN;
  const newPage = () => {
    pages.push(page);
    page = { ops: [], images: new Map() };
    y = PAGE_H - MARGIN;
  };
  const ensure = (h: number) => {
    if (y - h < MARGIN && y < PAGE_H - MARGIN - 1) newPage();
  };
  const textLine = (bytes: number[], font: Font, size: number, grey: number, x: number, baseline: number) => {
    page.ops.push(`BT /${font} ${n2(size)} Tf ${n2(grey)} g 1 0 0 1 ${n2(x)} ${n2(baseline)} Tm ${pdfString(bytes)} Tj ET`);
  };
  const paragraph = (text: string, font: Font, size: number, grey: number, x = MARGIN, w = CONTENT_W, firstX = x) => {
    const lineH = size * 1.35;
    const lines = wrapText(text, font, size, w - (firstX - x));
    lines.forEach((bytes, i) => {
      ensure(lineH);
      y -= lineH;
      textLine(bytes, font, size, grey, i === 0 ? firstX : x, y + size * 0.3);
    });
  };
  for (const b of doc.blocks) {
    if (b.kind === "pagebreak") {
      if (page.ops.length > 0) newPage();
      continue;
    }
    if (b.kind === "gap") {
      y -= b.pt;
      continue;
    }
    if (b.kind === "rule") {
      ensure(8);
      y -= 4;
      page.ops.push(`0.82 G 0.6 w ${n2(MARGIN)} ${n2(y)} m ${n2(PAGE_W - MARGIN)} ${n2(y)} l S`);
      y -= 4;
      continue;
    }
    if (b.kind === "kv") {
      const st = STYLE.p;
      const keyBytes = winAnsiBytes(b.key + ":");
      const keyW = textWidth(keyBytes, "F2", st.size) + 6;
      const lineH = st.size * 1.35;
      ensure(lineH); // the key and the value's first line share a page
      textLine(keyBytes, "F2", st.size, 0.35, MARGIN, y - lineH + st.size * 0.3);
      paragraph(b.value, b.mono ? "F3" : "F1", b.mono ? 8.5 : st.size, st.grey, MARGIN + keyW, CONTENT_W - keyW, MARGIN + keyW);
      y -= 2;
      continue;
    }
    if (b.kind === "image") {
      const idx = images.indexOf(b.image);
      const img = b.image;
      let drawW = Math.min(CONTENT_W, img.width * 0.75);
      let drawH = (img.height * drawW) / img.width;
      if (drawH > MAX_IMAGE_H) {
        drawH = MAX_IMAGE_H;
        drawW = (img.width * drawH) / img.height;
      }
      const capH = img.caption ? 9 * 1.35 + 2 : 0;
      ensure(drawH + capH + 6);
      y -= drawH + 4;
      let name = page.images.get(idx);
      if (name === undefined) {
        name = `Im${idx + 1}`;
        page.images.set(idx, name);
      }
      page.ops.push(`q ${n2(drawW)} 0 0 ${n2(drawH)} ${n2(MARGIN)} ${n2(y)} cm /${name} Do Q`);
      page.ops.push(`0.82 G 0.5 w ${n2(MARGIN)} ${n2(y)} ${n2(drawW)} ${n2(drawH)} re S`);
      if (img.caption) {
        y -= 9 * 1.35;
        textLine(winAnsiBytes(img.caption), "F1", 9, 0.45, MARGIN, y + 2.7);
      }
      y -= 6;
      continue;
    }
    const st = STYLE[b.kind];
    y -= st.before;
    paragraph(b.text, st.font, st.size, st.grey);
    if (b.kind === "h1") {
      y -= 3;
      page.ops.push(`0.75 G 0.8 w ${n2(MARGIN)} ${n2(y)} m ${n2(PAGE_W - MARGIN)} ${n2(y)} l S`);
    }
    y -= st.after;
  }
  pages.push(page);
  return pages;
}

// ---- assembly ---------------------------------------------------------------

function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Build the PDF bytes. Images referenced by the blocks are collected in
 *  order of first use; each becomes one XObject shared by every page. */
export function buildPdf(doc: PdfDocument): Uint8Array {
  const images: PdfImage[] = [];
  for (const b of doc.blocks) if (b.kind === "image" && !images.includes(b.image)) images.push(b.image);
  const pages = layoutPages(doc, images);
  const footer = doc.footer ?? doc.title;
  for (let i = 0; i < pages.length; i++) {
    const text = winAnsiBytes(`${footer}  ·  page ${i + 1} of ${pages.length}`);
    const w = textWidth(text, "F1", 8);
    pages[i].ops.push(`BT /F1 8 Tf 0.5 g 1 0 0 1 ${n2(PAGE_W - MARGIN - w)} ${n2(MARGIN / 2)} Tm ${pdfString(text)} Tj ET`);
  }

  // object ids: 1 catalog, 2 pages, 3-5 fonts, 6.. images, then content+page pairs
  const imageBase = 6;
  const pageBase = imageBase + images.length;
  const contentId = (i: number) => pageBase + 2 * i;
  const pageId = (i: number) => pageBase + 2 * i + 1;
  const objects: Uint8Array[] = [];
  const obj = (id: number, body: Uint8Array | string) => {
    objects[id] = concat([latin1(`${id} 0 obj\n`), typeof body === "string" ? latin1(body) : body, latin1("\nendobj\n")]);
  };
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  obj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  obj(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");
  images.forEach((img, i) => {
    obj(
      imageBase + i,
      concat([
        latin1(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`),
        img.jpeg,
        latin1("\nendstream"),
      ])
    );
  });
  pages.forEach((p, i) => {
    const content = p.ops.join("\n");
    obj(contentId(i), `<< /Length ${latin1(content).length} >>\nstream\n${content}\nendstream`);
    const xobjects = [...p.images.entries()].map(([idx, name]) => `/${name} ${imageBase + idx} 0 R`).join(" ");
    obj(
      pageId(i),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n2(PAGE_W)} ${n2(PAGE_H)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >>${xobjects !== "" ? ` /XObject << ${xobjects} >>` : ""} >> /Contents ${contentId(i)} 0 R >>`
    );
  });
  const infoId = objects.length;
  obj(infoId, `<< /Title ${pdfString(winAnsiBytes(doc.title))}${doc.author ? ` /Author ${pdfString(winAnsiBytes(doc.author))}` : ""} /Producer (LeanBoard) >>`);
  const count = objects.length; // ids 1..count-1 are live
  const parts: Uint8Array[] = [latin1("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n")];
  const offsets: number[] = [];
  let at = parts[0].length;
  for (let id = 1; id < count; id++) {
    offsets[id] = at;
    parts.push(objects[id]);
    at += objects[id].length;
  }
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id++) xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  parts.push(latin1(`${xref}trailer\n<< /Size ${count} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${at}\n%%EOF\n`));
  return concat(parts);
}
