// The metadata field editors (extracted from the 4C add form for 5H1 —
// the edit-properties dialog builds the SAME form, prefilled). Every
// hard-won rule rides along: placeholders always carry value="" (a
// valueless <option> returns its TEXT — the JSON.parse("—") crash
// behind every "stuck" create, 2026-08-04); taxonomy options carry
// {label, termId} JSON and parse defensively; role-bound person columns
// search the owners & approvers pool (5G1); the dictionary's row order
// decides the form.

import { clear, el } from "../../../shared/ui/dom";
import { searchEntra } from "../store/people";
import { AddFieldValue, SiteColumn, SpField, sortByDictionary } from "./model";
import { POOL_ROLES, PeopleSource, poolPeopleSource } from "./accessGates";
import { fetchTermPaths } from "./sp";

/** Columns SharePoint manages itself — fine in a VIEW, nonsense in a
 *  form ("Checked out to" rendered as an editable person picker, Ben,
 *  2026-08-04). */
export const SYSTEM_FIELDS = new Set([
  "CheckoutUser",
  "Author",
  "Editor",
  "Modified",
  "Created",
  "FileLeafRef",
  "FileSizeDisplay",
]);

/** Field types the form can edit — VERBATIM from the verified 4C form:
 *  isTaxonomy (not a type-string match) and choices-present decide. */
export const editorKind = (f: SpField): AddFieldValue["kind"] | null => {
  if (SYSTEM_FIELDS.has(f.internal)) return null;
  if (f.isTaxonomy) return "taxonomy";
  if (f.type === "User" || f.type === "UserMulti") return "person";
  if (f.type === "DateTime") return "date";
  if (f.choices.length > 0) return "choice";
  if (f.type === "Text" || f.type === "Note") return "text";
  return null;
};

export interface BuiltEditor {
  field: SpField;
  kind: AddFieldValue["kind"];
  /** Current value; taxonomy holds {label, termId}. */
  read: () => AddFieldValue;
  isEmpty: () => boolean;
}

/** Prefill for one column (5H1's edit mode). */
export interface EditorInitial {
  /** text / choice / date (date as yyyy-mm-dd). */
  text?: string;
  people?: { email: string; name: string }[];
  term?: { label: string; termId: string };
}

export interface FieldEditorOpts {
  site: string;
  /** Cleared and repopulated. */
  box: HTMLElement;
  /** The library's live fields. */
  fields: SpField[];
  /** The library's configured columns (only `available` ones render). */
  columns: { internal: string; available: boolean }[];
  /** The site dictionary — labels, roles, term sets, and the ORDER. */
  dictBy: Map<string, SiteColumn>;
  /** Called on every value change (the caller's sync). */
  onChange: () => void;
  /** internal → starting value (absent = empty form, the add mode). */
  initial?: Map<string, EditorInitial>;
  /** The columns under their sub-headings (Part II S2). When provided
   *  it REPLACES the per-library `columns` selection: each group
   *  renders as a titled section, in the manager's order; a column
   *  the library does not carry is skipped as always. */
  sections?: { heading: string; columns: string[] }[];
}

export function buildFieldEditors(opts: FieldEditorOpts): BuiltEditor[] {
  const { box, dictBy, onChange: sync } = opts;
  const editors: BuiltEditor[] = [];
  clear(box);

  /** A placeholder option MUST carry an explicit empty value (the
   *  JSON.parse("—") lesson). */
  const placeholder = (sel: HTMLSelectElement, label: string) => {
    const o = el("option", "", label) as HTMLOptionElement;
    o.value = "";
    sel.appendChild(o);
  };
  const labelOf = (f: SpField): string => {
    const dictLabel = dictBy.get(f.internal)?.label ?? "";
    return dictLabel !== "" ? dictLabel : f.title;
  };
  // Part II S2: a section heading renders only once its section
  // actually yields an editor — a group whose columns this library
  // does not carry never shows an empty title
  let pendingHeading: string | undefined;
  const emittedHeadings = new Set<string>();
  const fieldRow = (label: string, control: HTMLElement) => {
    if (pendingHeading !== undefined && !emittedHeadings.has(pendingHeading)) {
      box.appendChild(el("div", "app-docs-addgroup", pendingHeading));
      emittedHeadings.add(pendingHeading);
    }
    pendingHeading = undefined;
    const wrap = el("div", "app-docs-addfield");
    wrap.appendChild(el("div", "app-field-label", label));
    wrap.appendChild(control);
    return wrap;
  };

  const byInternal = new Map(opts.fields.map((f) => [f.internal, f]));
  const available = new Map(
    opts.columns.filter((x) => x.available).map((x) => [x.internal, x])
  );
  // the sections decide membership and order when given (the manager's
  // groups); the legacy per-library ticks otherwise
  const walk: { internal: string; section: string }[] =
    opts.sections !== undefined
      ? opts.sections.flatMap((s) => s.columns.map((internal) => ({ internal, section: s.heading })))
      : sortByDictionary([...available.keys()], [...dictBy.keys()]).map((internal) => ({
          internal,
          section: "",
        }));
  // once any group exists, the ungrouped tail is a section too —
  // "Other" (Ben, 2026-08-10) — never a lone header over a flat form
  const hasNamed = opts.sections?.some((s) => s.heading !== "") === true;
  for (const { internal, section } of walk) {
    pendingHeading = section !== "" ? section : hasNamed ? "Other" : undefined;
    const f = byInternal.get(internal);
    if (f === undefined) continue;
    const kind = editorKind(f);
    if (kind === null) continue;
    const star = f.required ? " *" : "";
    const init = opts.initial?.get(internal);

    if (kind === "taxonomy") {
      const setId = dictBy.get(f.internal)?.termSetId || f.termSetId;
      if (setId === "") continue;
      const sel = el("select", "app-input") as HTMLSelectElement;
      placeholder(sel, "—");
      void fetchTermPaths(opts.site, setId).then((walk) => {
        for (const n of walk.nodes) {
          const o = el(
            "option",
            "",
            `${"  ".repeat(n.labels.length - 1)}${n.labels[n.labels.length - 1]}`
          ) as HTMLOptionElement;
          o.value = JSON.stringify({ label: n.labels[n.labels.length - 1], termId: n.id });
          sel.appendChild(o);
        }
        // prefill lands AFTER the options exist — matched by TERM ID,
        // so a renamed term still preselects
        if (init?.term !== undefined && init.term.termId !== "") {
          const want = init.term.termId.toLowerCase();
          for (const o of Array.from(sel.options)) {
            if (o.value === "") continue;
            try {
              const v = JSON.parse(o.value) as { termId?: string };
              if ((v.termId ?? "").toLowerCase() === want) {
                sel.value = o.value;
                break;
              }
            } catch {
              /* not our JSON — skip */
            }
          }
          sync();
        }
      });
      sel.addEventListener("change", sync);
      box.appendChild(fieldRow(labelOf(f) + star, sel));
      editors.push({
        field: f,
        kind,
        read: () => {
          let v = { label: "", termId: "" };
          if (sel.value !== "") {
            // defensive twin of the placeholder fix — a value that is
            // not our JSON must read as "nothing picked", never throw
            try {
              v = JSON.parse(sel.value) as { label: string; termId: string };
            } catch {
              v = { label: "", termId: "" };
            }
          }
          return {
            internal: f.internal,
            kind: "taxonomy",
            label: v.label,
            termId: v.termId,
            multi: f.type === "TaxonomyFieldTypeMulti",
          };
        },
        isEmpty: () => sel.value === "",
      });
      continue;
    }

    if (kind === "person") {
      // the app's one people pattern: debounced search with a sequence
      // guard. Role-bound columns (owner/approvers/reviewers) search
      // the OWNERS & APPROVERS pool, falling back to Entra with a hint.
      const multi = f.type === "UserMulti";
      const poolBound = POOL_ROLES.has(dictBy.get(f.internal)?.role ?? "");
      const source: Promise<PeopleSource> = poolBound
        ? poolPeopleSource()
        : Promise.resolve({
            restricted: false,
            hint: "",
            search: async (q: string) =>
              (await searchEntra(q)).map((h) => ({
                mail: h.mail,
                displayName: h.displayName,
              })),
          });
      const picked: { email: string; name: string }[] = [...(init?.people ?? [])];
      const pbox = el("div", "app-docs-ppl");
      const chips = el("div", "app-docs-pplchips");
      const search = el("input", "app-input") as HTMLInputElement;
      search.placeholder = multi ? "Search people to add…" : "Search for a person…";
      const hitsBox = el("div", "app-docs-pplhits");
      pbox.append(chips, search, hitsBox);
      if (poolBound) {
        void source.then((s) => {
          if (s.restricted) search.placeholder = "Search the owners & approvers group…";
          else if (s.hint !== "") pbox.appendChild(el("div", "app-field-hint", s.hint));
        });
      }
      const paintChips = () => {
        clear(chips);
        for (const p of picked) {
          const chip = el("span", "app-docs-pplchip");
          chip.appendChild(el("span", "", p.name));
          const off = el("button", "app-docs-pplchipx", "✕") as HTMLButtonElement;
          off.setAttribute("aria-label", `Remove ${p.name}`);
          off.addEventListener("click", () => {
            picked.splice(picked.indexOf(p), 1);
            paintChips();
            sync();
          });
          chip.appendChild(off);
          chips.appendChild(chip);
        }
        chips.style.display = picked.length > 0 ? "" : "none";
      };
      paintChips();
      const renderHits = (hits: { mail: string; displayName: string }[]) => {
        clear(hitsBox);
        for (const h of hits.filter((x) => x.mail !== "").slice(0, 8)) {
          const row = el("button", "app-docs-pplhit") as HTMLButtonElement;
          row.type = "button";
          row.append(
            el("span", "app-docs-pplhitname", h.displayName),
            el("span", "app-field-hint", h.mail)
          );
          row.addEventListener("click", () => {
            if (!multi) picked.length = 0;
            if (!picked.some((p) => p.email.toLowerCase() === h.mail.toLowerCase())) {
              picked.push({ email: h.mail, name: h.displayName });
            }
            search.value = "";
            clear(hitsBox);
            paintChips();
            sync();
          });
          hitsBox.appendChild(row);
        }
      };
      let searchSeq = 0;
      let timer = 0;
      search.addEventListener("input", () => {
        window.clearTimeout(timer);
        const q = search.value.trim();
        if (q === "") {
          clear(hitsBox);
          return;
        }
        timer = window.setTimeout(() => {
          const seq = ++searchSeq;
          void source.then((s) => s.search(q)).then(
            (hits) => {
              if (seq === searchSeq) renderHits(hits);
            },
            () => {
              if (seq !== searchSeq) return;
              clear(hitsBox);
              hitsBox.appendChild(el("div", "app-field-hint", "People search failed."));
            }
          );
        }, 350);
      });
      box.appendChild(fieldRow(labelOf(f) + star, pbox));
      editors.push({
        field: f,
        kind,
        read: () => ({ internal: f.internal, kind: "person", people: [...picked] }),
        isEmpty: () => picked.length === 0,
      });
      continue;
    }

    let control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (kind === "choice") {
      const sel = el("select", "app-input") as HTMLSelectElement;
      // explicit empty value, or "—" itself would be WRITTEN as the
      // chosen value — same defect as the taxonomy placeholder
      placeholder(sel, "—");
      for (const choice of f.choices) {
        const o = el("option", "", choice) as HTMLOptionElement;
        o.value = choice;
        sel.appendChild(o);
      }
      if (init?.text !== undefined && f.choices.includes(init.text)) sel.value = init.text;
      control = sel;
    } else if (kind === "date") {
      const inp = el("input", "app-input") as HTMLInputElement;
      inp.type = "date";
      if (init?.text !== undefined) inp.value = init.text;
      control = inp;
    } else if (f.type === "Note") {
      const ta = el("textarea", "app-input") as HTMLTextAreaElement;
      ta.rows = 2;
      if (init?.text !== undefined) ta.value = init.text;
      control = ta;
    } else {
      const inp = el("input", "app-input") as HTMLInputElement;
      if (init?.text !== undefined) inp.value = init.text;
      control = inp;
    }
    control.addEventListener("input", sync);
    control.addEventListener("change", sync);
    box.appendChild(fieldRow(labelOf(f) + star, control));
    editors.push({
      field: f,
      kind,
      read: () => ({ internal: f.internal, kind, text: control.value.trim() }),
      isEmpty: () => control.value.trim() === "",
    });
  }
  if (editors.length === 0) {
    box.appendChild(
      el("div", "app-field-hint", "This library has no editable columns configured.")
    );
  }
  sync();
  return editors;
}
