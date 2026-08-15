// Canvas value DISPLAY painting, shared by the CanvasEditor (which adds
// its tap-set hooks) and the Canvas rollup's portfolio cells (read-only).
// Extracted from the editor in C5 — the rendering is the canvas card's,
// not a variant.

import { el, clear } from "../../shared/ui/dom";
import { textOn } from "../../shared/tokens";
import { initialsFor } from "../../shared/schema/people";
import { renderCaptureCellInto } from "../CaptureCard/fields";
import { CaptureRow } from "../CaptureCard/types";
import { statusLabel } from "./fieldDialog";
import {
  CanvasField,
  CanvasValue,
  CheckItem,
  clampPercent,
  clampRating,
  dateLabel,
  rangeLabel,
  sanitizeRichText,
  vBool,
  vChecklist,
  vNumber,
  vPeople,
  vRange,
  vRows,
  vString,
  vStrings,
} from "./types";

export interface PaintCanvasOpts {
  /** App state palette (status chips). */
  palette: Record<string, string>;
  /** Shown muted when the field is empty ("—" when absent too). */
  hint?: string;
  readOnly: boolean;
  /** Rating stars tap-set (canvas card only; undefined = display-only). */
  onRatingSet?: (n: number | undefined) => void;
  /** Checklist tick toggled — receives the full next item list. */
  onCheckToggle?: (items: CheckItem[]) => void;
  /** A mini-table row clicked (the canvas card opens its row dialog). */
  onMiniRowClick?: (row: CaptureRow) => void;
}

/** Paint a field's display state into `area` (clears it first). */
export function paintCanvasValue(
  area: HTMLElement,
  field: CanvasField,
  value: CanvasValue | undefined,
  opts: PaintCanvasOpts
): void {
  clear(area);
  const hint = opts.hint ?? "";
  const empty = (): void => {
    area.appendChild(el("span", "ltk-cv-empty", hint !== "" ? hint : "—"));
  };

  switch (field.type) {
    case "text":
    case "number":
    case "decimal": {
      const s =
        field.type === "text" ? vString(value) : (vNumber(value)?.toString() ?? "");
      if (s === "") return empty();
      area.appendChild(el("span", undefined, s));
      return;
    }
    case "longtext": {
      const s = vString(value);
      if (s.trim() === "") return empty();
      area.appendChild(el("div", "ltk-cv-pre", s));
      return;
    }
    case "richtext": {
      const html = sanitizeRichText(vString(value));
      if (html.replace(/<[^>]*>/g, "").trim() === "") return empty();
      const rich = el("div", "ltk-cv-rich");
      rich.innerHTML = html; // sanitised on render — never trusted stored
      area.appendChild(rich);
      return;
    }
    case "date": {
      const s = vString(value);
      if (s === "") return empty();
      area.appendChild(el("span", undefined, dateLabel(s)));
      return;
    }
    case "daterange": {
      const s = rangeLabel(vRange(value));
      if (s === "") return empty();
      area.appendChild(el("span", undefined, s));
      return;
    }
    case "percent": {
      const n = vNumber(value);
      if (n === undefined) return empty();
      const bar = el("div", "ltk-cv-bar");
      const track = el("div", "ltk-cv-bar-track");
      const fill = el("div", "ltk-cv-bar-fill");
      fill.style.width = `${clampPercent(n)}%`;
      track.appendChild(fill);
      bar.appendChild(track);
      bar.appendChild(el("span", undefined, `${clampPercent(n)}%`));
      area.appendChild(bar);
      return;
    }
    case "rating": {
      const n = clampRating(vNumber(value) ?? 0);
      if (n === 0 && (opts.readOnly || !opts.onRatingSet)) return empty();
      const stars = el("div", "ltk-cv-stars");
      for (let k = 1; k <= 5; k++) {
        const star = el(
          "span",
          "ltk-cv-star" + (k <= n ? " ltk-cv-star-on" : ""),
          k <= n ? "★" : "☆"
        );
        if (!opts.readOnly && opts.onRatingSet) {
          star.addEventListener("click", (e) => {
            e.stopPropagation();
            // tapping the current rating again clears it
            opts.onRatingSet!(k === n ? undefined : k);
          });
        }
        stars.appendChild(star);
      }
      area.appendChild(stars);
      return;
    }
    case "url": {
      const s = vString(value);
      if (s === "") return empty();
      const row = el("div", "ltk-cv-url");
      const a = el("a", undefined, s) as HTMLAnchorElement;
      if (/^https?:\/\//i.test(s)) {
        a.href = s;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.addEventListener("click", (e) => e.stopPropagation()); // open, don't edit
      }
      row.appendChild(a);
      area.appendChild(row);
      return;
    }
    case "yesno": {
      if (value === undefined) return empty();
      area.appendChild(el("span", "ltk-cv-yes", vBool(value) ? "✓ Yes" : "— No"));
      return;
    }
    case "choice":
    case "multichoice": {
      const picked = vStrings(value);
      if (picked.length === 0) return empty();
      // the capture chip renderer paints icons/labels from the options
      renderCaptureCellInto(
        area,
        {
          key: field.id,
          label: field.label,
          type: "list",
          multi: field.type === "multichoice",
          parent: "",
          options: field.options,
        },
        picked.length === 1 && field.type === "choice" ? picked[0] : picked
      );
      return;
    }
    case "status": {
      const key = vString(value);
      if (key === "") return empty();
      const color = opts.palette[key] ?? "";
      const chip = el("span", "ltk-cv-status", statusLabel(key));
      if (color !== "") {
        chip.style.background = color;
        chip.style.color = textOn(color);
      }
      area.appendChild(chip);
      return;
    }
    case "person":
    case "people": {
      const people = vPeople(value);
      if (people.length === 0) return empty();
      for (const p of people) {
        const chip = el("span", "ltk-cv-person");
        chip.appendChild(el("span", "ltk-cv-person-dot", initialsFor(p.name)));
        chip.appendChild(el("span", undefined, p.name));
        area.appendChild(chip);
      }
      return;
    }
    case "checklist": {
      const items = vChecklist(value);
      if (items.length === 0) return empty();
      const list = el("div", "ltk-cv-check");
      items.forEach((item, i) => {
        const row = el(
          "div",
          "ltk-cv-check-item" + (item.done ? " ltk-cv-check-done" : "")
        );
        row.appendChild(el("span", "ltk-cv-check-box", item.done ? "☑" : "☐"));
        row.appendChild(el("span", "ltk-cv-check-text", item.text));
        if (!opts.readOnly && opts.onCheckToggle) {
          row.addEventListener("click", (e) => {
            e.stopPropagation();
            opts.onCheckToggle!(
              items.map((it, j) => (j === i ? { text: it.text, done: !it.done } : it))
            );
          });
        }
        list.appendChild(row);
      });
      area.appendChild(list);
      return;
    }
    case "minitable": {
      const rows = vRows(value);
      if (rows.length === 0) return empty();
      const wrap = el("div", "ltk-cv-mini");
      const table = el("table", "ltk-cc-table");
      const thead = el("thead");
      const hr = el("tr");
      for (const col of field.columns) hr.appendChild(el("th", undefined, col.label));
      thead.appendChild(hr);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const row of rows) {
        const tr = el("tr", "ltk-cc-row");
        for (const col of field.columns) {
          const td = el("td");
          renderCaptureCellInto(td, col, row.cells[col.key]);
          tr.appendChild(td);
        }
        if (!opts.readOnly && opts.onMiniRowClick) {
          // a row edits itself; the area click (add row) must not also fire
          tr.addEventListener("click", (e) => {
            e.stopPropagation();
            opts.onMiniRowClick!(row);
          });
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      area.appendChild(wrap);
      return;
    }
    case "image": {
      const src = vString(value);
      if (!src.startsWith("data:image/")) return empty();
      const img = el("img", "ltk-cv-img") as HTMLImageElement;
      img.src = src;
      img.alt = field.label;
      area.appendChild(img);
      return;
    }
    default:
      return empty();
  }
}
