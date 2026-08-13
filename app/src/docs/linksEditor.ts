// The links editor (relationships L1, revised per Ben 2026-08-13):
// linking is a PROPERTIES EDIT, so this widget lives inside the Edit
// properties dialog and contributes one form value on save — the pane
// only ever shows links. Add = an inline rel-choice + name search
// across the non-template registers; remove = ✕ per row. Untouched =
// writes nothing (the dialog's empty-fields rule).

import { el, clear } from "../../../shared/ui/dom";
import { DocLibrary } from "./docsStore";
import { DOC_LINK_GROUP, DOC_LINK_RELS, DocLink, parseDocLinks, serializeDocLinks } from "./model";
import { DocRow, buildRenderViewXml } from "./rows";
import { renderListPage } from "./data";

export interface LinksEditorOpts {
  site: string;
  /** Registers the picker searches (caller filters templates out). */
  libraries: DocLibrary[];
  /** The editing document's own uniqueId — never offered as a target. */
  selfUniqueId: string;
  /** The document-id role's internal name ("" = no id caching). */
  docIdInternal: string;
  /** The column's FULL current value (the dialog prefills over REST,
   *  so no feed-clipping risk). */
  initialRaw: string;
}

export interface LinksEditor {
  root: HTMLElement;
  /** The serialized value to write, or null when untouched (or when
   *  the column holds pre-linking text this editor must not clobber). */
  read: () => string | null;
}

export function buildLinksEditor(opts: LinksEditorOpts): LinksEditor {
  const root = el("div", "app-docs-linksbox");
  root.appendChild(el("div", "app-field-label", "Linked documents"));

  const parsed = parseDocLinks(opts.initialRaw);
  if (parsed === null && opts.initialRaw.trim() !== "") {
    // legacy free text predating managed links — never clobbered
    root.appendChild(
      el(
        "div",
        "app-field-hint",
        "This document's links column holds pre-linking text. It is left untouched — " +
          "managed links start once that text is moved or cleared."
      )
    );
    return { root, read: () => null };
  }

  const links: DocLink[] = parsed ?? [];
  let changed = false;
  const listBox = el("div", "app-docs-linksbox");
  root.appendChild(listBox);

  const paint = () => {
    clear(listBox);
    for (const rel of DOC_LINK_RELS) {
      const group = links.filter((l) => l.rel === rel);
      if (group.length === 0) continue;
      listBox.appendChild(el("div", "app-docs-linkgroup", DOC_LINK_GROUP[rel]));
      for (const l of group) {
        const rowEl = el("div", "app-docs-linkrow");
        rowEl.appendChild(
          el("span", "app-docs-linkname app-docs-linkname-still", l.name !== "" ? l.name : l.uid)
        );
        if (l.docId !== "") rowEl.appendChild(el("span", "app-docs-linkdocid", l.docId));
        const rm = el("button", "app-docs-linkrm", "✕") as HTMLButtonElement;
        rm.title = "Remove this link";
        rm.addEventListener("click", () => {
          const i = links.findIndex(
            (x) => x.uid.toLowerCase() === l.uid.toLowerCase() && x.rel === l.rel
          );
          if (i >= 0) {
            links.splice(i, 1);
            changed = true;
            paint();
          }
        });
        rowEl.appendChild(rm);
        listBox.appendChild(rowEl);
      }
    }
  };
  paint();

  // ---- the inline add area ----------------------------------------------
  const addBtn = el("button", "app-btn app-docs-linkadd", "＋ Link a document…") as HTMLButtonElement;
  const addArea = el("div", "app-docs-linkaddarea");
  addArea.style.display = "none";
  root.append(addBtn, addArea);
  let rel: DocLink["rel"] = "peer";
  addBtn.addEventListener("click", () => {
    addArea.style.display = addArea.style.display === "none" ? "" : "none";
    if (addArea.style.display === "") search.focus();
  });

  const relRow = el("div", "app-issue-kindrow");
  const relBtns = (["parent", "peer", "child"] as const).map((k) => {
    const b = el(
      "button",
      "app-issue-kind",
      k === "parent" ? "Parent" : k === "peer" ? "Related" : "Child"
    ) as HTMLButtonElement;
    b.type = "button";
    b.addEventListener("click", () => {
      rel = k;
      for (const x of relBtns) x.classList.remove("app-issue-kind-on");
      b.classList.add("app-issue-kind-on");
    });
    relRow.appendChild(b);
    return b;
  });
  relBtns[1].classList.add("app-issue-kind-on");
  const search = el("input", "app-input") as HTMLInputElement;
  search.placeholder = "Search documents by name…";
  const hits = el("div", "app-docs-linkhits");
  addArea.append(
    el("div", "app-field-hint", "How does the picked document relate to THIS one?"),
    relRow,
    search,
    hits
  );

  let timer = 0;
  search.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void look(), 300);
  });
  const look = async () => {
    clear(hits);
    const q = search.value.trim();
    if (q === "") return;
    const pages = await Promise.all(
      opts.libraries.map((l) =>
        renderListPage(
          opts.site,
          l.listId,
          buildRenderViewXml({
            nameWords: q.split(/\s+/),
            fields: opts.docIdInternal !== "" ? [opts.docIdInternal] : [],
            rowLimit: 6,
          })
        )
      )
    );
    let shown = 0;
    for (let i = 0; i < opts.libraries.length; i++) {
      const lib = opts.libraries[i];
      for (const hit of pages[i].rows as DocRow[]) {
        if (hit.uniqueId === opts.selfUniqueId || shown >= 12) continue;
        shown++;
        const b = el(
          "button",
          "app-docs-linkhit",
          `${hit.name} — ${lib.config.title || lib.name}`
        ) as HTMLButtonElement;
        b.type = "button";
        b.addEventListener("click", () => {
          links.push({
            uid: hit.uniqueId,
            rel,
            site: (lib.siteUrl ?? "") !== "" ? lib.siteUrl : opts.site,
            listId: lib.listId,
            name: hit.name,
            docId: opts.docIdInternal !== "" ? (hit.values[opts.docIdInternal] ?? "") : "",
          });
          changed = true;
          addArea.style.display = "none";
          search.value = "";
          clear(hits);
          paint();
        });
        hits.appendChild(b);
      }
    }
    if (shown === 0) hits.appendChild(el("div", "app-field-hint", "No documents match."));
  };

  return { root, read: () => (changed ? serializeDocLinks(links) : null) };
}
