// Standard Documents — the document overlay (Vault V4 rebuild of the
// plan-Phase-2 viewer). Right-anchored panel: preview stage + a 340px
// details pane (chips, title, actions, PROPERTIES, VERSION HISTORY —
// the old separate properties dialog folded in here).
//
// New-tab stays the PRIMARY open path (first-party, so cookie auth
// always works there); the in-overlay preview is progressive
// enhancement. The preview FRAME uses presigned, cookie-free URLs — an
// iframe to SharePoint is a third-party context, and browsers
// withholding third-party cookies turn a cookie-authenticated frame
// into the AAD sign-in page, whose X-Frame-Options: DENY is the
// "content is blocked" panel (diagnosed 2026-07-29; see PresignedUrls
// in rows.ts). When nothing cookie-free is available the stage shows
// an honest placeholder, never a blocked frame.
// Working documents ask before opening for edit (the draft's UX).

import { el, clear } from "../../../shared/ui/dom";
import { markDialog, trapFocus } from "../focusTrap";
import { fileTypeChip } from "../../../shared/ui/format";
import {
  FILE_TYPE_HUES,
  fileTypeFamily,
  readableShade,
  tint,
} from "../../../shared/tokens";
import {
  DocRow,
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
  // ---- details-pane extras (Vault V4) — optional, so the board cards
  // keep calling with the basic shape ----------------------------------
  /** internal → display label overrides from the library config. */
  labels?: Record<string, string>;
  /** Columns holding links to other documents (values render as links). */
  linkColumns?: string[];
  /** Internal names (config order) ticked *available* in the library's
   *  settings — the ONLY properties shown when provided. Absent, every
   *  non-noise field renders (the skip set below). */
  columns?: string[];
  /** Status value for this row ("" = none) + the screen's palette-aware
   *  chip renderer. */
  statusValue?: string;
  statusChipFor?: (value: string) => HTMLElement;
  /** Favourite wiring (null/absent = viewer identity unknown). toggle
   *  resolves to the new state. */
  favorite?: { isFav: () => boolean; toggle: () => Promise<boolean> } | null;
}

function overlay(
  label: string,
  onClose?: () => void,
  right = false
): {
  panel: HTMLElement;
  close: () => void;
} {
  const scrim = el("div", `app-docs-scrim${right ? " app-docs-scrim-right" : ""}`);
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

export function openDocViewer(opts: ViewerOpts): void {
  const { site, row } = opts;
  let blobUrl = "";
  const { panel, close } = overlay(row.name, () => {
    if (blobUrl !== "") URL.revokeObjectURL(blobUrl);
  }, true);
  panel.classList.add("app-docs-viewer");

  const head = el("div", "app-docs-viewhead");
  head.append(
    el("span", "app-docs-viewname", row.name),
    el(
      "span",
      "app-field-hint",
      [opts.libraryName, formatWhen(row.modified)].filter((s) => s !== "").join(" · ")
    )
  );
  const x = el("button", "app-btn app-docs-viewclose", "✕") as HTMLButtonElement;
  x.setAttribute("aria-label", "Close");
  x.addEventListener("click", close);
  head.appendChild(x);
  panel.appendChild(head);

  const body = el("div", "app-docs-viewbody");
  panel.appendChild(body);
  const stage = el("div", "app-docs-viewstage");
  body.appendChild(stage);

  // ---- details pane ----------------------------------------------------
  const aside = el("aside", "app-docs-details");
  body.appendChild(aside);

  const chips = el("div", "app-docs-detailchips");
  chips.appendChild(fileTypeChip(row.ext));
  const statusValue = opts.statusValue ?? "";
  if (statusValue !== "" && opts.statusChipFor) {
    chips.appendChild(opts.statusChipFor(statusValue));
  }
  aside.appendChild(chips);
  aside.appendChild(el("div", "app-docs-detailtitle", row.name));
  const meta = [opts.libraryName, formatWhen(row.modified)].filter((s) => s !== "");
  if (meta.length > 0) aside.appendChild(el("div", "app-docs-detailmeta", meta.join(" · ")));

  // every reader action lands on the PDF rendering — the editable source
  // is reachable only through the working-document "Work on it" path.
  // Two actions only (Ben, 2026-07-30): the rendered PDF's own toolbar
  // already offers print/save/download, so duplicating them here was
  // noise. A copied link travels to email or Teams equally well.
  const pdfUrl = pdfViewUrlFor(site, opts.driveId, row);
  const actions = el("div", "app-docs-detailactions");
  actions.append(linkBtn("Open PDF ↗", pdfUrl, true));
  const copy = el("button", "app-btn", "Copy PDF link") as HTMLButtonElement;
  copy.addEventListener("click", () => {
    void navigator.clipboard.writeText(pdfUrl).then(() => {
      copy.textContent = "Copied ✓";
      setTimeout(() => (copy.textContent = "Copy PDF link"), 1500);
    });
  });
  actions.append(copy);
  if (opts.favorite) {
    const fav = opts.favorite;
    const favBtn = el("button", "app-btn app-docs-favbtn") as HTMLButtonElement;
    const paintFav = () => {
      favBtn.textContent = fav.isFav() ? "★ Favourited" : "☆ Add to favourites";
      favBtn.setAttribute("aria-pressed", String(fav.isFav()));
    };
    paintFav();
    favBtn.addEventListener("click", () => {
      favBtn.disabled = true;
      void fav.toggle().then(() => {
        favBtn.disabled = false;
        paintFav();
      });
    });
    actions.append(favBtn);
  }
  aside.appendChild(actions);

  // PROPERTIES + VERSION HISTORY (the old properties dialog, folded in)
  const propsBox = el("div", "app-docs-detailprops");
  propsBox.appendChild(el("div", "app-field-label", "Properties"));
  propsBox.appendChild(el("div", "app-loading-line", "Loading…"));
  aside.appendChild(propsBox);

  void (async () => {
    const details = await itemDetails(site, row);
    if (!propsBox.isConnected) return;
    clear(propsBox);
    propsBox.appendChild(el("div", "app-field-label", "Properties"));
    if (details.error !== "") {
      propsBox.appendChild(
        el("div", "app-field-hint", `Could not load properties: ${details.error}`)
      );
      return;
    }
    const labels = opts.labels ?? {};
    const linkCols = new Set(opts.linkColumns ?? []);
    // configured libraries: exactly the ticked columns, in config order —
    // a reader should see the register's fields, not SharePoint's plumbing
    const shown: [string, string][] = opts.columns
      ? opts.columns
          .map((k): [string, string] => [k, details.values[k] ?? ""])
          .filter(([, v]) => v.trim() !== "")
      : Object.entries(details.values).filter(
          ([k, v]) => v.trim() !== "" && !PROP_SKIP.has(k)
        );
    if (shown.length === 0) {
      propsBox.appendChild(
        el(
          "div",
          "app-field-hint",
          "No properties to show — the library's settings choose which columns appear here."
        )
      );
    } else {
      const grid = el("div", "app-docs-propgrid");
      for (const [k, v] of shown) {
        grid.appendChild(el("span", "app-docs-propkey", labels[k] ?? k));
        if (linkCols.has(k)) {
          const cell = el("span", "app-docs-propval app-docs-proplinks");
          for (const part of splitLinkedValues(v)) {
            if (/^https?:\/\//i.test(part)) {
              const a = el(
                "a",
                "app-docs-proplink",
                part.split("/").pop() || part
              ) as HTMLAnchorElement;
              a.href = part;
              a.target = "_blank";
              a.rel = "noopener";
              a.title = part;
              cell.appendChild(a);
            } else {
              // a reference rather than a URL (e.g. a document number) —
              // shown as-is; resolving it needs the linkage work later
              cell.appendChild(el("span", "app-docs-propref", part));
            }
          }
          grid.appendChild(cell);
        } else {
          grid.appendChild(el("span", "app-docs-propval", v));
        }
      }
      propsBox.appendChild(grid);
    }

    propsBox.appendChild(el("div", "app-field-label", "Version history"));
    const vres =
      details.id > 0 && row.listId !== ""
        ? await itemVersions(site, row.listId, details.id)
        : { versions: [], error: "item id unknown" };
    if (!propsBox.isConnected) return;
    if (vres.error !== "") {
      propsBox.appendChild(el("div", "app-field-hint", `History unavailable: ${vres.error}`));
      return;
    }
    if (vres.versions.length === 0) {
      propsBox.appendChild(el("div", "app-field-hint", "No versions recorded."));
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
    propsBox.appendChild(list);
  })();

  // ---- preview ---------------------------------------------------------
  // one item lookup, started on first need
  let presignedOnce: ReturnType<typeof presignedUrls> | null = null;
  const presigned = () => (presignedOnce ??= presignedUrls(site, opts.driveId, row));

  /** The frame src the browser can always load: a presigned transform
   *  URL for office files, fetched-to-blob bytes for a PDF (its
   *  presigned URL is attachment-disposed, but it answers CORS `*`).
   *  "" = nothing cookie-free available. */
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
      // a player CSP connect-src could refuse the fetch
      return "";
    }
  };

  /** No cookie-free source: an honest placeholder, never a frame that
   *  renders as "content is blocked" (Vault V4). */
  const paintPlaceholder = () => {
    const base = FILE_TYPE_HUES[fileTypeFamily(row.ext)];
    const ph = el("div", "app-docs-prevph");
    ph.style.background = tint(base, 0.92);
    const big = el("div", "app-docs-prevph-ext", row.ext === "" ? "FILE" : row.ext.toUpperCase());
    big.style.color = readableShade(base, 0.15);
    ph.append(
      big,
      el("div", "app-docs-prevph-note", "Preview unavailable"),
      el(
        "div",
        "app-field-hint",
        "Open PDF shows the document in its own tab, where sign-in always works."
      )
    );
    stage.appendChild(ph);
  };

  const paintPreview = () => {
    clear(stage);
    stage.appendChild(el("div", "app-loading-line", "Loading preview…"));
    void (async () => {
      const src = await cookieFreeSrc();
      if (!stage.isConnected) return;
      clear(stage);
      if (src === "") {
        paintPlaceholder();
        return;
      }
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
