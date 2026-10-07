// The priorities poster (Ben, 2026-10-08): the Priorities tab's current
// view — org, period, filters — as a clean A3 landscape PDF for a wall
// or a deck: title and org chain, the vision band, the pillar spans
// over the sub-pillar columns, one card per priority (statement, owner,
// R/A/G tallies, the starred objectives with plan and actual) — and no
// controls at all. Vector text throughout (print-sharp, extractable).
// Pure: a PosterDoc in, pages of PDF operators out; the screen gathers
// the doc and downloads the bytes.

import { Page, pdfString, textWidth, winAnsiBytes, wrapText } from "../issues/pdf";

export interface PosterObjective {
  name: string;
  objective: string;
  plan: string;
  actual: string;
  /** Hex, "" = no reading. */
  color: string;
}

export interface PosterPriority {
  statement: string;
  owner: string;
  /** The roll-up colour (hex) — the card's left edge. */
  color: string;
  tallies: { glyph: string; count: number; color: string }[];
  total: number;
  objectives: PosterObjective[];
  flags: string[];
}

export interface PosterColumn {
  name: string;
  color: string;
  pillarName: string;
  pillarColor: string;
  priorities: PosterPriority[];
}

export interface PosterDoc {
  title: string;
  subtitle: string;
  vision: string;
  columns: PosterColumn[];
  footer: string;
}

/** A3 landscape in points. */
export const A3_W = 1190.55;
export const A3_H = 841.89;
const MARGIN = 36;
/** A column narrower than this wraps badly; past it the whole matrix
 *  scales down to fit the page instead (Ben, 2026-10-08). */
export const MIN_COLUMN_W = 150;

const n2 = (n: number) => (Math.round(n * 100) / 100).toString();

/** The footer's date, dd-MMM-yyyy (Ben, 2026-10-08): "08-Oct-2026". */
export function exportDateLabel(d: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d.getDate()).padStart(2, "0")}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

/** "#1f7a3f" → "0.12 0.48 0.25"; anything unreadable → a mid grey. */
export function rgb(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "0.6 0.58 0.54";
  const v = parseInt(m[1], 16);
  return [16, 8, 0].map((s) => n2(((v >> s) & 0xff) / 255)).join(" ");
}

/** Consecutive columns of one pillar share a span: [{pillar, from, count}]. */
export function pillarSpansOf(columns: PosterColumn[]): { name: string; color: string; from: number; count: number }[] {
  const out: { name: string; color: string; from: number; count: number }[] = [];
  columns.forEach((c, i) => {
    const last = out[out.length - 1];
    if (last && last.name === c.pillarName && last.color === c.pillarColor && last.from + last.count === i) last.count++;
    else out.push({ name: c.pillarName, color: c.pillarColor, from: i, count: 1 });
  });
  return out;
}

// ---- drawing helpers (PDF operators; y is up, origin bottom-left) -----

class Sheet {
  ops: string[] = [];
  rect(x: number, y: number, w: number, h: number, fill: string, stroke?: string): void {
    if (fill !== "") this.ops.push(`${fill} rg ${n2(x)} ${n2(y)} ${n2(w)} ${n2(h)} re f`);
    if (stroke !== undefined) this.ops.push(`${stroke} RG 0.6 w ${n2(x)} ${n2(y)} ${n2(w)} ${n2(h)} re S`);
  }
  /** A rounded rectangle path (four béziers), left open for f / S / W n. */
  private roundPath(x: number, y: number, w: number, h: number, r: number): string {
    const k = 0.5523 * r;
    const x1 = x + w;
    const y1 = y + h;
    return [
      `${n2(x + r)} ${n2(y)} m`,
      `${n2(x1 - r)} ${n2(y)} l ${n2(x1 - r + k)} ${n2(y)} ${n2(x1)} ${n2(y + r - k)} ${n2(x1)} ${n2(y + r)} c`,
      `${n2(x1)} ${n2(y1 - r)} l ${n2(x1)} ${n2(y1 - r + k)} ${n2(x1 - r + k)} ${n2(y1)} ${n2(x1 - r)} ${n2(y1)} c`,
      `${n2(x + r)} ${n2(y1)} l ${n2(x + r - k)} ${n2(y1)} ${n2(x)} ${n2(y1 - r + k)} ${n2(x)} ${n2(y1 - r)} c`,
      `${n2(x)} ${n2(y + r)} l ${n2(x)} ${n2(y + r - k)} ${n2(x + r - k)} ${n2(y)} ${n2(x + r)} ${n2(y)} c h`,
    ].join(" ");
  }
  roundRect(x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string): void {
    const path = this.roundPath(x, y, w, h, Math.min(r, w / 2, h / 2));
    if (fill !== "") this.ops.push(`${fill} rg ${path} f`);
    if (stroke !== undefined) this.ops.push(`${stroke} RG 0.6 w ${path} S`);
  }
  /** Fill a rect clipped to a rounded rect (a card's left edge). */
  clippedRect(clip: { x: number; y: number; w: number; h: number; r: number }, x: number, y: number, w: number, h: number, fill: string): void {
    this.ops.push(`q ${this.roundPath(clip.x, clip.y, clip.w, clip.h, clip.r)} W n ${fill} rg ${n2(x)} ${n2(y)} ${n2(w)} ${n2(h)} re f Q`);
  }
  /** The screen's small-caps row label: uppercase, letter-spaced, muted. */
  railLabel(x: number, top: number, w: number, text: string): void {
    const lines = wrapText(text.toUpperCase(), "F2", 8.5, w);
    lines.forEach((b, i) => {
      // q … Q: character spacing (Tc) is graphics state and would
      // otherwise persist into every later text object on the page
      this.ops.push(`q BT /F2 8.5 Tf 0.9 Tc ${MUTED} rg 1 0 0 1 ${n2(x)} ${n2(top - (i + 1) * 11.5 + 2.5)} Tm ${pdfString(b)} Tj ET Q`);
    });
  }
  text(x: number, baseline: number, bytes: number[], font: "F1" | "F2", size: number, color: string): void {
    this.ops.push(`BT /${font} ${n2(size)} Tf ${color} rg 1 0 0 1 ${n2(x)} ${n2(baseline)} Tm ${pdfString(bytes)} Tj ET`);
  }
  /** Wrapped lines downward from `top`; returns the height used. */
  paragraph(x: number, top: number, w: number, text: string, font: "F1" | "F2", size: number, color: string, maxLines = 99): number {
    const lineH = size * 1.3;
    let lines = wrapText(text, font, size, w);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      const last = lines[maxLines - 1];
      lines[maxLines - 1] = [...last.slice(0, Math.max(0, last.length - 1)), 0x85];
    }
    lines.forEach((bytes, i) => this.text(x, top - (i + 1) * lineH + size * 0.3, bytes, font, size, color));
    return lines.length * lineH;
  }
  dot(cx: number, cy: number, r: number, fill: string): void {
    // a circle from four béziers
    const k = 0.5523 * r;
    this.ops.push(
      `${fill} rg ${n2(cx + r)} ${n2(cy)} m ${n2(cx + r)} ${n2(cy + k)} ${n2(cx + k)} ${n2(cy + r)} ${n2(cx)} ${n2(cy + r)} c ${n2(cx - k)} ${n2(cy + r)} ${n2(cx - r)} ${n2(cy + k)} ${n2(cx - r)} ${n2(cy)} c ${n2(cx - r)} ${n2(cy - k)} ${n2(cx - k)} ${n2(cy - r)} ${n2(cx)} ${n2(cy - r)} c ${n2(cx + k)} ${n2(cy - r)} ${n2(cx + r)} ${n2(cy - k)} ${n2(cx + r)} ${n2(cy)} c f`
    );
  }
}

const INK = rgb("#26241f");
const MUTED = rgb("#6d675c");
const HAIR = rgb("#e4dfd6");
const WHITE = "1 1 1";
const CARD_PAD = 8;
const GAP = 8;
const CARD_R = 6;
/** The screen's 126px label rail — VISION · STRATEGIC PILLARS · PRIORITIES. */
const RAIL_W = 84;

/** Measure a card at a column width: the height the drawing needs. */
export function cardHeight(p: PosterPriority, colW: number): number {
  const innerW = colW - 2 * CARD_PAD - 4;
  const statement = wrapText(p.statement, "F2", 10, innerW).length * 13;
  const owner = 11;
  const tallies = 12;
  const flags = p.flags.length > 0 ? 10 : 0;
  const objectives = p.objectives.length === 0 ? 10 : p.objectives.reduce((h, o) => h + Math.min(2, wrapText(`${o.name}${o.objective ? `: ${o.objective}` : ""}`, "F1", 7.5, innerW - 12).length) * 9.5 + 9, 0);
  return CARD_PAD + statement + 3 + owner + 2 + tallies + flags + 4 + objectives + CARD_PAD;
}

/** Draw one card with its top-left at (x, top); returns its height. */
function drawCard(s: Sheet, p: PosterPriority, x: number, top: number, colW: number): number {
  const h = cardHeight(p, colW);
  s.roundRect(x, top - h, colW, h, CARD_R, WHITE, HAIR);
  s.clippedRect({ x, y: top - h, w: colW, h, r: CARD_R }, x, top - h, 4, h, p.color !== "" ? rgb(p.color) : MUTED);
  const innerX = x + 4 + CARD_PAD;
  const innerW = colW - 2 * CARD_PAD - 4;
  let y = top - CARD_PAD;
  y -= s.paragraph(innerX, y, innerW, p.statement, "F2", 10, INK);
  y -= 3;
  s.text(innerX, y - 8, winAnsiBytes(p.owner !== "" ? p.owner : "No owner"), "F1", 8.5, p.owner !== "" ? INK : MUTED);
  y -= 11 + 2;
  // tallies: a coloured dot and a count each (the screen's ✓ ! ✕ glyphs
  // are not in WinAnsi — the colour carries the state, as the chips do)
  let tx = innerX;
  for (const t of p.tallies) {
    const on = t.count > 0;
    s.dot(tx + 3.5, y - 5.5, 3.2, on ? rgb(t.color) : rgb("#d9d3c8"));
    const bytes = winAnsiBytes(String(t.count));
    s.text(tx + 10, y - 8, bytes, "F2", 9, on ? rgb(t.color) : MUTED);
    tx += 10 + textWidth(bytes, "F2", 9) + 12;
  }
  s.text(tx, y - 8, winAnsiBytes(`${p.total} initiative${p.total === 1 ? "" : "s"}`), "F1", 8, MUTED);
  y -= 12;
  if (p.flags.length > 0) {
    s.text(innerX, y - 7, winAnsiBytes(p.flags.join(" · ")), "F1", 7.5, rgb("#b45309"));
    y -= 10;
  }
  y -= 4;
  // objectives: a light, name: objective, plan · actual
  s.ops.push(`${HAIR} RG 0.5 w ${n2(innerX)} ${n2(y)} m ${n2(innerX + innerW)} ${n2(y)} l S`);
  y -= 3;
  if (p.objectives.length === 0) {
    s.text(innerX, y - 7, winAnsiBytes("No objective metric yet"), "F1", 7.5, MUTED);
    y -= 10;
  }
  for (const o of p.objectives) {
    s.dot(innerX + 3.5, y - 5.5, 3, o.color !== "" ? rgb(o.color) : rgb("#d9d3c8"));
    const used = s.paragraph(innerX + 12, y, innerW - 12, `${o.name}${o.objective ? `: ${o.objective}` : ""}`, "F1", 7.5, INK, 2);
    y -= used;
    s.text(innerX + 12, y - 7, winAnsiBytes(`Plan ${o.plan}   Actual ${o.actual}`), "F1", 7.5, MUTED);
    y -= 9;
  }
  return h;
}

/** Wrapped lines of a head at a width; the row takes the tallest. */
function headLines(text: string, size: number, w: number): number[][] {
  const lines = wrapText(text, "F2", size, w);
  return lines.length > 0 ? lines : [[]];
}

/**
 * Lay the poster out on ONE page: the matrix is drawn at a natural size
 * (columns at least MIN_COLUMN_W wide, heads wrapping and their rows
 * growing to the tallest) and then scaled, proportionally, to fit under
 * the title and above the footer — never cut, never paginated (Ben,
 * 2026-10-08). The title and footer stay at full size.
 */
export function layoutPoster(doc: PosterDoc): Page[] {
  const s = new Sheet();
  // header
  let y = A3_H - MARGIN;
  s.text(MARGIN, y - 18, winAnsiBytes(doc.title), "F2", 22, INK);
  const headerBottom = y - 32;
  const footerTop = MARGIN + 14;
  const availW = A3_W - 2 * MARGIN;
  const availH = headerBottom - footerTop;

  // ---- the matrix at natural size, in a coordinate frame whose top is
  // y = 0 and which runs downward (negative); scaled into place below
  const n = doc.columns.length;
  const matrixW = availW - RAIL_W - GAP;
  const colW = n > 0 ? Math.max(MIN_COLUMN_W, (matrixW - GAP * (n - 1)) / n) : matrixW;
  const naturalW = RAIL_W + GAP + (n > 0 ? n * colW + (n - 1) * GAP : matrixW);
  const contentX = RAIL_W + GAP;
  const contentW = naturalW - contentX;
  const m = new Sheet();
  let my = 0;
  if (doc.vision !== "") {
    const lines = wrapText(doc.vision, "F2", 12, contentW - 24);
    const bandH = lines.length * 15.6 + 16;
    m.railLabel(0, my - 4, RAIL_W, "Vision");
    m.roundRect(contentX, my - bandH, contentW, bandH, CARD_R, INK);
    lines.forEach((b, i) => m.text(contentX + 12, my - 8 - (i + 1) * 15.6 + 12 * 0.3, b, "F2", 12, WHITE));
    my -= bandH + 10;
  }
  if (n > 0) {
    m.railLabel(0, my - 4, RAIL_W, "Strategic pillars");
    // pillar spans: wrapped names, the row as tall as the tallest
    const spans = pillarSpansOf(doc.columns).map((sp) => ({
      ...sp,
      x: contentX + sp.from * (colW + GAP),
      w: sp.count * colW + (sp.count - 1) * GAP,
      lines: headLines(sp.name !== "" ? sp.name : "—", 10, sp.count * colW + (sp.count - 1) * GAP - 12),
    }));
    const spanH = Math.max(...spans.map((sp) => sp.lines.length)) * 12.5 + 9;
    for (const sp of spans) {
      m.roundRect(sp.x, my - spanH, sp.w, spanH, 5, sp.color !== "" ? rgb(sp.color) : rgb("#9a948a"));
      const top = my - (spanH - sp.lines.length * 12.5) / 2;
      sp.lines.forEach((b, i) => {
        const tw = textWidth(b, "F2", 10);
        m.text(sp.x + Math.max(6, (sp.w - tw) / 2), top - (i + 1) * 12.5 + 3, b, "F2", 10, WHITE);
      });
    }
    my -= spanH + 4;
    // column heads: wrapped, one row height
    const heads = doc.columns.map((c, i) => ({
      x: contentX + i * (colW + GAP),
      fill: c.color !== "" ? rgb(c.color) : c.pillarColor !== "" ? rgb(c.pillarColor) : rgb("#9a948a"),
      lines: headLines(c.name, 9.5, colW - 12),
    }));
    const headH = Math.max(...heads.map((h) => h.lines.length)) * 12 + 11;
    for (const h of heads) {
      m.roundRect(h.x, my - headH, colW, headH, 5, h.fill);
      const top = my - (headH - h.lines.length * 12) / 2;
      h.lines.forEach((b, i) => m.text(h.x + 6, top - (i + 1) * 12 + 3, b, "F2", 9.5, WHITE));
    }
    my -= headH + GAP;
    m.railLabel(0, my - 2, RAIL_W, "Priorities");
    // cards, every column from the same top; the matrix is as tall as the
    // tallest column
    let lowest = my;
    doc.columns.forEach((c, i) => {
      const x = contentX + i * (colW + GAP);
      let cy = my;
      for (const p of c.priorities) {
        const h = drawCard(m, p, x, cy, colW);
        cy -= h + 6;
      }
      if (cy < lowest) lowest = cy;
    });
    my = lowest;
  } else {
    m.text(contentX, my - 12, winAnsiBytes("No sub-pillars are visible with the current filters."), "F1", 11, MUTED);
    my -= 20;
  }
  const naturalH = -my;

  // ---- fit: proportional, never enlarged
  const scale = Math.min(1, availW / naturalW, availH / Math.max(1, naturalH));
  s.ops.push(`q ${n2(scale)} 0 0 ${n2(scale)} ${n2(MARGIN)} ${n2(headerBottom)} cm`);
  s.ops.push(...m.ops);
  s.ops.push("Q");

  // footer: the export date alone
  s.text(MARGIN, MARGIN / 2, winAnsiBytes(doc.footer), "F1", 8, MUTED);
  return [{ ops: s.ops, images: new Map() }];
}
