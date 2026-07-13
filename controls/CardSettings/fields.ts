// CardSettings typed field editors — one small uncontrolled editor per
// FieldKind. Each reads its current value with get(), writes with set()
// (undefined = unset → the sparse serializer omits the key) and then calls
// host.onChanged() to emit. Editors manage their own inner DOM so typing
// never triggers a full form re-render.

import { el } from "../../shared/ui/dom";
import { checkItem } from "../../shared/ui/dialog";
import { FieldSpec, ObjectField } from "./registry";
import { captureColumnsEditor } from "./captureColumns";

export interface FieldHost {
  readOnly: boolean;
  onChanged: () => void;
}

type Get = () => unknown;
type Set = (v: unknown) => void;

// ---- shared scaffolding ------------------------------------------------------

function fieldWrap(spec: FieldSpec, control: HTMLElement, wide = false): HTMLElement {
  const field = el("div", "ltk-cs-field" + (wide ? " ltk-cs-field-wide" : ""));
  field.appendChild(el("label", "ltk-cs-field-label", spec.label));
  field.appendChild(control);
  if (spec.help) field.appendChild(el("div", "ltk-cs-help", spec.help));
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
  const field = el("div", "ltk-cs-field");
  field.appendChild(el("label", "ltk-cs-field-label", " "));
  field.appendChild(item.wrap);
  if (spec.help) field.appendChild(el("div", "ltk-cs-help", spec.help));
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
    case "colorList":
      return colorListEditor(spec, get, set, host);
    case "objectList":
      return objectListEditor(spec, get, set, host);
    case "kvList":
      return kvListEditor(spec, get, set, host);
    case "captureColumns":
      return captureColumnsEditor(spec, get, set, host);
    case "json":
      return jsonEditor(spec, get, set, host);
    case "text":
    case "date":
    case "time":
    default:
      return textEditor(spec, get, set, host);
  }
}
