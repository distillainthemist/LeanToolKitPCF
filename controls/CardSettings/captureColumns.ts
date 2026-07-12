// CaptureCard columns builder — a structured editor for the columnsJSON
// config, replacing the raw-JSON textarea. One block per column: label, key
// (auto-slugged from the label until touched), type; picklist columns gain an
// options table (label + icon with a live preview — emoji or image URI), a
// multi-select toggle and a depends-on parent, with each option's "when"
// picked from the parent's options. Emits the sparse native array that
// CaptureCard's parseColumns understands.

import { el } from "../../shared/ui/dom";
import { checkItem } from "../../shared/ui/dialog";
import { FieldSpec } from "./registry";
import { FieldHost } from "./fields";

type Get = () => unknown;
type Set = (v: unknown) => void;

const COLUMN_TYPES = [
  { value: "text", label: "Text" },
  { value: "number", label: "Whole number" },
  { value: "decimal", label: "Decimal" },
  { value: "yesno", label: "Yes / no" },
  { value: "list", label: "Picklist" },
];

interface OptDraft {
  value: string;
  /** true = value came in distinct from the label (or was hand-set) — label
   *  edits then leave it alone so stored row data keeps matching. */
  valuePinned: boolean;
  label: string;
  icon: string;
  when: string;
}

interface ColDraft {
  key: string;
  keyTouched: boolean; // stop auto-slugging once edited (or loaded)
  label: string;
  type: string;
  multi: boolean;
  parent: string;
  options: OptDraft[];
}

function slug(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Same test CaptureCard uses to decide emoji-vs-image. */
function iconIsUri(icon: string): boolean {
  return /^(data:|https?:\/\/|\/)/i.test(icon);
}

function loadDrafts(v: unknown): ColDraft[] {
  let data: unknown = v;
  if (typeof v === "string") {
    try {
      data = JSON.parse(v);
    } catch {
      data = undefined;
    }
  }
  if (!Array.isArray(data)) return [];
  const out: ColDraft[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const key = typeof o.key === "string" ? o.key.trim() : "";
    if (key === "") continue;
    const label = typeof o.label === "string" && o.label !== "" ? o.label : key;
    const options: OptDraft[] = [];
    if (Array.isArray(o.options)) {
      for (const op of o.options) {
        if (typeof op === "string") {
          if (op !== "") options.push({ value: op, valuePinned: false, label: op, icon: "", when: "" });
          continue;
        }
        if (!op || typeof op !== "object") continue;
        const oo = op as Record<string, unknown>;
        const oLabel = typeof oo.label === "string" ? oo.label : "";
        const oValue = typeof oo.value === "string" && oo.value !== "" ? oo.value : oLabel;
        if (oValue === "") continue;
        options.push({
          value: oValue,
          valuePinned: oValue !== (oLabel === "" ? oValue : oLabel),
          label: oLabel === "" ? oValue : oLabel,
          icon: typeof oo.icon === "string" ? oo.icon : "",
          when: typeof oo.when === "string" ? oo.when : "",
        });
      }
    }
    out.push({
      key,
      keyTouched: true, // loaded keys are load-bearing (row cells reference them)
      label,
      type:
        o.type === "number" || o.type === "decimal" || o.type === "yesno" || o.type === "list"
          ? (o.type as string)
          : "text",
      multi: o.multi === true,
      parent: typeof o.parent === "string" ? o.parent : "",
      options,
    });
  }
  return out;
}

/** Sparse emit: only keys that differ from parseColumns' defaults. */
function serializeDrafts(cols: ColDraft[]): unknown[] | undefined {
  const out: unknown[] = [];
  for (const c of cols) {
    const key = c.key.trim() !== "" ? c.key.trim() : slug(c.label);
    if (key === "") continue; // an entirely empty block
    const o: Record<string, unknown> = { key, label: c.label.trim() !== "" ? c.label : key };
    if (c.type !== "text") o.type = c.type;
    if (c.type === "list") {
      if (c.multi) o.multi = true;
      if (c.parent !== "") o.parent = c.parent;
      const opts: unknown[] = [];
      for (const op of c.options) {
        const label = op.label.trim();
        const value = op.valuePinned ? op.value : label;
        if (value === "" && label === "") continue;
        if (op.icon === "" && op.when === "" && value === label) {
          opts.push(label); // plain string option
        } else {
          const oo: Record<string, unknown> = { value: value !== "" ? value : label };
          if (label !== "" && label !== oo.value) oo.label = label;
          if (op.icon !== "") oo.icon = op.icon;
          if (op.when !== "") oo.when = op.when;
          opts.push(oo);
        }
      }
      if (opts.length > 0) o.options = opts;
    }
    out.push(o);
  }
  return out.length > 0 ? out : undefined;
}

export function captureColumnsEditor(
  spec: FieldSpec,
  get: Get,
  set: Set,
  host: FieldHost
): HTMLElement {
  const cols = loadDrafts(get());

  const push = () => {
    set(serializeDrafts(cols));
    host.onChanged();
  };

  const box = el("div", "ltk-cs-cols");

  /** A column key changed old→next: keep dependent children pointing at it.
   *  old "" is every non-dependent column's parent — never remap it. */
  const remapParent = (old: string, next: string) => {
    if (old === "" || old === next) return;
    for (const c of cols) if (c.parent === old && c.key !== next) c.parent = next;
  };
  /** A parent option's value changed old→next: keep children's `when` current. */
  const remapWhen = (parentKey: string, old: string, next: string) => {
    if (old === next || old === "") return;
    for (const c of cols) {
      if (c.parent !== parentKey) continue;
      for (const op of c.options) if (op.when === old) op.when = next;
    }
  };

  const optionsTable = (col: ColDraft): HTMLElement => {
    const hasWhen = col.parent !== "";
    const parentCol = cols.find((c) => c.key === col.parent);
    const table = el("div", "ltk-cs-table");

    const head = el("div", "ltk-cs-tr ltk-cs-th");
    head.appendChild(el("span", "ltk-cs-td", "Option"));
    head.appendChild(el("span", "ltk-cs-td ltk-cs-td-icon", "Icon"));
    head.appendChild(el("span", "ltk-cs-td-prev", ""));
    if (hasWhen) head.appendChild(el("span", "ltk-cs-td", `When ${parentCol?.label ?? col.parent} is`));
    head.appendChild(el("span", "ltk-cs-td ltk-cs-td-x", ""));
    table.appendChild(head);

    col.options.forEach((op, i) => {
      const tr = el("div", "ltk-cs-tr");

      const lIn = el("input", "ltk-input ltk-cs-cell") as HTMLInputElement;
      lIn.type = "text";
      lIn.value = op.label;
      lIn.placeholder = "e.g. Fermenter";
      lIn.disabled = host.readOnly;
      lIn.addEventListener("input", () => {
        const old = op.value;
        op.label = lIn.value;
        if (!op.valuePinned) {
          op.value = lIn.value;
          remapWhen(col.key, old, op.value); // children track the rename
        }
        push();
      });
      const lTd = el("span", "ltk-cs-td");
      lTd.appendChild(lIn);
      tr.appendChild(lTd);

      const prev = el("span", "ltk-cs-iconprev");
      const paintPrev = () => {
        while (prev.firstChild) prev.removeChild(prev.firstChild);
        if (op.icon === "") return;
        if (iconIsUri(op.icon)) {
          const img = el("img") as HTMLImageElement;
          img.src = op.icon;
          img.alt = "";
          prev.appendChild(img);
        } else {
          prev.textContent = op.icon;
        }
      };
      const iIn = el("input", "ltk-input ltk-cs-cell") as HTMLInputElement;
      iIn.type = "text";
      iIn.value = op.icon;
      iIn.placeholder = "🫧 or https://…";
      iIn.title = "An emoji / short glyph, or an image URL / data URI";
      iIn.disabled = host.readOnly;
      iIn.addEventListener("input", () => {
        op.icon = iIn.value.trim();
        paintPrev();
        push();
      });
      const iTd = el("span", "ltk-cs-td ltk-cs-td-icon");
      iTd.appendChild(iIn);
      tr.appendChild(iTd);
      paintPrev();
      tr.appendChild(prev);

      if (hasWhen) {
        const wSel = el("select", "ltk-input ltk-select ltk-cs-cell") as HTMLSelectElement;
        const wOpts = [
          { value: "", label: "(always)" },
          ...(parentCol?.options ?? [])
            .filter((po) => po.value !== "" || po.label !== "")
            .map((po) => ({ value: po.valuePinned ? po.value : po.label, label: po.label })),
        ];
        for (const wo of wOpts) {
          const o = el("option", undefined, wo.label) as HTMLOptionElement;
          o.value = wo.value;
          if (wo.value === op.when) o.selected = true;
          wSel.appendChild(o);
        }
        // a stale `when` (parent option since renamed/removed) stays visible
        if (op.when !== "" && !wOpts.some((wo) => wo.value === op.when)) {
          const o = el("option", undefined, `${op.when} (no longer an option)`) as HTMLOptionElement;
          o.value = op.when;
          o.selected = true;
          wSel.appendChild(o);
        }
        wSel.disabled = host.readOnly;
        wSel.addEventListener("change", () => {
          op.when = wSel.value;
          push();
        });
        const wTd = el("span", "ltk-cs-td");
        wTd.appendChild(wSel);
        tr.appendChild(wTd);
      }

      const xtd = el("span", "ltk-cs-td ltk-cs-td-x");
      if (!host.readOnly) {
        const x = el("button", "ltk-cs-chip-x", "×");
        x.type = "button";
        x.title = "Remove option";
        x.addEventListener("click", () => {
          col.options.splice(i, 1);
          sync();
          push();
        });
        xtd.appendChild(x);
      }
      tr.appendChild(xtd);
      table.appendChild(tr);
    });

    if (!host.readOnly) {
      const add = el("button", "ltk-cs-add", "＋ Option");
      add.type = "button";
      add.addEventListener("click", () => {
        col.options.push({ value: "", valuePinned: false, label: "", icon: "", when: "" });
        sync();
        push();
        // focus the fresh option's label — table was rebuilt, re-query
        const rows = box.querySelectorAll(".ltk-cs-col");
        const block = rows[cols.indexOf(col)];
        const inputs = block?.querySelectorAll<HTMLInputElement>(".ltk-cs-table .ltk-cs-tr input");
        inputs?.[inputs.length - 2]?.focus();
      });
      table.appendChild(add);
    }
    return table;
  };

  const columnBlock = (col: ColDraft, i: number): HTMLElement => {
    const block = el("div", "ltk-cs-col");

    const headRow = el("div", "ltk-cs-col-head");
    const lIn = el("input", "ltk-input ltk-cs-cell ltk-cs-col-label") as HTMLInputElement;
    lIn.type = "text";
    lIn.value = col.label;
    lIn.placeholder = "Column label";
    lIn.disabled = host.readOnly;
    const kIn = el("input", "ltk-input ltk-cs-cell ltk-cs-col-key") as HTMLInputElement;
    kIn.type = "text";
    kIn.value = col.key;
    kIn.placeholder = "key";
    kIn.title =
      "The data key rows store their cells under. Auto-generated from the label; change it only before data exists.";
    kIn.disabled = host.readOnly;
    lIn.addEventListener("input", () => {
      col.label = lIn.value;
      if (!col.keyTouched) {
        const old = col.key;
        col.key = slug(lIn.value);
        kIn.value = col.key;
        remapParent(old, col.key);
      }
      push();
    });
    kIn.addEventListener("input", () => {
      col.keyTouched = true;
      remapParent(col.key, kIn.value.trim());
      col.key = kIn.value.trim();
      push();
    });

    const tSel = el("select", "ltk-input ltk-select ltk-cs-col-type") as HTMLSelectElement;
    for (const t of COLUMN_TYPES) {
      const o = el("option", undefined, t.label) as HTMLOptionElement;
      o.value = t.value;
      if (t.value === col.type) o.selected = true;
      tSel.appendChild(o);
    }
    tSel.disabled = host.readOnly;
    tSel.addEventListener("change", () => {
      col.type = tSel.value;
      if (col.type !== "list") {
        col.parent = ""; // options/multi are kept in the draft, just not emitted
      }
      sync(); // structure changed (options section appears/disappears)
      push();
    });

    headRow.append(lIn, kIn, tSel);
    if (!host.readOnly) {
      const x = el("button", "ltk-cs-chip-x", "×");
      x.type = "button";
      x.title = "Remove column";
      x.addEventListener("click", () => {
        for (const c of cols) if (c.parent === col.key) c.parent = "";
        cols.splice(i, 1);
        sync();
        push();
      });
      headRow.appendChild(x);
    }
    block.appendChild(headRow);

    if (col.type === "list") {
      block.appendChild(optionsTable(col));

      const foot = el("div", "ltk-cs-col-foot");
      const multi = checkItem("Multi-select");
      multi.box.checked = col.multi;
      multi.wrap.classList.toggle("ltk-check-on", col.multi);
      multi.box.disabled = host.readOnly;
      multi.box.addEventListener("change", () => {
        col.multi = multi.box.checked;
        multi.wrap.classList.toggle("ltk-check-on", col.multi);
        push();
      });
      foot.appendChild(multi.wrap);

      const parents = cols.filter((c) => c !== col && c.type === "list" && c.key !== "");
      const dep = el("span", "ltk-cs-col-dep");
      dep.appendChild(el("span", undefined, "Depends on"));
      const pSel = el("select", "ltk-input ltk-select") as HTMLSelectElement;
      const pOpts = [
        { value: "", label: "(nothing)" },
        ...parents.map((c) => ({ value: c.key, label: c.label !== "" ? c.label : c.key })),
      ];
      for (const po of pOpts) {
        const o = el("option", undefined, po.label) as HTMLOptionElement;
        o.value = po.value;
        if (po.value === col.parent) o.selected = true;
        pSel.appendChild(o);
      }
      pSel.disabled = host.readOnly || parents.length === 0;
      pSel.title =
        parents.length === 0
          ? "Add another picklist column first"
          : "This column's options filter by the parent's selection (per-option 'when').";
      pSel.addEventListener("change", () => {
        col.parent = pSel.value;
        sync(); // the options table gains/loses its When column
        push();
      });
      dep.appendChild(pSel);
      foot.appendChild(dep);
      block.appendChild(foot);
    }

    return block;
  };

  const sync = () => {
    while (box.firstChild) box.removeChild(box.firstChild);
    cols.forEach((col, i) => box.appendChild(columnBlock(col, i)));
    if (!host.readOnly) {
      const add = el("button", "ltk-cs-add", "＋ Add column");
      add.type = "button";
      add.addEventListener("click", () => {
        cols.push({
          key: "",
          keyTouched: false,
          label: "",
          type: "text",
          multi: false,
          parent: "",
          options: [],
        });
        sync();
        push();
        box.querySelector<HTMLInputElement>(".ltk-cs-col:last-of-type .ltk-cs-col-label")?.focus();
      });
      box.appendChild(add);
    }
  };
  sync();

  const field = el("div", "ltk-cs-field ltk-cs-field-wide");
  field.appendChild(el("label", "ltk-cs-field-label", spec.label));
  field.appendChild(box);
  if (spec.help) field.appendChild(el("div", "ltk-cs-help", spec.help));
  return field;
}
