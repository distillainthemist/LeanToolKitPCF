// One canvas field, edited in a dialog — extracted from CanvasEditor (C5)
// so the Canvas ROLLUP's per-cell editing opens the very same editors the
// canvas card uses. The canvas card itself sends its picker types here
// (choice, status, people, rich text, checklist, image) and keeps typing
// types inline on the card; the rollup sends EVERY type here (a portfolio
// cell has no inline surface). Mini-tables are the one refusal: their
// add/edit-row flow belongs to the card — canvasFieldDialog returns false
// and the caller says "edit on the source card".

import { checkItem, openDialog, textInput } from "../../shared/ui/dialog";
import { clear, el } from "../../shared/ui/dom";
import { fileToDataUrl, shrinkImage } from "../../shared/ui/imageIngest";
import { initialsFor, Person } from "../../shared/schema/people";
import { textOn } from "../../shared/tokens";
import { buildCaptureField } from "../CaptureCard/fields";
import {
  CanvasField,
  CanvasValue,
  clampPercent,
  clampRating,
  sanitizeRichText,
  vBool,
  vChecklist,
  vNumber,
  vPeople,
  vRange,
  vString,
  vStrings,
} from "./types";

export interface CanvasFieldDialogOpts {
  host: HTMLElement;
  field: CanvasField;
  value: CanvasValue | undefined;
  /** App state palette (status fields). */
  palette: Record<string, string>;
  /** Board people first, `secondary` behind the search (person fields). */
  people: Person[];
  onSave: (v: CanvasValue | undefined) => void;
}

/** A palette key as a human label ("at_risk" → "At risk"). */
export function statusLabel(key: string): string {
  const s = key.replace(/_/g, " ").trim();
  return s === "" ? key : s[0].toUpperCase() + s.slice(1);
}

/** Open the right dialog for the field's type. false = not dialog-editable
 *  (mini-table) — the caller directs the user to the source card. */
export function canvasFieldDialog(opts: CanvasFieldDialogOpts): boolean {
  switch (opts.field.type) {
    case "heading":
    case "minitable":
      return false;
    case "choice":
    case "multichoice":
      choiceDialog(opts);
      return true;
    case "status":
      statusDialog(opts);
      return true;
    case "person":
    case "people":
      peopleDialog(opts);
      return true;
    case "richtext":
      richTextDialog(opts);
      return true;
    case "checklist":
      checklistDialog(opts);
      return true;
    case "image":
      imageDialog(opts);
      return true;
    case "yesno":
      yesnoDialog(opts);
      return true;
    case "rating":
      ratingDialog(opts);
      return true;
    default:
      typingDialog(opts);
      return true;
  }
}

/** Choice/multi-choice: the CAPTURE list field over the same options —
 *  chips, single-as-radio, identical to the capture row dialog. */
function choiceDialog(o: CanvasFieldDialogOpts): void {
  const fe = buildCaptureField(
    {
      key: o.field.id,
      label: o.field.label,
      type: "list",
      multi: o.field.type === "multichoice",
      parent: "",
      options: o.field.options,
    },
    (() => {
      const picked = vStrings(o.value);
      if (picked.length === 0) return undefined;
      return o.field.type === "multichoice" ? picked : picked[0];
    })(),
    ""
  );
  const dlg = openDialog({
    host: o.host,
    title: o.field.label,
    buttons: [
      { label: "Cancel", kind: "secondary" as const, onClick: () => dlg.close() },
      {
        label: "Save",
        kind: "primary" as const,
        onClick: () => {
          const v = fe.read();
          dlg.close();
          o.onSave(v === undefined ? undefined : (v as CanvasValue));
        },
      },
    ],
  });
  dlg.body.appendChild(fe.el);
}

/** Status: one tap on a palette chip sets and closes. */
function statusDialog(o: CanvasFieldDialogOpts): void {
  const current = vString(o.value);
  const dlg = openDialog({
    host: o.host,
    title: o.field.label,
    buttons: [
      {
        label: "Clear",
        kind: "secondary" as const,
        onClick: () => {
          dlg.close();
          o.onSave(undefined);
        },
      },
      { label: "Cancel", kind: "secondary" as const, onClick: () => dlg.close() },
    ],
  });
  const wrap = el("div", "ltk-cv-statuspick");
  for (const [key, color] of Object.entries(o.palette)) {
    const chip = el("button", "ltk-cv-status ltk-cv-statusopt", statusLabel(key)) as HTMLButtonElement;
    chip.type = "button";
    chip.style.background = color;
    chip.style.color = textOn(color);
    if (key === current) chip.classList.add("ltk-cv-statusopt-on");
    chip.addEventListener("click", () => {
      dlg.close();
      o.onSave(key);
    });
    wrap.appendChild(chip);
  }
  if (Object.keys(o.palette).length === 0) {
    wrap.appendChild(el("div", "ltk-cv-empty", "No states in the app palette."));
  }
  dlg.body.appendChild(wrap);
}

/** Person/people: board people as chips up front, everyone else behind
 *  the search box (the action form's own convention — `secondary`). */
function peopleDialog(o: CanvasFieldDialogOpts): void {
  const single = o.field.type === "person";
  const selected = new Map(vPeople(o.value).map((p) => [p.id, p.name]));
  const primaries = o.people.filter((p) => p.secondary !== true);
  const chipsBox = el("div", "ltk-cv-peoplepick");
  const searchBox = el("div", "ltk-cv-peoplepick");

  const chip = (person: Person): HTMLElement => {
    const b = el("button", "ltk-cv-person ltk-cv-personopt") as HTMLButtonElement;
    b.type = "button";
    b.appendChild(el("span", "ltk-cv-person-dot", person.initials || initialsFor(person.who)));
    b.appendChild(el("span", undefined, person.who));
    b.classList.toggle("ltk-cv-personopt-on", selected.has(person.whoId));
    b.addEventListener("click", () => {
      if (selected.has(person.whoId)) {
        selected.delete(person.whoId);
      } else {
        if (single) selected.clear();
        selected.set(person.whoId, person.who);
      }
      repaintAll();
    });
    return b;
  };

  let repaintSearch: () => void = () => undefined;
  const repaintAll = () => {
    clear(chipsBox);
    for (const p of primaries) chipsBox.appendChild(chip(p));
    repaintSearch();
  };

  const search = textInput("", { placeholder: "Search everyone…" });
  search.addEventListener("input", () => repaintSearch());
  repaintSearch = () => {
    clear(searchBox);
    const q = search.value.trim().toLowerCase();
    if (q === "") return;
    const hits = o.people.filter((p) => p.who.toLowerCase().includes(q)).slice(0, 12);
    if (hits.length === 0) {
      searchBox.appendChild(el("div", "ltk-cv-empty", "No one matches."));
      return;
    }
    for (const p of hits) searchBox.appendChild(chip(p));
  };

  const dlg = openDialog({
    host: o.host,
    title: o.field.label,
    buttons: [
      { label: "Cancel", kind: "secondary" as const, onClick: () => dlg.close() },
      {
        label: "Save",
        kind: "primary" as const,
        onClick: () => {
          dlg.close();
          const people = [...selected.entries()].map(([id, name]) => ({ id, name }));
          o.onSave(people.length === 0 ? undefined : people);
        },
      },
    ],
  });
  repaintAll();
  dlg.body.appendChild(chipsBox);
  dlg.body.appendChild(search);
  dlg.body.appendChild(searchBox);
  search.focus();
}

/** Rich text: contenteditable with a minimal toolbar; sanitised on save
 *  (and again on every render — stored HTML is never trusted). */
function richTextDialog(o: CanvasFieldDialogOpts): void {
  const surface = el("div", "ltk-cv-rich ltk-cv-richedit");
  surface.contentEditable = "true";
  surface.innerHTML = sanitizeRichText(vString(o.value));

  const bar = el("div", "ltk-cv-richbar");
  const cmd = (label: string, title: string, run: () => void) => {
    const b = el("button", "ltk-cv-richbtn", label) as HTMLButtonElement;
    b.type = "button";
    b.title = title;
    // mousedown so the surface keeps its selection
    b.addEventListener("mousedown", (e) => {
      e.preventDefault();
      run();
    });
    bar.appendChild(b);
  };
  cmd("B", "Bold", () => document.execCommand("bold"));
  cmd("I", "Italic", () => document.execCommand("italic"));
  cmd("U", "Underline", () => document.execCommand("underline"));
  cmd("• list", "Bullet list", () => document.execCommand("insertUnorderedList"));
  cmd("1. list", "Numbered list", () => document.execCommand("insertOrderedList"));
  const linkIn = textInput("", { placeholder: "https://… then ⤿" });
  linkIn.classList.add("ltk-cv-richlink");
  cmd("⤿ link", "Link the selected text to the URL on the left", () => {
    const url = linkIn.value.trim();
    if (/^https?:\/\//i.test(url)) document.execCommand("createLink", false, url);
  });

  const dlg = openDialog({
    host: o.host,
    title: o.field.label,
    buttons: [
      { label: "Cancel", kind: "secondary" as const, onClick: () => dlg.close() },
      {
        label: "Save",
        kind: "primary" as const,
        onClick: () => {
          const html = sanitizeRichText(surface.innerHTML);
          dlg.close();
          o.onSave(html.replace(/<[^>]*>/g, "").trim() === "" ? undefined : html);
        },
      },
    ],
  });
  bar.appendChild(linkIn);
  dlg.body.appendChild(bar);
  dlg.body.appendChild(surface);
  surface.focus();
}

/** Checklist item management (ticks stay inline on the canvas card; the
 *  dialog also offers per-item done toggles for dialog-only contexts). */
function checklistDialog(o: CanvasFieldDialogOpts): void {
  const items = vChecklist(o.value).map((i) => ({ ...i }));
  const list = el("div", "ltk-cv-checkedit");
  const paint = () => {
    clear(list);
    items.forEach((item, i) => {
      const row = el("div", "ltk-cv-checkedit-row");
      const done = checkItem("");
      done.box.checked = item.done;
      done.wrap.classList.toggle("ltk-check-on", item.done);
      done.box.title = "Done";
      done.box.addEventListener("change", () => {
        item.done = done.box.checked;
        done.wrap.classList.toggle("ltk-check-on", item.done);
      });
      const input = textInput(item.text, { placeholder: "Item…" });
      input.addEventListener("input", () => {
        item.text = input.value;
      });
      const x = el("button", "ltk-cs-chip-x", "×") as HTMLButtonElement;
      x.type = "button";
      x.title = "Remove item";
      x.addEventListener("click", () => {
        items.splice(i, 1);
        paint();
      });
      row.append(done.wrap, input, x);
      list.appendChild(row);
    });
    const add = el("button", "ltk-cv-addbtn", "＋ Add item") as HTMLButtonElement;
    add.type = "button";
    add.addEventListener("click", () => {
      items.push({ text: "", done: false });
      paint();
      const inputs = list.querySelectorAll<HTMLInputElement>("input[type=text]");
      inputs[inputs.length - 1]?.focus();
    });
    list.appendChild(add);
  };
  const dlg = openDialog({
    host: o.host,
    title: o.field.label,
    buttons: [
      { label: "Cancel", kind: "secondary" as const, onClick: () => dlg.close() },
      {
        label: "Save",
        kind: "primary" as const,
        onClick: () => {
          dlg.close();
          const kept = items
            .map((i) => ({ text: i.text.trim(), done: i.done }))
            .filter((i) => i.text !== "");
          o.onSave(kept.length === 0 ? undefined : kept);
        },
      },
    ],
  });
  paint();
  dlg.body.appendChild(list);
  if (items.length === 0) {
    list.querySelector<HTMLButtonElement>(".ltk-cv-addbtn")?.click();
  }
}

/** Image: pick or paste, shrunk on ingest (shared road), stored as a
 *  data URI — the player's CSP blocks blob: images. */
function imageDialog(o: CanvasFieldDialogOpts): void {
  const current = vString(o.value);
  const note = el("div", "ltk-cv-empty", "");

  const ingest = async (file: File) => {
    note.textContent = "Preparing image…";
    try {
      // tighter than the issues dialog: this data URI lives INSIDE the
      // card document, so shrink harder and refuse the truly huge
      let out = await shrinkImage(file, { threshold: 150_000, maxEdge: 800, quality: 0.8 });
      let url = await fileToDataUrl(out);
      if (url.length > 500_000) {
        out = await shrinkImage(file, { threshold: 0, maxEdge: 600, quality: 0.6 });
        url = await fileToDataUrl(out);
      }
      if (url.length > 500_000) {
        note.textContent = "That image is too large even after shrinking — try a smaller one.";
        return;
      }
      if (!url.startsWith("data:image/")) {
        note.textContent = "That file isn't an image.";
        return;
      }
      dlg.close();
      o.onSave(url);
    } catch {
      note.textContent = "The image could not be read.";
    }
  };

  const buttons = [];
  if (current !== "") {
    buttons.push({
      label: "Remove image",
      kind: "danger" as const,
      onClick: () => {
        dlg.close();
        o.onSave(undefined);
      },
    });
  }
  buttons.push({ label: "Cancel", kind: "secondary" as const, onClick: () => dlg.close() });
  const dlg = openDialog({ host: o.host, title: o.field.label, buttons });

  const pick = el("button", "ltk-cv-addbtn", "Choose an image…") as HTMLButtonElement;
  pick.type = "button";
  const fileIn = el("input") as HTMLInputElement;
  fileIn.type = "file";
  fileIn.accept = "image/*";
  fileIn.style.display = "none";
  fileIn.addEventListener("change", () => {
    const f = fileIn.files?.[0];
    if (f) void ingest(f);
  });
  pick.addEventListener("click", () => fileIn.click());

  const paste = el("div", "ltk-cv-pastezone", "…or paste an image here (Ctrl/Cmd+V)");
  paste.tabIndex = 0;
  paste.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    const item = items
      ? Array.from(items).find((i) => i.type.startsWith("image/"))
      : undefined;
    const f = item?.getAsFile();
    if (f) {
      e.preventDefault();
      void ingest(f);
    }
  });

  dlg.body.appendChild(pick);
  dlg.body.appendChild(fileIn);
  dlg.body.appendChild(paste);
  dlg.body.appendChild(note);
  paste.focus();
}

/** Yes/no as a dialog (rollup cells — the canvas card toggles inline). */
function yesnoDialog(o: CanvasFieldDialogOpts): void {
  const chk = checkItem(o.field.label);
  chk.box.checked = vBool(o.value);
  chk.wrap.classList.toggle("ltk-check-on", chk.box.checked);
  const dlg = openDialog({
    host: o.host,
    title: o.field.label,
    buttons: [
      { label: "Cancel", kind: "secondary" as const, onClick: () => dlg.close() },
      {
        label: "Save",
        kind: "primary" as const,
        onClick: () => {
          dlg.close();
          o.onSave(chk.box.checked);
        },
      },
    ],
  });
  dlg.body.appendChild(chk.wrap);
}

/** Rating as a dialog (rollup cells — the canvas card taps inline). */
function ratingDialog(o: CanvasFieldDialogOpts): void {
  let n = clampRating(vNumber(o.value) ?? 0);
  const stars = el("div", "ltk-cv-stars");
  const paint = () => {
    clear(stars);
    for (let k = 1; k <= 5; k++) {
      const star = el(
        "span",
        "ltk-cv-star" + (k <= n ? " ltk-cv-star-on" : ""),
        k <= n ? "★" : "☆"
      );
      star.addEventListener("click", () => {
        n = k === n ? 0 : k;
        paint();
      });
      stars.appendChild(star);
    }
  };
  paint();
  const dlg = openDialog({
    host: o.host,
    title: o.field.label,
    buttons: [
      { label: "Cancel", kind: "secondary" as const, onClick: () => dlg.close() },
      {
        label: "Save",
        kind: "primary" as const,
        onClick: () => {
          dlg.close();
          o.onSave(n <= 0 ? undefined : n);
        },
      },
    ],
  });
  dlg.body.appendChild(stars);
}

/** Typing types in dialog form (rollup cells — the canvas card edits
 *  these inline): text, longtext, number, decimal, percent, date,
 *  daterange, url. */
function typingDialog(o: CanvasFieldDialogOpts): void {
  const t = o.field.type;
  let read: () => CanvasValue | undefined;
  let body: HTMLElement;

  if (t === "longtext") {
    const ta = el("textarea", "ltk-cv-dlgtext") as HTMLTextAreaElement;
    ta.value = vString(o.value);
    body = ta;
    read = () => (ta.value.trim() === "" ? undefined : ta.value);
  } else if (t === "daterange") {
    const row = el("div", "ltk-cv-rangeedit");
    const start = el("input", "ltk-input") as HTMLInputElement;
    start.type = "date";
    const end = el("input", "ltk-input") as HTMLInputElement;
    end.type = "date";
    const cur = vRange(o.value);
    start.value = cur.start;
    end.value = cur.end;
    row.append(start, end);
    body = row;
    read = () =>
      start.value === "" && end.value === ""
        ? undefined
        : { start: start.value, end: end.value };
  } else {
    const input = el("input", "ltk-input") as HTMLInputElement;
    if (t === "number" || t === "decimal" || t === "percent") {
      input.type = "number";
      if (t !== "decimal") input.step = "1";
      const n = vNumber(o.value);
      input.value = n === undefined ? "" : String(n);
    } else if (t === "date") {
      input.type = "date";
      input.value = vString(o.value);
    } else {
      input.type = "text";
      input.value = vString(o.value);
    }
    body = input;
    read = () => {
      const s = input.value.trim();
      if (s === "") return undefined;
      if (t === "number") return Math.round(Number(s));
      if (t === "decimal") {
        const n = Number(s);
        return Number.isFinite(n) ? n : undefined;
      }
      if (t === "percent") {
        const n = Number(s);
        return Number.isFinite(n) ? clampPercent(n) : undefined;
      }
      return s;
    };
  }

  const dlg = openDialog({
    host: o.host,
    title: o.field.label,
    buttons: [
      { label: "Cancel", kind: "secondary" as const, onClick: () => dlg.close() },
      {
        label: "Save",
        kind: "primary" as const,
        onClick: () => {
          dlg.close();
          o.onSave(read());
        },
      },
    ],
  });
  dlg.body.appendChild(body);
  const firstInput = dlg.body.querySelector<HTMLElement>("input, textarea");
  if (firstInput) firstInput.focus();
}
