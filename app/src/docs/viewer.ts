// Standard Documents — the document viewer and properties overlays
// (plan Phase 2). New-tab is the PRIMARY open path (first-party, so
// cookie auth always works there); the in-overlay preview is
// progressive enhancement with the fallback visibly one click away.
// The preview FRAME uses presigned, cookie-free URLs — an iframe to
// SharePoint is a third-party context, and browsers withholding
// third-party cookies turn a cookie-authenticated frame into the AAD
// sign-in page, whose X-Frame-Options: DENY is the "content is
// blocked" panel (diagnosed 2026-07-29; see PresignedUrls in rows.ts).
// Working documents ask before opening for edit (the draft's UX).

import { el, clear } from "../../../shared/ui/dom";
import { markDialog, trapFocus } from "../focusTrap";
import {
  DocRow,
  extGlyph,
  formatWhen,
  pdfViewUrlFor,
  sourceUrlFor,
  transformPdfUrl,
} from "./rows";
import { itemDetails, itemVersions, presignedUrls } from "./data";

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

function overlay(
  label: string,
  onClose?: () => void
): {
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
    onClose?.();
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
  let blobUrl = "";
  const { panel, close } = overlay(row.name, () => {
    if (blobUrl !== "") URL.revokeObjectURL(blobUrl);
  });
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
  // is reachable only through the working-document "Work on it" path.
  // Two actions only (Ben, 2026-07-30): the rendered PDF's own toolbar
  // already offers print/save/download, so duplicating them here was
  // noise. A copied link travels to email or Teams equally well.
  const pdfUrl = pdfViewUrlFor(site, opts.driveId, row);
  const actions = el("div", "app-docs-viewactions");
  actions.append(linkBtn("Open PDF ↗", pdfUrl, true));
  const copy = el("button", "app-btn", "Copy PDF link") as HTMLButtonElement;
  copy.addEventListener("click", () => {
    void navigator.clipboard.writeText(pdfUrl).then(() => {
      copy.textContent = "Copied ✓";
      setTimeout(() => (copy.textContent = "Copy PDF link"), 1500);
    });
  });
  actions.append(copy);
  panel.appendChild(actions);

  // one item lookup, started on first need
  let presignedOnce: ReturnType<typeof presignedUrls> | null = null;
  const presigned = () => (presignedOnce ??= presignedUrls(site, opts.driveId, row));

  /** The frame src the browser can always load: a presigned transform
   *  URL for office files, fetched-to-blob bytes for a PDF (its
   *  presigned URL is attachment-disposed, but it answers CORS `*`).
   *  "" = nothing cookie-free available — fall back to the cookie path,
   *  which still works wherever third-party cookies still flow. */
  const cookieFreeSrc = async (): Promise<string> => {
    const p = await presigned();
    if (row.ext !== "pdf") return transformPdfUrl(p.thumbUrl, row.ext);
    if (p.downloadUrl === "") return "";
    try {
      const res = await fetch(p.downloadUrl);
      if (!res.ok) return "";
      const bytes = await res.blob();
      if (blobUrl !== "") URL.revokeObjectURL(blobUrl);
      blobUrl = URL.createObjectURL(
        bytes.type === "application/pdf" ? bytes : new Blob([bytes], { type: "application/pdf" })
      );
      return blobUrl;
    } catch {
      // a player CSP connect-src could refuse the fetch — cookie fallback
      return "";
    }
  };

  const paintPreview = () => {
    clear(stage);
    stage.appendChild(el("div", "app-loading-line", "Loading preview…"));
    void (async () => {
      const src = (await cookieFreeSrc()) || pdfUrl;
      clear(stage);
      const frame = el("iframe", "app-docs-viewframe") as HTMLIFrameElement;
      frame.src = src;
      frame.title = row.name;
      stage.appendChild(frame);
    })();
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
  /** Internal names (config order) of the columns ticked *available* in
   *  the library's settings — the ONLY properties shown when provided.
   *  Absent (library unknown for this row), every non-noise field
   *  renders, filtered by the skip set below. */
  columns?: string[];
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
    // configured libraries: exactly the ticked columns, in config order —
    // a reader should see the register's fields, not SharePoint's plumbing
    const shown: [string, string][] = opts.columns
      ? opts.columns
          .map((k): [string, string] => [k, details.values[k] ?? ""])
          .filter(([, v]) => v.trim() !== "")
      : Object.entries(details.values).filter(([k, v]) => v.trim() !== "" && !PROP_SKIP.has(k));
    for (const [k, v] of shown) {
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
    if (shown.length === 0) {
      body.appendChild(
        el(
          "div",
          "app-field-hint",
          "No properties to show — the library's settings choose which columns appear here."
        )
      );
    } else {
      body.appendChild(grid);
    }

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
