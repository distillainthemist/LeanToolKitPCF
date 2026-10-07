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
/** More columns than this go to a further page (each ~140pt at 8). */
export const MAX_COLUMNS_PER_PAGE = 8;

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

/** Columns in page-sized groups. */
export function columnPages(columns: PosterColumn[], perPage = MAX_COLUMNS_PER_PAGE): PosterColumn[][] {
  if (columns.length === 0) return [[]];
  const out: PosterColumn[][] = [];
  for (let i = 0; i < columns.length; i += perPage) out.push(columns.slice(i, i + perPage));
  return out;
}

// ---- drawing helpers (PDF operators; y is up, origin bottom-left) -----

class Sheet {
  ops: string[] = [];
  rect(x: number, y: number, w: number, h: number, fill: string, stroke?: string): void {
    if (fill !== "") this.ops.push(`${fill} rg ${n2(x)} ${n2(y)} ${n2(w)} ${n2(h)} re f`);
    if (stroke !== undefined) this.ops.push(`${stroke} RG 0.6 w ${n2(x)} ${n2(y)} ${n2(w)} ${n2(h)} re S`);
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
  s.rect(x, top - h, colW, h, WHITE, HAIR);
  s.rect(x, top - h, 4, h, p.color !== "" ? rgb(p.color) : MUTED);
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

/**
 * Lay the poster out: every column group on its own page sequence; a
 * column whose cards overrun the page continues on the next page under
 * repeated heads. Returns the pages' operator lists.
 */
export function layoutPoster(doc: PosterDoc): Page[] {
  const pages: Page[] = [];
  const contentW = A3_W - 2 * MARGIN;
  for (const group of columnPages(doc.columns)) {
    const colW = group.length > 0 ? (contentW - GAP * (group.length - 1)) / group.length : contentW;
    const remaining = group.map((c) => [...c.priorities]);
    let first = true;
    do {
      const s = new Sheet();
      // header: the title carries the org chain (Ben, 2026-10-08); a
      // subtitle is optional and the header shrinks without one
      let y = A3_H - MARGIN;
      s.text(MARGIN, y - 18, winAnsiBytes(doc.title), "F2", 22, INK);
      if (!first) {
        const cont = winAnsiBytes("continued");
        s.text(A3_W - MARGIN - textWidth(cont, "F1", 11), y - 18, cont, "F1", 11, MUTED);
      }
      if (doc.subtitle !== "") {
        s.text(MARGIN, y - 34, winAnsiBytes(doc.subtitle), "F1", 11, MUTED);
        y -= 46;
      } else {
        y -= 32;
      }
      // vision band
      if (doc.vision !== "") {
        const lines = wrapText(doc.vision, "F2", 12, contentW - 24);
        const bandH = lines.length * 15.6 + 16;
        s.rect(MARGIN, y - bandH, contentW, bandH, INK);
        lines.forEach((b, i) => s.text(MARGIN + 12, y - 8 - (i + 1) * 15.6 + 12 * 0.3, b, "F2", 12, WHITE));
        y -= bandH + 10;
      }
      // pillar spans
      if (group.length > 0) {
        for (const sp of pillarSpansOf(group)) {
          const x = MARGIN + sp.from * (colW + GAP);
          const w = sp.count * colW + (sp.count - 1) * GAP;
          const fill = sp.color !== "" ? rgb(sp.color) : rgb("#9a948a");
          s.rect(x, y - 22, w, 22, fill);
          const bytes = winAnsiBytes(sp.name !== "" ? sp.name : "—");
          const tw = textWidth(bytes, "F2", 10);
          s.text(x + Math.max(6, (w - tw) / 2), y - 15, bytes, "F2", 10, WHITE);
        }
        y -= 22 + 4;
        // column heads
        group.forEach((c, i) => {
          const x = MARGIN + i * (colW + GAP);
          const fill = c.color !== "" ? rgb(c.color) : c.pillarColor !== "" ? rgb(c.pillarColor) : rgb("#9a948a");
          s.rect(x, y - 26, colW, 26, fill);
          const lines = wrapText(c.name, "F2", 9.5, colW - 12);
          const b = lines[0] ?? [];
          s.text(x + 6, y - 16.5, b, "F2", 9.5, WHITE);
        });
        y -= 26 + GAP;
      } else {
        s.text(MARGIN, y - 12, winAnsiBytes("No sub-pillars are visible with the current filters."), "F1", 11, MUTED);
      }
      // cards, column by column, as many as fit on this page
      const bottom = MARGIN + 14;
      let anyLeft = false;
      group.forEach((_, i) => {
        const x = MARGIN + i * (colW + GAP);
        let cy = y;
        const queue = remaining[i];
        while (queue.length > 0) {
          const h = cardHeight(queue[0], colW);
          if (cy - h < bottom && cy < y) break; // next page; a card taller than a page still draws
          drawCard(s, queue.shift()!, x, cy, colW);
          cy -= h + 6;
        }
        if (queue.length > 0) anyLeft = true;
      });
      // footer
      s.text(MARGIN, MARGIN / 2, winAnsiBytes(doc.footer), "F1", 8, MUTED);
      pages.push({ ops: s.ops, images: new Map() });
      first = false;
      if (!anyLeft) break;
    } while (true);
  }
  // page numbers
  pages.forEach((p, i) => {
    const bytes = winAnsiBytes(`page ${i + 1} of ${pages.length}`);
    p.ops.push(`BT /F1 8 Tf 0.5 g 1 0 0 1 ${n2(A3_W - MARGIN - textWidth(bytes, "F1", 8))} ${n2(MARGIN / 2)} Tm ${pdfString(bytes)} Tj ET`);
  });
  return pages;
}
