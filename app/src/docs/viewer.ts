// Standard Documents — the document viewer and properties overlays
// (plan Phase 2). New-tab is the PRIMARY open path (the code app is
// itself an iframe on apps.powerapps.com, and SharePoint's embed
// surfaces may refuse foreign frame-ancestors); the in-overlay preview
// is progressive enhancement with the fallback visibly one click away.
// Working documents ask before opening for edit (the draft's UX).

import { el, clear } from "../../../shared/ui/dom";
import { markDialog, trapFocus } from "../focusTrap";
import {
  DocRow,
  extGlyph,
  formatWhen,
  pdfDownloadUrlFor,
  pdfViewUrlFor,
  sourceUrlFor,
  thumbnailUrlFor,
} from "./rows";
import { itemDetails, itemVersions } from "./data";

interface ViewerOpts {
  site: string;
  row: DocRow;
  /** The owning library's drive; "" = unresolved, and the viewer falls
   *  back to SharePoint's own page (see pdfViewUrlFor). */
  driveId: string;
  /** Owning library's LeanBoard display name ("" unknown). */
  libraryName: string;
  /** true = working document: offer "work on it" before viewing. */
  askToWork: boolean;
}

function overlay(label: string): {
  panel: HTMLElement;
  close: () => void;
} {
  const scrim = el("div", "app-docs-scrim");
  const panel = el("div", "app-docs-dialog");
  markDialog(panel, label);
  scrim.appendChild(panel);
  document.body.appendChild(scrim);
  const untrap = trapFocus(panel);
  const close = () => {
    untrap();
    scrim.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey);
  scrim.addEventListener("pointerdown", (e) => {
    if (e.target === scrim) close();
  });
  return { panel, close };
}

function linkBtn(label: string, href: string, primary = false): HTMLAnchorElement {
  const a = el("a", `app-btn${primary ? " app-btn-primary" : ""}`, label) as HTMLAnchorElement;
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  return a;
}

export function openDocViewer(opts: ViewerOpts): void {
  const { site, row } = opts;
  const { panel, close } = overlay(row.name);
  panel.classList.add("app-docs-viewer");

  const head = el("div", "app-docs-viewhead");
  head.append(
    el("span", "app-docs-viewglyph", extGlyph(row.ext)),
    el("span", "app-docs-viewname", row.name),
    el(
      "span",
      "app-field-hint",
      [opts.libraryName, formatWhen(row.modified)].filter((s) => s !== "").join(" · ")
    )
  );
  const x = el("button", "app-btn app-docs-viewclose", "✕") as HTMLButtonElement;
  x.addEventListener("click", close);
  head.appendChild(x);
  panel.appendChild(head);

  const stage = el("div", "app-docs-viewstage");
  panel.appendChild(stage);

  // every reader action lands on the PDF rendering — the editable source
  // is reachable only through the working-document "Work on it" path
  const pdfUrl = pdfViewUrlFor(site, opts.driveId, row);
  const actions = el("div", "app-docs-viewactions");
  actions.append(
    linkBtn("Open PDF ↗", pdfUrl, true),
    linkBtn("Download PDF", pdfDownloadUrlFor(site, opts.driveId, row))
  );
  const copy = el("button", "app-btn", "Copy PDF link") as HTMLButtonElement;
  copy.addEventListener("click", () => {
    void navigator.clipboard.writeText(pdfUrl).then(() => {
      copy.textContent = "Copied ✓";
      setTimeout(() => (copy.textContent = "Copy PDF link"), 1500);
    });
  });
  const mail = linkBtn(
    "Email PDF link",
    `mailto:?subject=${encodeURIComponent(row.name)}&body=${encodeURIComponent(pdfUrl)}`
  );
  mail.target = "_self"; // mailto in a new tab leaves a blank window behind
  actions.append(copy, mail);
  panel.appendChild(actions);

  const paintPreview = () => {
    clear(stage);
    const frame = el("iframe", "app-docs-viewframe") as HTMLIFrameElement;
    // the same PDF the action buttons point at: for an office file this
    // is converted bytes straight into the browser's PDF viewer, which
    // is far lighter than loading SharePoint's whole embed page
    frame.src = pdfUrl;
    frame.title = row.name;
    // some hosts/tenants refuse to be framed by a foreign origin at all;
    // the page image always renders, so it is one click away rather than
    // a dead end (a cross-origin frame cannot be asked whether it painted)
    stage.appendChild(frame);
    const note = el("div", "app-field-hint app-docs-viewnote");
    note.append(document.createTextNode("Preview not showing? "));
    const asImage = el("button", "app-linklike", "Show page preview") as HTMLButtonElement;
    asImage.addEventListener("click", () => paintThumbnail());
    note.append(asImage, document.createTextNode(" · or Open PDF above."));
    stage.appendChild(note);
  };

  const paintThumbnail = () => {
    clear(stage);
    const img = el("img", "app-docs-viewimg") as HTMLImageElement;
    img.src = thumbnailUrlFor(site, row);
    img.alt = `First page of ${row.name}`;
    const note = el("div", "app-field-hint app-docs-viewnote");
    img.addEventListener("error", () => {
      img.remove();
      note.textContent = "No page preview available for this file — open it in SharePoint.";
    });
    note.append(document.createTextNode("Page one only. "));
    const back = el("button", "app-linklike", "Try the full preview") as HTMLButtonElement;
    back.addEventListener("click", () => paintPreview());
    note.appendChild(back);
    stage.append(img, note);
  };

  if (opts.askToWork) {
    // working documents: the draft's flow — ask before opening to edit
    const ask = el("div", "app-docs-viewask");
    ask.appendChild(el("div", "", `Work on “${row.name}”?`));
    // the one route to the editable source, and only for a library the
    // super admin typed as "working documents"
    const work = linkBtn("Work on it ↗", sourceUrlFor(site, row), true);
    work.addEventListener("click", close);
    const view = el("button", "app-btn", "Just view") as HTMLButtonElement;
    view.addEventListener("click", () => {
      ask.remove();
      paintPreview();
    });
    const btns = el("div", "app-docs-viewactions");
    btns.append(work, view);
    ask.appendChild(btns);
    stage.appendChild(ask);
  } else {
    paintPreview();
  }
}

interface PropsOpts {
  site: string;
  row: DocRow;
  /** internal → display label overrides from the library config. */
  labels: Record<string, string>;
  /** Internal names of columns holding links to other documents — their
   *  values render as clickable links, since navigating to them is the
   *  entire point of the column. */
  linkColumns?: string[];
}

/** Split a link-column's text into individual URLs / references.
 *  SharePoint renders multi-value and hyperlink columns as text, so the
 *  separator varies: newlines, semicolons or comma-space. */
export function splitLinkedValues(value: string): string[] {
  return value
    .split(/[\n;]+|,\s+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** Keys FieldValuesAsText returns that read as noise, not properties. */
const PROP_SKIP = new Set([
  "MetaInfo",
  "owshiddenversion",
  "FSObjType",
  "SortBehavior",
  "PermMask",
  "UniqueId",
  "ProgId",
  "ScopeId",
  "VirusStatus",
  "InstanceID",
  "Order",
  "WorkflowVersion",
  "GUID",
  "ParentVersionString",
  "ParentLeafName",
  "DocConcurrencyNumber",
  "StreamHash",
  "Restricted",
  "OriginatorId",
  "NoExecute",
  "ContentVersion",
  "AccessPolicy",
  "AppAuthor",
  "AppEditor",
  "SMTotalSize",
  "SMLastModifiedDate",
  "SMTotalFileStreamSize",
  "SMTotalFileCount",
  "ComplianceAssetId",
  "TriggerFlowInfo",
  "ContentType",
]);

export function openDocProperties(opts: PropsOpts): void {
  const { panel, close } = overlay(`${opts.row.name} — properties`);
  panel.classList.add("app-docs-props");
  const head = el("div", "app-docs-viewhead");
  head.append(el("span", "app-docs-viewname", `${opts.row.name} — properties & history`));
  const x = el("button", "app-btn app-docs-viewclose", "✕") as HTMLButtonElement;
  x.addEventListener("click", close);
  head.appendChild(x);
  panel.appendChild(head);
  const body = el("div", "app-docs-propsbody");
  panel.appendChild(body);
  body.appendChild(el("div", "app-loading-line", "Loading…"));

  void (async () => {
    const details = await itemDetails(opts.site, opts.row);
    clear(body);
    if (details.error !== "") {
      body.appendChild(el("div", "app-settings-note", `Could not load properties: ${details.error}`));
      return;
    }
    const linkCols = new Set(opts.linkColumns ?? []);
    const grid = el("div", "app-docs-propgrid");
    for (const [k, v] of Object.entries(details.values)) {
      if (v.trim() === "" || PROP_SKIP.has(k)) continue;
      grid.appendChild(el("span", "app-docs-propkey", opts.labels[k] ?? k));
      if (linkCols.has(k)) {
        const cell = el("span", "app-docs-propval app-docs-proplinks");
        for (const part of splitLinkedValues(v)) {
          if (/^https?:\/\//i.test(part)) {
            const a = el("a", "app-docs-proplink", part.split("/").pop() || part) as HTMLAnchorElement;
            a.href = part;
            a.target = "_blank";
            a.rel = "noopener";
            a.title = part;
            cell.appendChild(a);
          } else {
            // a reference rather than a URL (e.g. a document number) —
            // shown as-is; resolving it needs the linkage work in a later phase
            cell.appendChild(el("span", "app-docs-propref", part));
          }
        }
        grid.appendChild(cell);
      } else {
        grid.appendChild(el("span", "app-docs-propval", v));
      }
    }
    body.appendChild(grid);

    body.appendChild(el("div", "app-field-label", "Revision history"));
    const vres =
      details.id > 0 && opts.row.listId !== ""
        ? await itemVersions(opts.site, opts.row.listId, details.id)
        : { versions: [], error: "item id unknown" };
    if (vres.error !== "") {
      body.appendChild(el("div", "app-field-hint", `History unavailable: ${vres.error}`));
      return;
    }
    if (vres.versions.length === 0) {
      body.appendChild(el("div", "app-field-hint", "No versions recorded."));
      return;
    }
    const list = el("div", "app-docs-verlist");
    for (const v of vres.versions) {
      const line = el("div", "app-docs-verrow");
      line.append(
        el("span", "app-docs-verlabel", `v${v.label}${v.current ? " · current" : ""}`),
        el("span", "app-docs-verwhen", formatWhen(v.when)),
        el("span", "app-docs-vercomment", v.comment)
      );
      list.appendChild(line);
    }
    body.appendChild(list);
  })();
}
