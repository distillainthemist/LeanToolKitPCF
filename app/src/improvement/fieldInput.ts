// One header field's input on a form (create / edit details), for EVERY
// field kind (2026-09-29): typing kinds are native inputs, rich text is
// the canvas card's editor in place, and the picking kinds show the
// canvas card's own display and open its own dialogs — so a header field
// enters exactly like the charter field bound to it. Values go in and
// out as the row's strings (fieldCodec.ts).

import { el, clear, ensureStylesheet } from "../../../shared/ui/dom";
import { LTK_BASE_CSS } from "../../../shared/ui/baseCss";
import { Person } from "../../../shared/schema/people";
import { CAPTURE_CSS } from "../../../controls/CaptureCard/styles";
import { CANVAS_CSS } from "../../../controls/CanvasCard/styles";
import { paintCanvasValue } from "../../../controls/CanvasCard/display";
import { buildRichTextEditor, canvasFieldDialog } from "../../../controls/CanvasCard/fieldDialog";
import { CanvasValue, vRange } from "../../../controls/CanvasCard/types";
import { canvasFieldFor, decodeFieldValue, encodeFieldValue } from "./fieldCodec";
import type { TemplateField } from "./templateModel";

export interface FieldInputContext {
  /** The roster, for person fields. */
  people: Person[];
  /** The app's state palette, for status fields. */
  palette: Record<string, string>;
}

let dlgHost: HTMLElement | null = null;
/** The pickers' dialogs sit above the form's own modal. */
function dialogHost(): HTMLElement {
  if (dlgHost && dlgHost.isConnected) return dlgHost;
  dlgHost = el("div", "app-dlghost ltk-root app-fi-dlghost");
  document.body.appendChild(dlgHost);
  return dlgHost;
}

function styles(): void {
  ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
  ensureStylesheet("ltk-capture-css", CAPTURE_CSS);
  ensureStylesheet("ltk-canvas-css", CANVAS_CSS);
}

/** The control for one header field. `onChange` receives the string the
 *  row stores ("" = unset). */
export function fieldInput(cf: TemplateField, raw: string, onChange: (raw: string) => void, ctx: FieldInputContext): HTMLElement {
  const put = (v: CanvasValue | undefined) => onChange(encodeFieldValue(cf.kind, v));
  const cur = decodeFieldValue(cf.kind, raw);
  const input = (type: string): HTMLInputElement => {
    const inp = el("input", "app-input") as HTMLInputElement;
    inp.type = type;
    return inp;
  };

  switch (cf.kind) {
    case "longtext": {
      const ta = el("textarea", "app-input") as HTMLTextAreaElement;
      ta.rows = 3;
      ta.value = typeof cur === "string" ? cur : "";
      ta.addEventListener("input", () => put(ta.value));
      return ta;
    }
    case "richtext": {
      styles();
      const ed = buildRichTextEditor(cur);
      const wrap = el("div", "app-fi app-fi-rich ltk-root");
      wrap.append(ed.bar, ed.surface);
      const push = () => put(ed.read());
      ed.surface.addEventListener("input", push);
      wrap.addEventListener("focusout", push);
      return wrap;
    }
    case "integer":
    case "number":
    case "percent": {
      const inp = input("number");
      inp.step = cf.kind === "number" ? "any" : "1";
      if (cf.kind === "percent") {
        inp.min = "0";
        inp.max = "100";
        inp.placeholder = "0–100";
      }
      inp.value = typeof cur === "number" ? String(cur) : "";
      inp.addEventListener("input", () => put(inp.value.trim() === "" ? undefined : Number(inp.value)));
      return inp;
    }
    case "date": {
      const inp = input("date");
      inp.value = typeof cur === "string" ? cur : "";
      inp.addEventListener("input", () => put(inp.value));
      return inp;
    }
    case "daterange": {
      const row = el("div", "app-fi-range");
      const start = input("date");
      const end = input("date");
      const r = vRange(cur);
      start.value = r.start;
      end.value = r.end;
      start.setAttribute("aria-label", `${cf.label} — from`);
      end.setAttribute("aria-label", `${cf.label} — to`);
      const push = () => put({ start: start.value, end: end.value });
      start.addEventListener("input", push);
      end.addEventListener("input", push);
      row.append(start, el("span", "app-fi-to", "to"), end);
      return row;
    }
    case "picklist":
    case "yesno": {
      const sel = el("select", "app-input") as HTMLSelectElement;
      const options: [string, string][] =
        cf.kind === "yesno" ? [["yes", "Yes"], ["no", "No"]] : cf.options.map((o) => [o, o]);
      const now = cf.kind === "yesno" ? (cur === true ? "yes" : cur === false ? "no" : "") : typeof cur === "string" ? cur : "";
      // a value the options no longer offer stays selectable
      if (now !== "" && !options.some(([v]) => v === now)) options.unshift([now, now]);
      for (const [v, l] of [["", cf.required ? "Choose…" : "—"] as [string, string], ...options]) {
        const o = el("option", undefined, l) as HTMLOptionElement;
        o.value = v;
        sel.appendChild(o);
      }
      sel.value = now;
      sel.addEventListener("change", () => (cf.kind === "yesno" ? put(sel.value === "" ? undefined : sel.value === "yes") : put(sel.value)));
      return sel;
    }
    case "multichoice":
    case "status":
    case "person":
    case "people":
    case "rating":
    case "checklist": {
      styles();
      const field = canvasFieldFor(cf);
      let value = cur;
      const box = el("div", "app-fi app-fi-pick ltk-root");
      const area = el("div", "ltk-cv-value");
      box.appendChild(area);
      const set = (next: CanvasValue | undefined) => {
        value = next;
        put(next);
        paint();
      };
      const paint = () => {
        clear(area);
        paintCanvasValue(area, field, value, {
          palette: ctx.palette,
          hint: cf.kind === "rating" ? "" : "Choose…",
          readOnly: false,
          onRatingSet: (n) => set(n),
          onCheckToggle: (items) => set(items),
        });
      };
      paint();
      if (cf.kind !== "rating") {
        box.classList.add("app-fi-tap");
        box.tabIndex = 0;
        box.setAttribute("role", "button");
        box.setAttribute("aria-label", `${cf.label} — choose`);
        const open = () => canvasFieldDialog({ host: dialogHost(), field, value, palette: ctx.palette, people: ctx.people, onSave: set });
        box.addEventListener("click", (e) => {
          // a checklist tick already handled the click
          if ((e.target as HTMLElement).closest(".ltk-cv-check-item")) return;
          open();
        });
        box.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          open();
        });
      }
      return box;
    }
    case "url": {
      const inp = input("url");
      inp.placeholder = "https://…";
      inp.value = typeof cur === "string" ? cur : "";
      inp.addEventListener("input", () => put(inp.value));
      return inp;
    }
    default: {
      const inp = input("text");
      inp.value = typeof cur === "string" ? cur : "";
      inp.addEventListener("input", () => put(inp.value));
      return inp;
    }
  }
}
