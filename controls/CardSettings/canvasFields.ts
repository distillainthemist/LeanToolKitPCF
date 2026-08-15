// CanvasCard Layout builder — the settings editor for the canvasJSON
// config (plan C1): a columns-count select and one draggable block per
// field (label, type, width/height, required, hint, id) with sub-editors
// for choice options (capture option shape, no dependent lists) and
// mini-table columns (the captureColumnsEditor itself, re-hosted over the
// field's columns array). Emits the sparse object parseCanvasConfig
// understands. Field ids are the VALUE KEYS: auto-slugged from the label
// until touched or loaded, then load-bearing.

import { draggableRow } from "../../shared/ui/dragList";
import { checkItem } from "../../shared/ui/dialog";
import { el } from "../../shared/ui/dom";
import {
  CANVAS_TYPE_GLYPH,
  CANVAS_TYPE_LABEL,
  CANVAS_TYPES,
  CanvasFieldType,
  DEFAULT_H,
} from "../CanvasCard/types";
import {
  FieldDraft,
  iconIsUri,
  isType,
  loadCanvasDraft,
  serializeCanvasDraft,
  slug,
} from "../CanvasCard/draft";
export { loadCanvasDraft, serializeCanvasDraft } from "../CanvasCard/draft";
import { captureColumnsEditor } from "./captureColumns";
import { FieldSpec } from "./registry";
import { FieldHost, labelRow } from "./fields";

type Get = () => unknown;
type Set = (v: unknown) => void;

export const CANVAS_TYPE_LABELS: { value: CanvasFieldType; label: string }[] =
  CANVAS_TYPES.map((value) => ({
    value,
    label:
      value === "status"
        ? "Status (palette)"
        : value === "rating"
          ? "Rating (1–5)"
          : value === "url"
            ? "Link (URL)"
            : CANVAS_TYPE_LABEL[value],
  }));

export function canvasFieldsEditor(
  spec: FieldSpec,
  get: Get,
  set: Set,
  host: FieldHost
): HTMLElement {
  const draft = loadCanvasDraft(get());

  const push = () => {
    set(serializeCanvasDraft(draft));
    host.onChanged();
  };

  const box = el("div", "ltk-cs-cols");

  const optionsTable = (f: FieldDraft): HTMLElement => {
    const table = el("div", "ltk-cs-table");
    const head = el("div", "ltk-cs-tr ltk-cs-th");
    head.appendChild(el("span", "ltk-cs-td", "Option"));
    head.appendChild(el("span", "ltk-cs-td ltk-cs-td-icon", "Icon"));
    head.appendChild(el("span", "ltk-cs-td-prev", ""));
    head.appendChild(el("span", "ltk-cs-td ltk-cs-td-x", ""));
    table.appendChild(head);

    f.options.forEach((op, i) => {
      const tr = el("div", "ltk-cs-tr");
      const lIn = el("input", "ltk-input ltk-cs-cell") as HTMLInputElement;
      lIn.type = "text";
      lIn.value = op.label;
      lIn.placeholder = "e.g. On track";
      lIn.disabled = host.readOnly;
      lIn.addEventListener("input", () => {
        op.label = lIn.value;
        if (!op.valuePinned) op.value = lIn.value;
        push();
      });
      lIn.dataset.role = `opt-label-${i}`;
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
      iIn.placeholder = "🟢 or https://…";
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

      const xtd = el("span", "ltk-cs-td ltk-cs-td-x");
      if (!host.readOnly) {
        const x = el("button", "ltk-cs-chip-x", "×");
        x.type = "button";
        x.title = "Remove option";
        x.addEventListener("click", () => {
          f.options.splice(i, 1);
          resync();
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
        f.options.push({ value: "", valuePinned: false, label: "", icon: "" });
        sync();
        push();
        const blocks = box.querySelectorAll(".ltk-cs-col");
        const block = blocks[draft.fields.indexOf(f)];
        const inputs = block?.querySelectorAll<HTMLInputElement>(".ltk-cs-table .ltk-cs-tr input");
        inputs?.[inputs.length - 2]?.focus();
      });
      table.appendChild(add);
    }
    return table;
  };

  /** The mini-table's columns: the capture columns builder itself,
   *  re-hosted over this field's columns array. */
  const miniTableColumns = (f: FieldDraft): HTMLElement =>
    captureColumnsEditor(
      {
        key: "columns",
        label: "Table columns",
        kind: "captureColumns",
        help:
          "The embedded table's columns — the capture card's column model (picklists, icons, dependent lists all work).",
      },
      () => f.columns,
      (v) => {
        f.columns = Array.isArray(v) ? v : [];
      },
      host
    );

  // ---- selection + focus preservation (the inspector as a property panel) ----
  // With the selection bridge present (host.selectedField defined) the list
  // is COMPACT: one row per field, the selected field's block expanded to
  // its full properties. Without a bridge (harnesses) every block expands,
  // the C1 behaviour. Re-syncs rebuild the DOM, so the focused input is
  // captured by (field id, role, caret) and restored afterwards.
  const compactMode = host.selectedField !== undefined;
  let selected: string | null = host.selectedField ?? null;
  const effectiveIdOf = (f: FieldDraft) => (f.id.trim() !== "" ? f.id.trim() : slug(f.label));

  interface FocusMemo {
    id: string;
    role: string;
    start: number | null;
    end: number | null;
  }
  const captureFocus = (): FocusMemo | null => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || !box.contains(a)) return null;
    const block = a.closest<HTMLElement>("[data-field-id]");
    const role = a.dataset.role;
    if (!block || !role) return null;
    const inp = a as HTMLInputElement;
    return {
      id: block.dataset.fieldId ?? "",
      role,
      start: typeof inp.selectionStart === "number" ? inp.selectionStart : null,
      end: typeof inp.selectionEnd === "number" ? inp.selectionEnd : null,
    };
  };
  const restoreFocus = (m: FocusMemo | null) => {
    if (!m) return;
    const block = box.querySelector<HTMLElement>(`[data-field-id="${CSS.escape(m.id)}"]`);
    const inp = block?.querySelector<HTMLInputElement>(`[data-role="${m.role}"]`);
    if (!inp) return;
    inp.focus();
    if (m.start !== null && m.end !== null && typeof inp.setSelectionRange === "function") {
      try {
        inp.setSelectionRange(m.start, m.end);
      } catch {
        /* selects/checkboxes have no range */
      }
    }
  };
  const resync = () => {
    const m = captureFocus();
    sync();
    restoreFocus(m);
  };
  const select = (id: string | null) => {
    if (id === selected) return;
    selected = id;
    host.onSelectField?.(id);
    if (compactMode) setTimeout(resync, 0); // let the click/focus settle first
  };

  /** What is wrong with a field, if anything — shown on the row and the
   *  expanded block. Duplicate LABELS matter beyond typos: the Canvas
   *  rollup matches fields across charters by label. */
  const problems = (f: FieldDraft): string[] => {
    const out: string[] = [];
    const label = f.label.trim().toLowerCase();
    if (label === "") {
      out.push(f.type === "heading" ? "Untitled heading" : "Untitled — give this field a title");
    } else if (
      f.type !== "heading" &&
      draft.fields.some(
        (o) => o !== f && o.type !== "heading" && o.label.trim().toLowerCase() === label
      )
    ) {
      out.push("Duplicate title — another field has the same name (rollups match by title)");
    }
    const id = effectiveIdOf(f);
    if (id !== "" && draft.fields.some((o) => o !== f && effectiveIdOf(o) === id)) {
      out.push("Duplicate id — values would collide; change one before anyone fills it in");
    }
    return out;
  };

  const fieldBlock = (f: FieldDraft, i: number): HTMLElement => {
    const block = el("div", "ltk-cs-col");
    const id = effectiveIdOf(f);
    block.dataset.fieldId = id;
    const isSelected = !compactMode || selected === id;
    if (compactMode && selected === id) block.classList.add("ltk-cs-col-selected");
    if (compactMode && selected !== id) block.classList.add("ltk-cs-col-compact");
    block.addEventListener("focusin", () => select(id));
    block.addEventListener("click", () => select(id));

    const headRow = el("div", "ltk-cs-col-head");
    const handle = el("span", "ltk-cs-drag", "≡");
    handle.title = "Drag to reorder";
    headRow.appendChild(handle);
    if (!host.readOnly) {
      draggableRow(block, handle, "canvas-fields", i, draft.fields, () => {
        resync();
        push();
      });
    }
    headRow.appendChild(el("span", "ltk-cs-canvas-glyph", CANVAS_TYPE_GLYPH[f.type]));

    const lIn = el("input", "ltk-input ltk-cs-cell ltk-cs-col-label") as HTMLInputElement;
    lIn.type = "text";
    lIn.value = f.label;
    lIn.placeholder = f.type === "heading" ? "Heading text" : "Field title";
    lIn.spellcheck = true; // the browser's squiggle is the typo guard
    lIn.dataset.role = "label";
    lIn.disabled = host.readOnly;
    lIn.addEventListener("input", () => {
      f.label = lIn.value;
      if (!f.idTouched) {
        f.id = slug(lIn.value);
        idIn.value = f.id;
        block.dataset.fieldId = effectiveIdOf(f);
      }
      paintProblems();
      push();
    });

    const tSel = el("select", "ltk-input ltk-select ltk-cs-col-type") as HTMLSelectElement;
    for (const t of CANVAS_TYPE_LABELS) {
      const o = el("option", undefined, t.label) as HTMLOptionElement;
      o.value = t.value;
      if (t.value === f.type) o.selected = true;
      tSel.appendChild(o);
    }
    tSel.dataset.role = "type";
    tSel.disabled = host.readOnly;
    tSel.addEventListener("change", () => {
      const prevDefault = DEFAULT_H[f.type];
      if (isType(tSel.value)) f.type = tSel.value;
      if (f.type === "heading") f.required = false;
      // an untouched height follows the new type's default
      if (f.h === prevDefault) f.h = DEFAULT_H[f.type];
      resync(); // sub-sections appear/disappear
      push();
    });

    headRow.append(lIn, tSel);
    // the compact row still says how big the field is
    const size = el("span", "ltk-cs-canvas-size", `${Math.min(f.w, draft.cols)} × ${f.h}`);
    size.title = "Width × height — resize on the canvas, or expand this row";
    headRow.appendChild(size);
    const warnMark = el("span", "ltk-cs-canvas-warnmark", "⚠");
    headRow.appendChild(warnMark);
    if (!host.readOnly) {
      const x = el("button", "ltk-cs-chip-x", "×");
      x.type = "button";
      x.title = "Remove field (its saved values stay in documents, unrendered)";
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        draft.fields.splice(i, 1);
        if (selected === id) select(null);
        resync();
        push();
      });
      headRow.appendChild(x);
    }
    block.appendChild(headRow);

    const warnBox = el("div", "ltk-cs-canvas-warns");
    block.appendChild(warnBox);
    const paintProblems = () => {
      const list = problems(f);
      warnMark.style.visibility = list.length > 0 ? "visible" : "hidden";
      warnMark.title = list.join("\n");
      while (warnBox.firstChild) warnBox.removeChild(warnBox.firstChild);
      if (!isSelected) return;
      for (const p of list) warnBox.appendChild(el("div", "ltk-cs-rollup-warn", `⚠ ${p}`));
    };

    // ---- the meta row: id · width · height · required · hint ----
    const idIn = el("input", "ltk-input ltk-cs-cell ltk-cs-col-key") as HTMLInputElement;
    idIn.type = "text";
    idIn.value = f.id;
    idIn.placeholder = "id";
    idIn.title =
      "The key values are stored under. Auto-generated from the title; change it only before anyone has filled the field in.";
    idIn.dataset.role = "id";
    idIn.disabled = host.readOnly;
    idIn.addEventListener("input", () => {
      f.idTouched = true;
      f.id = idIn.value.trim();
      block.dataset.fieldId = effectiveIdOf(f);
      paintProblems();
      push();
    });

    if (!isSelected) {
      paintProblems();
      return block; // compact: the head row is the whole thing
    }

    const meta = el("div", "ltk-cs-canvas-meta");
    meta.appendChild(idIn);

    const wSel = el("select", "ltk-input ltk-select") as HTMLSelectElement;
    for (let w = 1; w <= draft.cols; w++) {
      const o = el(
        "option",
        undefined,
        w === 1 ? "1 column wide" : `${w} columns wide`
      ) as HTMLOptionElement;
      o.value = String(w);
      if (Math.min(f.w, draft.cols) === w) o.selected = true;
      wSel.appendChild(o);
    }
    wSel.dataset.role = "w";
    wSel.disabled = host.readOnly || draft.cols === 1;
    wSel.addEventListener("change", () => {
      f.w = Number(wSel.value);
      size.textContent = `${Math.min(f.w, draft.cols)} × ${f.h}`;
      push();
    });
    meta.appendChild(wSel);

    const hSel = el("select", "ltk-input ltk-select") as HTMLSelectElement;
    for (let h = 1; h <= 8; h++) {
      const o = el("option", undefined, `Height ${h}`) as HTMLOptionElement;
      o.value = String(h);
      if (f.h === h) o.selected = true;
      hSel.appendChild(o);
    }
    hSel.dataset.role = "h";
    hSel.disabled = host.readOnly;
    hSel.title = "Height in grid steps — long text, tables and images want 3+";
    hSel.addEventListener("change", () => {
      f.h = Number(hSel.value);
      size.textContent = `${Math.min(f.w, draft.cols)} × ${f.h}`;
      push();
    });
    meta.appendChild(hSel);

    if (f.type !== "heading") {
      const req = checkItem("Required");
      req.box.checked = f.required;
      req.wrap.classList.toggle("ltk-check-on", f.required);
      req.box.disabled = host.readOnly;
      req.box.dataset.role = "required";
      req.box.title = "A marker, not a gate — empty required fields count toward “N to complete”.";
      req.box.addEventListener("change", () => {
        f.required = req.box.checked;
        req.wrap.classList.toggle("ltk-check-on", f.required);
        push();
      });
      meta.appendChild(req.wrap);
    }

    const hintIn = el("input", "ltk-input ltk-cs-cell ltk-cs-canvas-hint") as HTMLInputElement;
    hintIn.type = "text";
    hintIn.value = f.hint;
    hintIn.placeholder = "Prompt shown while empty";
    hintIn.spellcheck = true;
    hintIn.dataset.role = "hint";
    hintIn.disabled = host.readOnly;
    hintIn.addEventListener("input", () => {
      f.hint = hintIn.value;
      push();
    });
    meta.appendChild(hintIn);

    block.appendChild(meta);
    paintProblems();

    if (f.type === "choice" || f.type === "multichoice") {
      block.appendChild(optionsTable(f));
    }
    if (f.type === "status") {
      block.appendChild(
        el(
          "div",
          "ltk-cs-note",
          "Status fields offer the app's state palette — no options to configure here."
        )
      );
    }
    if (f.type === "minitable") {
      block.appendChild(miniTableColumns(f));
    }

    return block;
  };

  const sync = () => {
    while (box.firstChild) box.removeChild(box.firstChild);

    const colsRow = el("div", "ltk-cs-canvas-cols");
    colsRow.appendChild(el("span", "ltk-cs-sublabel", "Layout columns"));
    const cSel = el("select", "ltk-input ltk-select") as HTMLSelectElement;
    for (let c = 1; c <= 3; c++) {
      const o = el("option", undefined, `${c} column${c === 1 ? "" : "s"}`) as HTMLOptionElement;
      o.value = String(c);
      if (draft.cols === c) o.selected = true;
      cSel.appendChild(o);
    }
    cSel.disabled = host.readOnly;
    cSel.addEventListener("change", () => {
      draft.cols = Number(cSel.value);
      for (const f of draft.fields) f.w = Math.min(f.w, draft.cols);
      sync(); // width selects re-range
      push();
    });
    colsRow.appendChild(cSel);
    box.appendChild(colsRow);

    if (compactMode && draft.fields.length > 0 && selected === null) {
      box.appendChild(
        el(
          "div",
          "ltk-cs-note",
          "Select a field on the canvas — or click a row here — to edit its properties."
        )
      );
    }
    draft.fields.forEach((f, i) => box.appendChild(fieldBlock(f, i)));
    if (!host.readOnly) {
      const add = el("button", "ltk-cs-add", "＋ Add field");
      add.type = "button";
      add.addEventListener("click", () => {
        const n = draft.fields.length + 1;
        const fresh: FieldDraft = {
          id: "",
          idTouched: false,
          label: "",
          type: "text",
          w: 1,
          h: DEFAULT_H.text,
          hint: "",
          required: false,
          options: [],
          columns: [],
        };
        draft.fields.push(fresh);
        void n;
        // select it (bridge → canvas outline) and expand it here
        selected = effectiveIdOf(fresh);
        host.onSelectField?.(selected);
        sync();
        push();
        box.querySelector<HTMLInputElement>(".ltk-cs-col:last-of-type .ltk-cs-col-label")?.focus();
      });
      box.appendChild(add);
    }
  };
  sync();

  const field = el("div", "ltk-cs-field ltk-cs-field-wide");
  field.appendChild(labelRow(spec.label, spec.help));
  field.appendChild(box);
  return field;
}
