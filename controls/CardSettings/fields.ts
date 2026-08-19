// CardSettings typed field editors — one small uncontrolled editor per
// FieldKind. Each reads its current value with get(), writes with set()
// (undefined = unset → the sparse serializer omits the key) and then calls
// host.onChanged() to emit. Editors manage their own inner DOM so typing
// never triggers a full form re-render.

import { el } from "../../shared/ui/dom";
import { checkItem } from "../../shared/ui/dialog";
import { PaletteEntry, paletteMap, resolvePaletteColor } from "../../shared/palette";
import { FieldSpec, ObjectField } from "./registry";
import { captureColumnsEditor } from "./captureColumns";
import { canvasFieldsEditor } from "./canvasFields";

export interface FieldHost {
  readOnly: boolean;
  /** The app state palette — feeds paletteColor selects. */
  palette: PaletteEntry[];
  /** The app title-strip palette — feeds titleColor selects. */
  titlePalette: PaletteEntry[];
  onChanged: () => void;
  /** Layout builders (canvasFields): the currently selected field id, and
   *  the way to change it — the selection bridge's inspector side. */
  selectedField?: string | null;
  onSelectField?: (id: string | null) => void;
  /** Rotation-focus builder (PrioritiesCard): the board's rotation topics
   *  and the org's pillars. Absent = the builder falls back to JSON. */
  rotation?: RotationContext;
}

export interface RotationContext {
  topics: { key: string; label: string }[];
  pillars: { id: string; name: string; sub: boolean; parentName: string }[];
}

type Get = () => unknown;
type Set = (v: unknown) => void;

// ---- shared scaffolding ------------------------------------------------------

/**
 * A field's label, with its explanation behind an ⓘ rather than printed
 * underneath. The helps are long and mostly read once, so inline they made
 * the pane three times taller than the controls it holds.
 */
// ---- field explanations ------------------------------------------------------
//
// A real tooltip rather than the browser's `title`: native tooltips wait about
// a second before appearing, which on a 12px target reads as "nothing
// happens". This one shows on hover or focus straight away.
//
// It is positioned FIXED and parented to <body> on purpose — the properties
// pane scrolls, so a tooltip inside it would clip at the pane's edge.

let openTip: HTMLElement | null = null;
let tipListenersBound = false;

function hideTip(): void {
  openTip?.remove();
  openTip = null;
}

function bindTipListeners(): void {
  if (tipListenersBound) return;
  tipListenersBound = true;
  // any scroll moves the anchor out from under the tip; so does a click
  window.addEventListener("scroll", hideTip, true);
  window.addEventListener("pointerdown", hideTip, true);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideTip();
  }, true);
}

export function infoIcon(help: string): HTMLElement {
  bindTipListeners();
  const info = el("span", "ltk-cs-info", "ⓘ");
  info.setAttribute("aria-label", help);
  info.tabIndex = 0;

  const show = () => {
    hideTip();
    const tip = el("div", "ltk-cs-tip", help);
    document.body.appendChild(tip);
    const anchor = info.getBoundingClientRect();
    const { width, height } = tip.getBoundingClientRect();
    // below the icon, flipping above when it would fall off the bottom
    let top = anchor.bottom + 6;
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, anchor.top - height - 6);
    }
    // start at the icon, pulled back inside the viewport when it would spill
    const left = Math.min(Math.max(8, anchor.left - 6), window.innerWidth - width - 8);
    tip.style.top = `${Math.round(top)}px`;
    tip.style.left = `${Math.round(left)}px`;
    openTip = tip;
  };

  info.addEventListener("mouseenter", show);
  info.addEventListener("focus", show);
  info.addEventListener("mouseleave", hideTip);
  info.addEventListener("blur", hideTip);
  return info;
}

export function labelRow(label: string, help?: string): HTMLElement {
  const row = el("label", "ltk-cs-field-label");
  row.appendChild(el("span", "", label));
  if (help) row.appendChild(infoIcon(help));
  return row;
}

function fieldWrap(spec: FieldSpec, control: HTMLElement, wide = false): HTMLElement {
  const field = el("div", "ltk-cs-field" + (wide ? " ltk-cs-field-wide" : ""));
  field.appendChild(labelRow(spec.label, spec.help));
  field.appendChild(control);
  return field;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

/** A list value may arrive as a JSON array or CSV text; normalise to items. */
function asItems(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x ?? "").trim()).filter((x) => x !== "");
  const t = asString(v).trim();
  if (t === "") return [];
  return t.split(",").map((x) => x.trim()).filter((x) => x !== "");
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// ---- simple inputs -----------------------------------------------------------

function textEditor(spec: FieldSpec, get: Get, set: Set, host: FieldHost): HTMLElement {
  const input = el("input", "ltk-input") as HTMLInputElement;
  input.type = spec.kind === "date" ? "date" : spec.kind === "time" ? "time" : "text";
  input.value = asString(get());
  if (spec.placeholder) input.placeholder = spec.placeholder;
  input.disabled = host.readOnly;
  input.addEventListener("input", () => {
    set(input.value === "" ? undefined : input.value);
    host.onChanged();
  });
  return fieldWrap(spec, input);
}

function multilineEditor(spec: FieldSpec, get: Get, set: Set, host: FieldHost): HTMLElement {
  const ta = el("textarea", "ltk-input ltk-textarea") as HTMLTextAreaElement;
  ta.rows = 3;
  ta.value = asString(get());
  if (spec.placeholder) ta.placeholder = spec.placeholder;
  ta.disabled = host.readOnly;
  ta.addEventListener("input", () => {
    set(ta.value === "" ? undefined : ta.value);
    host.onChanged();
  });
  return fieldWrap(spec, ta, true);
}

function numberEditor(spec: FieldSpec, get: Get, set: Set, host: FieldHost): HTMLElement {
  const input = el("input", "ltk-input") as HTMLInputElement;
  input.type = "number";
  const cur = get();
  input.value = typeof cur === "number" && Number.isFinite(cur) ? String(cur) : asString(cur);
  if (spec.placeholder) input.placeholder = spec.placeholder;
  input.disabled = host.readOnly;
  input.addEventListener("input", () => {
    const n = Number(input.value);
    set(input.value.trim() !== "" && Number.isFinite(n) ? n : undefined);
    host.onChanged();
  });
  return fieldWrap(spec, input);
}

function enumEditor(spec: FieldSpec, get: Get, set: Set, host: FieldHost): HTMLElement {
  const sel = el("select", "ltk-input ltk-select") as HTMLSelectElement;
  const current = asString(get());
  const opts = [{ value: "", label: "(not set — card default)" }, ...(spec.options ?? [])];
  for (const o of opts) {
    const opt = el("option", undefined, o.label) as HTMLOptionElement;
    opt.value = o.value;
    if (o.value === current) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.disabled = host.readOnly;
  sel.addEventListener("change", () => {
    set(sel.value === "" ? undefined : sel.value);
    host.onChanged();
  });
  return fieldWrap(spec, sel);
}

function booleanEditor(spec: FieldSpec, get: Get, set: Set, host: FieldHost): HTMLElement {
  const item = checkItem(spec.label);
  item.box.checked = get() === true;
  item.wrap.classList.toggle("ltk-check-on", item.box.checked);
  item.box.disabled = host.readOnly;
  item.box.addEventListener("change", () => {
    // unchecked = unset, so a false boolean is omitted from the sparse blob
    set(item.box.checked ? true : undefined);
    host.onChanged();
  });
  // the checkbox carries its own text, so any heading is a separate line
  const field = el("div", "ltk-cs-field");
  if (spec.heading) field.appendChild(labelRow(spec.heading));
  const row = el("div", "ltk-cs-checkrow");
  row.appendChild(item.wrap);
  if (spec.help) row.appendChild(infoIcon(spec.help));
  field.appendChild(row);
  return field;
}

// ---- chips (string list → CSV) ----------------------------------------------

function chipsEditor(spec: FieldSpec, get: Get, set: Set, host: FieldHost): HTMLElement {
  const items = asItems(get());
  const box = el("div", "ltk-cs-chips");
  const input = el("input", "ltk-cs-chipinput") as HTMLInputElement;
  input.type = "text";
  input.placeholder = spec.placeholder ?? "Add…";
  input.disabled = host.readOnly;

  const push = () => {
    set(items.length > 0 ? items.join(",") : undefined);
    host.onChanged();
  };
  const sync = () => {
    box.querySelectorAll(".ltk-cs-chip").forEach((c) => c.remove());
    items.forEach((item, i) => {
      const chip = el("span", "ltk-cs-chip");
      chip.appendChild(el("span", undefined, item));
      if (!host.readOnly) {
        const x = el("button", "ltk-cs-chip-x", "×");
        x.type = "button";
        x.title = "Remove";
        x.addEventListener("click", () => {
          items.splice(i, 1);
          sync();
          push();
        });
        chip.appendChild(x);
      }
      box.insertBefore(chip, input);
    });
  };
  const addFromInput = () => {
    const parts = input.value.split(",").map((s) => s.trim()).filter((s) => s !== "");
    if (parts.length === 0) return;
    for (const p of parts) if (!items.includes(p)) items.push(p);
    input.value = "";
    sync();
    push();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addFromInput();
    } else if (e.key === "Backspace" && input.value === "" && items.length > 0) {
      items.pop();
      sync();
      push();
    }
  });
  input.addEventListener("blur", addFromInput);

  box.appendChild(input);
  sync();
  return fieldWrap(spec, box, true);
}

// ---- colours -----------------------------------------------------------------

/** One colour: swatch picker + hex/name readout, optionally clearable (×). */
function colorControl(
  initial: string,
  disabled: boolean,
  onSet: (value: string) => void,
  clearable = true
): HTMLElement {
  const wrap = el("span", "ltk-cs-colorwrap");
  const swatch = el("input", "ltk-cs-color") as HTMLInputElement;
  swatch.type = "color";
  swatch.disabled = disabled;
  const readout = el("span", "ltk-cs-colorhex");
  const clear = el("button", "ltk-cs-colorclear", "×") as HTMLButtonElement;
  clear.type = "button";
  clear.title = "Clear (use the card's default)";
  clear.disabled = disabled;

  const paint = (value: string) => {
    const has = value.trim() !== "";
    swatch.value = HEX_RE.test(value) ? value : "#ffffff";
    swatch.classList.toggle("ltk-cs-color-unset", !has);
    readout.textContent = has ? value : "—";
    clear.style.visibility = clearable && has ? "visible" : "hidden";
  };
  swatch.addEventListener("input", () => {
    paint(swatch.value);
    onSet(swatch.value);
  });
  clear.addEventListener("click", () => {
    paint("");
    onSet("");
  });
  paint(initial);

  wrap.append(swatch, readout);
  if (clearable) wrap.appendChild(clear);
  return wrap;
}

/**
 * A state-palette selection: Default (""), one of the palette's named colours,
 * or — when the stored value is neither — that value as a "(custom)"
 * option, so legacy freeform hex keeps rendering honestly. A swatch beside
 * the select shows the resolved colour.
 */
function paletteControl(
  initial: string,
  entries: PaletteEntry[],
  readOnly: boolean,
  onSet: (v: string) => void
): HTMLElement {
  const wrap = el("span", "ltk-cs-palette");
  const sel = el("select", "ltk-input ltk-cs-cell") as HTMLSelectElement;
  const options = [
    { value: "", label: "Default" },
    ...entries.map((p) => ({ value: p.key, label: p.label })),
  ];
  if (initial !== "" && !entries.some((p) => p.key === initial)) {
    options.push({ value: initial, label: `${initial} (custom)` });
  }
  for (const o of options) {
    const opt = el("option", "", o.label) as HTMLOptionElement;
    opt.value = o.value;
    sel.appendChild(opt);
  }
  sel.value = initial;
  sel.disabled = readOnly;
  const swatch = el("span", "ltk-cs-palswatch");
  const paint = () => {
    const color = resolvePaletteColor(paletteMap(entries), sel.value, "");
    swatch.style.background = color === "" ? "transparent" : color;
    swatch.classList.toggle("ltk-cs-palswatch-unset", color === "");
  };
  sel.addEventListener("change", () => {
    paint();
    onSet(sel.value);
  });
  paint();
  wrap.append(sel, swatch);
  return wrap;
}

/** Title-strip selection: the same select, over the TITLE palette. */
function titleColorEditor(spec: FieldSpec, get: Get, set: Set, host: FieldHost): HTMLElement {
  const control = paletteControl(asString(get()), host.titlePalette, host.readOnly, (v) => {
    set(v === "" ? undefined : v);
    host.onChanged();
  });
  return fieldWrap(spec, control);
}

function colorEditor(spec: FieldSpec, get: Get, set: Set, host: FieldHost): HTMLElement {
  const control = colorControl(asString(get()), host.readOnly, (v) => {
    set(v === "" ? undefined : v);
    host.onChanged();
  });
  return fieldWrap(spec, control);
}

function colorListEditor(spec: FieldSpec, get: Get, set: Set, host: FieldHost): HTMLElement {
  const items = asItems(get());
  const box = el("div", "ltk-cs-chips");

  const push = () => {
    set(items.length > 0 ? items.join(",") : undefined);
    host.onChanged();
  };
  const sync = () => {
    while (box.firstChild) box.removeChild(box.firstChild);
    items.forEach((item, i) => {
      const slot = el("span", "ltk-cs-colorslot");
      slot.appendChild(
        // slots are positional: the swatch edits in place, the × beside the
        // slot removes it — so the slot's own clear is disabled
        colorControl(
          item,
          host.readOnly,
          (v) => {
            items[i] = v;
            push();
          },
          false
        )
      );
      if (!host.readOnly) {
        const x = el("button", "ltk-cs-chip-x", "×");
        x.type = "button";
        x.title = "Remove this slot";
        x.addEventListener("click", () => {
          items.splice(i, 1);
          sync();
          push();
        });
        slot.appendChild(x);
      }
      box.appendChild(slot);
    });
    if (!host.readOnly) {
      const add = el("button", "ltk-cs-add", "＋ Colour");
      add.type = "button";
      add.addEventListener("click", () => {
        items.push("#141414");
        sync();
        push();
      });
      box.appendChild(add);
    }
  };
  sync();
  return fieldWrap(spec, box, true);
}

// ---- object list (small table) ----------------------------------------------

function cleanRows(rows: Record<string, string>[], fields: ObjectField[]): Record<string, string>[] {
  return rows
    .map((r) => {
      const out: Record<string, string> = {};
      for (const f of fields) {
        const v = (r[f.key] ?? "").trim();
        if (v !== "") out[f.key] = v;
      }
      return out;
    })
    .filter((r) => Object.keys(r).length > 0);
}

function objectListEditor(spec: FieldSpec, get: Get, set: Set, host: FieldHost): HTMLElement {
  const fields = spec.fields ?? [];
  const cur = get();
  const rows: Record<string, string>[] = Array.isArray(cur)
    ? (cur as unknown[]).filter((r) => r && typeof r === "object").map((r) => {
        const src = r as Record<string, unknown>;
        const out: Record<string, string> = {};
        for (const f of fields) out[f.key] = asString(src[f.key]);
        return out;
      })
    : // a field that BECAME an objectList (StatusTile states) may hold a
      // legacy CSV string — adopt each item into the first column so the
      // stored states appear as rows instead of silently vanishing
      typeof cur === "string" && cur.trim() !== "" && fields.length > 0
      ? cur
          .split(",")
          .map((v) => v.trim())
          .filter((v) => v !== "")
          .map((v) => ({ [fields[0].key]: v }))
      : [];

  const push = () => {
    const cleaned = cleanRows(rows, fields);
    set(cleaned.length > 0 ? cleaned : undefined);
    host.onChanged();
  };

  const table = el("div", "ltk-cs-table");
  const sync = () => {
    while (table.firstChild) table.removeChild(table.firstChild);
    const head = el("div", "ltk-cs-tr ltk-cs-th");
    for (const f of fields) head.appendChild(el("span", "ltk-cs-td", f.label));
    head.appendChild(el("span", "ltk-cs-td ltk-cs-td-x", ""));
    table.appendChild(head);

    rows.forEach((row, i) => {
      const tr = el("div", "ltk-cs-tr");
      for (const f of fields) {
        const td = el("span", "ltk-cs-td");
        if (f.kind === "color") {
          td.appendChild(
            colorControl(row[f.key] ?? "", host.readOnly, (v) => {
              row[f.key] = v;
              push();
            })
          );
        } else if (f.kind === "paletteColor") {
          td.appendChild(
            paletteControl(row[f.key] ?? "", host.palette, host.readOnly, (v) => {
              row[f.key] = v;
              push();
            })
          );
        } else {
          const input = el("input", "ltk-input ltk-cs-cell") as HTMLInputElement;
          input.type = "text";
          input.value = row[f.key] ?? "";
          if (f.placeholder) input.placeholder = f.placeholder;
          input.disabled = host.readOnly;
          input.addEventListener("input", () => {
            row[f.key] = input.value;
            push();
          });
          td.appendChild(input);
        }
        tr.appendChild(td);
      }
      const xtd = el("span", "ltk-cs-td ltk-cs-td-x");
      if (!host.readOnly) {
        const x = el("button", "ltk-cs-chip-x", "×");
        x.type = "button";
        x.title = "Remove row";
        x.addEventListener("click", () => {
          rows.splice(i, 1);
          sync();
          push();
        });
        xtd.appendChild(x);
      }
      tr.appendChild(xtd);
      table.appendChild(tr);
    });

    if (!host.readOnly) {
      const add = el("button", "ltk-cs-add", "＋ Add row");
      add.type = "button";
      add.addEventListener("click", () => {
        rows.push({});
        sync();
        const firstInput = table.querySelector<HTMLInputElement>(
          ".ltk-cs-tr:nth-last-child(2) input"
        );
        firstInput?.focus();
      });
      table.appendChild(add);
    }
  };
  sync();
  return fieldWrap(spec, table, true);
}

// ---- key → value pairs (object map) -------------------------------------------

function kvListEditor(spec: FieldSpec, get: Get, set: Set, host: FieldHost): HTMLElement {
  const cur = get();
  const pairs: { k: string; v: string }[] = [];
  if (cur && typeof cur === "object" && !Array.isArray(cur)) {
    for (const [k, v] of Object.entries(cur as Record<string, unknown>)) {
      pairs.push({ k, v: asString(v) });
    }
  }

  const push = () => {
    const out: Record<string, string> = {};
    for (const p of pairs) {
      if (p.k.trim() !== "") out[p.k.trim()] = p.v;
    }
    set(Object.keys(out).length > 0 ? out : undefined);
    host.onChanged();
  };

  const table = el("div", "ltk-cs-table");
  const sync = () => {
    while (table.firstChild) table.removeChild(table.firstChild);
    pairs.forEach((pair, i) => {
      const tr = el("div", "ltk-cs-tr");
      const kIn = el("input", "ltk-input ltk-cs-cell ltk-cs-cell-key") as HTMLInputElement;
      kIn.type = "text";
      kIn.value = pair.k;
      kIn.placeholder = "Key";
      kIn.disabled = host.readOnly;
      kIn.addEventListener("input", () => {
        pair.k = kIn.value;
        push();
      });
      const vIn = el("input", "ltk-input ltk-cs-cell") as HTMLInputElement;
      vIn.type = "text";
      vIn.value = pair.v;
      vIn.placeholder = "Value";
      vIn.disabled = host.readOnly;
      vIn.addEventListener("input", () => {
        pair.v = vIn.value;
        push();
      });
      const kTd = el("span", "ltk-cs-td ltk-cs-td-key");
      kTd.appendChild(kIn);
      const vTd = el("span", "ltk-cs-td");
      vTd.appendChild(vIn);
      tr.append(kTd, vTd);
      const xtd = el("span", "ltk-cs-td ltk-cs-td-x");
      if (!host.readOnly) {
        const x = el("button", "ltk-cs-chip-x", "×");
        x.type = "button";
        x.title = "Remove";
        x.addEventListener("click", () => {
          pairs.splice(i, 1);
          sync();
          push();
        });
        xtd.appendChild(x);
      }
      tr.appendChild(xtd);
      table.appendChild(tr);
    });
    if (!host.readOnly) {
      const add = el("button", "ltk-cs-add", "＋ Add pair");
      add.type = "button";
      add.addEventListener("click", () => {
        pairs.push({ k: "", v: "" });
        sync();
        table.querySelector<HTMLInputElement>(".ltk-cs-tr:nth-last-child(2) input")?.focus();
      });
      table.appendChild(add);
    }
  };
  sync();
  return fieldWrap(spec, table, true);
}

// ---- raw JSON fallback ---------------------------------------------------------

function jsonEditor(spec: FieldSpec, get: Get, set: Set, host: FieldHost): HTMLElement {
  const ta = el("textarea", "ltk-input ltk-textarea ltk-cs-json") as HTMLTextAreaElement;
  ta.rows = 5;
  const cur = get();
  ta.value = cur === undefined || cur === null ? "" : JSON.stringify(cur, null, 2);
  if (spec.placeholder) ta.placeholder = spec.placeholder;
  ta.disabled = host.readOnly;
  const err = el("div", "ltk-cs-jsonerr");
  err.style.display = "none";

  ta.addEventListener("input", () => {
    const t = ta.value.trim();
    if (t === "") {
      ta.classList.remove("ltk-cs-json-bad");
      err.style.display = "none";
      set(undefined);
      host.onChanged();
      return;
    }
    try {
      const parsed = JSON.parse(t) as unknown;
      ta.classList.remove("ltk-cs-json-bad");
      err.style.display = "none";
      set(parsed);
      host.onChanged();
    } catch (e) {
      ta.classList.add("ltk-cs-json-bad");
      err.textContent = "Not valid JSON yet — the last valid value is kept.";
      err.style.display = "block";
    }
  });

  const field = fieldWrap(spec, ta, true);
  field.appendChild(err);
  return field;
}

// ---- prompts (string | string[] | rich → JSON fallback) ------------------------

export function renderPromptsField(
  spec: FieldSpec,
  get: Get,
  set: Set,
  host: FieldHost
): HTMLElement {
  const cur = get();
  const simple =
    cur === undefined ||
    cur === null ||
    typeof cur === "string" ||
    (Array.isArray(cur) && cur.every((x) => typeof x === "string"));
  if (!simple) {
    // rich prompts ({field,hint} objects) — edit as JSON so nothing is lost
    return jsonEditor({ ...spec, kind: "json", help: (spec.help ?? "") + " (rich prompts — edited as JSON)" }, get, set, host);
  }
  const text =
    typeof cur === "string" ? cur : Array.isArray(cur) ? cur.join("\n") : "";
  const ta = el("textarea", "ltk-input ltk-textarea") as HTMLTextAreaElement;
  ta.rows = 3;
  ta.value = text;
  if (spec.placeholder) ta.placeholder = spec.placeholder;
  ta.disabled = host.readOnly;
  ta.addEventListener("input", () => {
    const lines = ta.value.split("\n").map((l) => l.trim()).filter((l) => l !== "");
    set(lines.length === 0 ? undefined : lines.length === 1 ? lines[0] : lines);
    host.onChanged();
  });
  return fieldWrap(spec, ta, true);
}

// ---- rotation focus: topic → pillars (PrioritiesCard) ------------------------------

/** One row per rotation topic (plus "No topic / ad hoc"), each a chip list
 *  of chosen pillars with an "Add…" select. Stored as JSON
 *  {topic: [ids]}. Topics in the stored map that the current rotation no
 *  longer names are kept, flagged, and removable. */
function topicPillarsEditor(spec: FieldSpec, get: Get, set: Set, host: FieldHost): HTMLElement {
  const rot = host.rotation;
  if (!rot) {
    return jsonEditor({ ...spec, kind: "json", help: (spec.help ?? "") + " (the board's rotation was not available here — edited as JSON)" }, get, set, host);
  }
  let map: Record<string, string[]> = {};
  try {
    const raw = get();
    const o = typeof raw === "string" ? (JSON.parse(raw || "{}") as unknown) : raw;
    if (o && typeof o === "object" && !Array.isArray(o)) {
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (Array.isArray(v)) map[k] = v.filter((x): x is string => typeof x === "string");
      }
    }
  } catch {
    map = {};
  }
  const push = () => {
    const clean = Object.fromEntries(Object.entries(map).filter(([, ids]) => ids.length > 0));
    set(Object.keys(clean).length > 0 ? JSON.stringify(clean) : undefined);
    host.onChanged();
  };
  const nameOf = (id: string) => {
    const p = rot.pillars.find((x) => x.id === id);
    return p ? (p.sub ? `${p.parentName} › ${p.name}` : p.name) : `(retired ${id.slice(0, 6)})`;
  };
  const box = el("div", "ltk-cs-topics");
  const rows: { key: string; label: string; stale: boolean }[] = [
    ...rot.topics.map((t) => ({ ...t, stale: false })),
    { key: "", label: "No topic / ad hoc", stale: false },
    ...Object.keys(map)
      .filter((k) => k !== "" && !rot.topics.some((t) => t.key === k))
      .map((k) => ({ key: k, label: `${k} — not in the current rotation`, stale: true })),
  ];
  const paint = () => {
    box.replaceChildren();
    if (rot.topics.length === 0) {
      box.appendChild(el("div", "ltk-cs-help", "This meeting has no rotation topics yet — set them in the meeting wizard (weekly: 1st–5th week; daily: by weekday). Until then only the \"No topic\" row applies."));
    }
    for (const r of rows) {
      const row = el("div", "ltk-cs-topic-row" + (r.stale ? " ltk-cs-topic-stale" : ""));
      const lab = el("div", "ltk-cs-topic-label", r.label);
      row.appendChild(lab);
      const chips = el("div", "ltk-cs-chips");
      const ids = map[r.key] ?? [];
      for (const id of ids) {
        const chip = el("span", "ltk-cs-chip");
        chip.appendChild(el("span", undefined, nameOf(id)));
        if (!host.readOnly) {
          const x = el("button", "ltk-cs-chip-x", "×");
          x.type = "button";
          x.title = "Remove";
          x.addEventListener("click", () => {
            map[r.key] = (map[r.key] ?? []).filter((v) => v !== id);
            paint();
            push();
          });
          chip.appendChild(x);
        }
        chips.appendChild(chip);
      }
      if (ids.length === 0) chips.appendChild(el("span", "ltk-cs-help", "All pillars"));
      if (!host.readOnly) {
        const sel = el("select", "ltk-input ltk-cs-topic-add") as HTMLSelectElement;
        const first = el("option", undefined, "Add pillar…") as HTMLOptionElement;
        first.value = "";
        sel.appendChild(first);
        const tops = rot.pillars.filter((p) => !p.sub);
        const grpTop = el("optgroup") as HTMLOptGroupElement;
        grpTop.label = "Pillars";
        for (const p of tops) {
          if (ids.includes(p.id)) continue;
          const o = el("option", undefined, p.name) as HTMLOptionElement;
          o.value = p.id;
          grpTop.appendChild(o);
        }
        if (grpTop.childElementCount > 0) sel.appendChild(grpTop);
        const grpSub = el("optgroup") as HTMLOptGroupElement;
        grpSub.label = "Sub-pillars";
        for (const p of rot.pillars.filter((x) => x.sub)) {
          if (ids.includes(p.id)) continue;
          const o = el("option", undefined, `${p.parentName} › ${p.name}`) as HTMLOptionElement;
          o.value = p.id;
          grpSub.appendChild(o);
        }
        if (grpSub.childElementCount > 0) sel.appendChild(grpSub);
        sel.addEventListener("change", () => {
          if (sel.value === "") return;
          map[r.key] = [...(map[r.key] ?? []), sel.value];
          paint();
          push();
        });
        chips.appendChild(sel);
        if (r.stale) {
          const rm = el("button", "ltk-cs-chip-x", "remove row");
          rm.type = "button";
          rm.addEventListener("click", () => {
            delete map[r.key];
            const i = rows.findIndex((x) => x.key === r.key);
            if (i >= 0) rows.splice(i, 1);
            paint();
            push();
          });
          chips.appendChild(rm);
        }
      }
      row.appendChild(chips);
      box.appendChild(row);
    }
  };
  paint();
  return fieldWrap(spec, box, true);
}

// ---- dispatcher -----------------------------------------------------------------

export function renderField(
  spec: FieldSpec,
  get: Get,
  set: Set,
  host: FieldHost
): HTMLElement {
  switch (spec.kind) {
    case "multiline":
      return multilineEditor(spec, get, set, host);
    case "number":
      return numberEditor(spec, get, set, host);
    case "enum":
      return enumEditor(spec, get, set, host);
    case "boolean":
      return booleanEditor(spec, get, set, host);
    case "csvChips":
      return chipsEditor(spec, get, set, host);
    case "color":
      return colorEditor(spec, get, set, host);
    case "titleColor":
      return titleColorEditor(spec, get, set, host);
    case "colorList":
      return colorListEditor(spec, get, set, host);
    case "objectList":
      return objectListEditor(spec, get, set, host);
    case "kvList":
      return kvListEditor(spec, get, set, host);
    case "captureColumns":
      return captureColumnsEditor(spec, get, set, host);
    case "canvasFields":
      return canvasFieldsEditor(spec, get, set, host);
    case "topicPillars":
      return topicPillarsEditor(spec, get, set, host);
    case "json":
      return jsonEditor(spec, get, set, host);
    case "text":
    case "date":
    case "time":
    default:
      return textEditor(spec, get, set, host);
  }
}
