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
import { itemDetails, itemVersions, pagePreviewUrl, presignedUrls } from "./data";

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
  /** Open with the details pane EXPANDED (5I: collapsed is the default
   *  — the document speaks first; a task-list open, or a document held
   *  by the viewer, arrives with work to do and expands). The header's
   *  Details button toggles either way. */
  detailsOpen?: boolean;
  /** KIOSK mode (5I): the viewer IS the whole screen — a scanned share
   *  link in the field. No close button, no escape-away, no
   *  scrim-click dismissal: there is nowhere else to go. */
  solo?: boolean;
  /** Share this document (5I) — the screen owns the dialog (permalink +
   *  QR); the viewer only offers the button. */
  share?: () => void;
  /** Status value for this row ("" = none) + the screen's palette-aware
   *  chip renderer. A getter is re-read on every details repaint — a
   *  lifecycle command changes the status while the overlay is open,
   *  and the chip must follow it (Ben, 2026-08-04). */
  statusValue?: string | (() => string);
  statusChipFor?: (value: string) => HTMLElement;
  /** Hands the screen a repaint for the DETAILS pane — status chip,
   *  properties, version history — to call after a command changes the
   *  document. Distinct from control/lifecycle's registers, which only
   *  repaint their buttons. */
  register?: (repaint: () => void) => void;
  /** Favourite wiring (null/absent = viewer identity unknown). toggle
   *  resolves to the new state. */
  favorite?: { isFav: () => boolean; toggle: () => Promise<boolean> } | null;
  /**
   * Document control (Phase 4B), absent where a document is not meant to
   * be worked on. The screen owns the commands — it holds the permission
   * answers and the row refresh — so the viewer only paints what it is
   * told and calls back. `state` is re-read on each paint so the buttons
   * follow a check-out made from the register behind it.
   */
  control?: {
    /** `canEdit` is read on every repaint: a standard's editability
     *  follows its STAGE (draft/in-review yes, approved no), and a
     *  command can change the stage while the overlay is open — the
     *  buttons must appear/disappear without a reopen (Ben,
     *  2026-08-04). Absent = always editable. */
    state: () => {
      checkedOut: boolean;
      mine: boolean;
      by: string;
      canEdit?: boolean;
      /** May this user edit PROPERTIES right now (5H1)? Read per
       *  repaint, like canEdit — a check-out or a stage change flips
       *  it while the overlay is open. */
      canProps?: boolean;
      /** May this user REPLACE the content (5H3 — holds the check-out
       *  and a staging library is configured)? */
      canReplace?: boolean;
    };
    /** Hands the screen a repaint to call whenever it changes the
     *  document's state — a command runs through the screen's own
     *  dialogs, so the overlay cannot know it finished otherwise. */
    register?: (repaint: () => void) => void;
    checkOut: () => Promise<void>;
    checkIn: () => void;
    discard: () => void;
    /** Edit properties (5H1) — shown whenever state().canProps holds. */
    editProps?: () => void;
    /** Replace content (5H3) — shown whenever state().canReplace holds. */
    replace?: () => void;
    /** The SOURCE document's Office editor URL ("" = no editor) — the
     *  revision is edited here, as distinct from the PDF rendering
     *  (Ben, 2026-08-04). */
    editUrl?: string;
  } | null;
  /** Lifecycle commands (Phase 5B) — standards only. The screen decides
   *  WHICH commands the document's stage and this user's standing
   *  allow; the viewer paints buttons and calls back. */
  lifecycle?: {
    actions: () => { key: string; label: string; primary: boolean }[];
    run: (key: string) => void;
    register?: (repaint: () => void) => void;
  } | null;
}

function overlay(
  label: string,
  onClose?: () => void,
  right = false,
  solo = false
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
  // kiosk (5I): the overlay IS the screen — nothing dismisses it
  if (!solo) {
    document.addEventListener("keydown", onKey);
    scrim.addEventListener("pointerdown", (e) => {
      if (e.target === scrim) close();
    });
  }
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
  const { panel, close } = overlay(
    row.name,
    () => {
      if (blobUrl !== "") URL.revokeObjectURL(blobUrl);
    },
    true,
    opts.solo === true
  );
  panel.classList.add("app-docs-viewer");
  if (opts.solo === true) panel.classList.add("app-docs-viewer-solo");

  const head = el("div", "app-docs-viewhead");
  head.append(
    el("span", "app-docs-viewname", row.name),
    el(
      "span",
      "app-field-hint",
      [opts.libraryName, formatWhen(row.modified)].filter((s) => s !== "").join(" · ")
    )
  );
  // collapsed by default (5I): the document speaks first, the details
  // pane is a click away — and a share-link open IS this default
  let detailsOpen = opts.detailsOpen === true;
  const detailsBtn = el("button", "app-btn app-docs-detailstoggle", "") as HTMLButtonElement;
  head.appendChild(detailsBtn);
  if (opts.solo !== true) {
    const x = el("button", "app-btn app-docs-viewclose", "✕") as HTMLButtonElement;
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", close);
    head.appendChild(x);
  }
  panel.appendChild(head);

  const body = el("div", "app-docs-viewbody");
  panel.appendChild(body);
  const stage = el("div", "app-docs-viewstage");
  body.appendChild(stage);

  // ---- details pane ----------------------------------------------------
  const aside = el("aside", "app-docs-details");
  body.appendChild(aside);
  const paintDetails = () => {
    aside.style.display = detailsOpen ? "" : "none";
    detailsBtn.textContent = detailsOpen ? "Hide details" : "Details";
    detailsBtn.setAttribute("aria-expanded", String(detailsOpen));
  };
  detailsBtn.addEventListener("click", () => {
    detailsOpen = !detailsOpen;
    paintDetails();
  });
  paintDetails();

  const chips = el("div", "app-docs-detailchips");
  const paintChips = () => {
    clear(chips);
    chips.appendChild(fileTypeChip(row.ext));
    const sv =
      typeof opts.statusValue === "function" ? opts.statusValue() : (opts.statusValue ?? "");
    if (sv !== "" && opts.statusChipFor) chips.appendChild(opts.statusChipFor(sv));
  };
  paintChips();
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
  if (opts.share !== undefined) {
    const shareBtn = el("button", "app-btn", "Share…") as HTMLButtonElement;
    shareBtn.addEventListener("click", () => opts.share?.());
    actions.append(shareBtn);
  }
  // document control sits with the other actions, not in a menu: when a
  // document is checked out to you, checking it back in is the thing you
  // came here to do
  if (opts.control) {
    const ctl = opts.control;
    const outBtn = el("button", "app-btn") as HTMLButtonElement;
    const inBtn = el("button", "app-btn app-btn-primary", "Check in…") as HTMLButtonElement;
    const dropBtn = el("button", "app-btn", "Discard check-out") as HTMLButtonElement;
    const propsBtn =
      ctl.editProps !== undefined
        ? (el("button", "app-btn", "Edit properties…") as HTMLButtonElement)
        : null;
    const replaceBtn =
      ctl.replace !== undefined
        ? (el("button", "app-btn", "Replace content…") as HTMLButtonElement)
        : null;
    const held = el("span", "app-docs-heldby");
    const src =
      (ctl.editUrl ?? "") !== "" ? linkBtn("Edit source ↗", ctl.editUrl ?? "", false) : null;
    const paint = () => {
      const s = ctl.state();
      const canEdit = s.canEdit !== false;
      outBtn.textContent = "Check out";
      outBtn.style.display = canEdit && !s.checkedOut ? "" : "none";
      inBtn.style.display = canEdit && s.checkedOut && s.mine ? "" : "none";
      dropBtn.style.display = canEdit && s.checkedOut && s.mine ? "" : "none";
      if (propsBtn !== null) propsBtn.style.display = s.canProps === true ? "" : "none";
      if (replaceBtn !== null) replaceBtn.style.display = s.canReplace === true ? "" : "none";
      held.textContent = s.checkedOut && !s.mine ? `🔒 Checked out by ${s.by}` : "";
      held.style.display = held.textContent === "" ? "none" : "";
      if (src !== null) src.style.display = canEdit ? "" : "none";
    };
    outBtn.addEventListener("click", () => {
      outBtn.disabled = true;
      void ctl.checkOut().finally(() => {
        outBtn.disabled = false;
        paint();
      });
    });
    inBtn.addEventListener("click", () => ctl.checkIn());
    dropBtn.addEventListener("click", () => ctl.discard());
    propsBtn?.addEventListener("click", () => ctl.editProps?.());
    replaceBtn?.addEventListener("click", () => ctl.replace?.());
    paint();
    ctl.register?.(paint);
    actions.append(outBtn, inBtn, dropBtn, held);
    if (propsBtn !== null) actions.append(propsBtn);
    if (replaceBtn !== null) actions.append(replaceBtn);
    // the SOURCE, not the PDF: where a revision's edits actually happen
    if (src !== null) actions.append(src);
  }
  // lifecycle commands sit with the actions: a standard awaiting your
  // approval opens with Approve one click away
  if (opts.lifecycle) {
    const lc = opts.lifecycle;
    const box = el("div", "app-docs-lifebtns");
    const paint = () => {
      clear(box);
      for (const a of lc.actions()) {
        const b = el(
          "button",
          `app-btn${a.primary ? " app-btn-primary" : ""}`,
          a.label
        ) as HTMLButtonElement;
        b.addEventListener("click", () => lc.run(a.key));
        box.appendChild(b);
      }
      box.style.display = box.childElementCount > 0 ? "" : "none";
    };
    paint();
    lc.register?.(paint);
    actions.appendChild(box);
  }
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

  // reloadable: a lifecycle command adds a version and rewrites fields
  // while the overlay is open — the repaint re-runs the whole loader.
  // The generation guard drops a slow response overtaken by a newer one.
  let detailsGen = 0;
  const loadDetails = async () => {
    const gen = ++detailsGen;
    const details = await itemDetails(site, row);
    if (!propsBox.isConnected || gen !== detailsGen) return;
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
    if (!propsBox.isConnected || gen !== detailsGen) return;
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
  };
  void loadDetails();
  opts.register?.(() => {
    paintChips();
    void loadDetails();
  });

  // ---- preview ---------------------------------------------------------
  // one item lookup, started on first need
  let presignedOnce: ReturnType<typeof presignedUrls> | null = null;
  const presigned = () => (presignedOnce ??= presignedUrls(site, opts.driveId, row));

  /** The frame src the browser can always load: a presigned transform
   *  URL for office files, fetched-to-blob bytes for a PDF (its
   *  presigned URL is attachment-disposed, but it answers CORS `*`).
   *  "" = nothing cookie-free available. */
  /** Why the preview could not be built — shown under the placeholder so
   *  a blocked tenant is diagnosable without a browser console. */
  let previewWhy = "";

  const cookieFreeSrc = async (): Promise<string> => {
    const p = await presigned();
    if (p.error !== "") {
      previewWhy = `SharePoint refused the preview lookup: ${p.error.slice(0, 140)}`;
      return "";
    }
    if (row.ext !== "pdf") {
      const src = transformPdfUrl(p.thumbUrl, row.ext);
      if (src === "") previewWhy = "SharePoint returned no rendering for this file.";
      return src;
    }
    if (p.downloadUrl === "") {
      previewWhy = "SharePoint returned no download link for this file.";
      return "";
    }
    try {
      const res = await fetch(p.downloadUrl);
      if (!res.ok) {
        previewWhy = `Fetching the file answered ${res.status}.`;
        return "";
      }
      const bytes = await res.blob();
      if (blobUrl !== "") URL.revokeObjectURL(blobUrl);
      blobUrl = URL.createObjectURL(
        bytes.type === "application/pdf" ? bytes : new Blob([bytes], { type: "application/pdf" })
      );
      return blobUrl;
    } catch {
      // a player CSP connect-src could refuse the fetch
      previewWhy = "This app was not allowed to fetch the file bytes (browser policy).";
      return "";
    }
  };

  /**
   * Between the frame and the placeholder: the presigned page-one image.
   * An <img> is governed by the page's img-src, NOT connect-src — and it
   * is connect-src that stops the player fetching file bytes — so this
   * survives where the blob route cannot. Resolves null when the image
   * is unavailable or also refused.
   */
  const showImage = (src: string): Promise<HTMLImageElement | null> =>
    new Promise<HTMLImageElement | null>((resolve) => {
      const img = el("img", "app-docs-previmg") as HTMLImageElement;
      img.alt = `First page of ${row.name}`;
      img.addEventListener("load", () => resolve(img));
      img.addEventListener("error", () => resolve(null));
      img.src = src;
    });

  const pageImage = async (): Promise<HTMLImageElement | null> => {
    const p = await presigned();
    if (p.thumbUrl !== "") {
      const direct = await showImage(p.thumbUrl);
      if (direct) return direct;
    }
    return null;
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
    // the reason, when there is one: a preview that fails the same way
    // for every document is a tenant setting, not a broken file
    if (previewWhy !== "") ph.appendChild(el("div", "app-field-hint", previewWhy));
    stage.appendChild(ph);
  };

  /** The waiting state: a spinner, not a bare white box. It stays until
   *  the FRAME itself paints — resolving the URL is only half the wait,
   *  and the rendering service is the slower half (Ben, 2026-08-03). */
  const spinner = (): HTMLElement => {
    const box = el("div", "app-docs-prevload");
    box.append(el("div", "app-loading-spinner"), el("span", "", "Loading preview…"));
    return box;
  };
  /** Reveal `frame` once it loads, dropping `wait`; a frame that never
   *  fires load (a blocked host) leaves the spinner, which is honest. */
  const showWhenLoaded = (frame: HTMLIFrameElement, wait: HTMLElement) => {
    frame.style.visibility = "hidden";
    frame.addEventListener("load", () => {
      wait.remove();
      frame.style.visibility = "";
    });
  };

  const paintPreview = () => {
    clear(stage);
    stage.appendChild(spinner());
    void (async () => {
      const src = await cookieFreeSrc();
      if (!stage.isConnected) return;
      if (src === "") {
        const img = await pageImage();
        if (!stage.isConnected) return;
        clear(stage);
        if (img) {
          stage.appendChild(img);
          return;
        }
        // img-src refuses SharePoint's media host in the player, but
        // frame-src allows it — the same page image, framed. A frame
        // paints an image at its NATURAL size, so a sharp preview means
        // asking for twice the display size and scaling the frame back
        // down: same layout, two device pixels per CSS pixel (Ben,
        // 2026-08-02: "quite low res").
        const box = stage.getBoundingClientRect();
        const w = Math.max(320, Math.round(box.width));
        const h = Math.max(320, Math.round(box.height));
        // The requested box FITS the page inside it, so the tall limit
        // must be the loose one: the stage is wider than it is tall, and
        // asking for 2w x 2h let the height bind a portrait page and came
        // back at a third of the size. 2w by the service's ceiling makes
        // the WIDTH bind — the page fills the stage exactly, as before,
        // at twice the pixels, and the frame clips what runs past.
        const big = await pagePreviewUrl(site, opts.driveId, row, w * 2, 2048);
        if (!stage.isConnected) return;
        const p = await presigned();
        if (!stage.isConnected) return;
        const shotUrl = big !== "" ? big : p.thumbUrl;
        if (shotUrl !== "") {
          const shotBox = el("div", "app-docs-shotbox");
          const shot = el("iframe", "app-docs-viewshot") as HTMLIFrameElement;
          shot.title = `First page of ${row.name}`;
          if (big !== "") {
            shot.style.width = `${w * 2}px`;
            shot.style.height = `${h * 2}px`;
            shot.style.transform = "scale(0.5)";
          }
          const wait = spinner();
          showWhenLoaded(shot, wait);
          shot.src = shotUrl;
          shotBox.appendChild(shot);
          stage.append(wait, shotBox);
          return;
        }
        previewWhy += " The page image was refused as well.";
        paintPlaceholder();
        return;
      }
      clear(stage);
      const frame = el("iframe", "app-docs-viewframe") as HTMLIFrameElement;
      frame.title = row.name;
      const wait = spinner();
      showWhenLoaded(frame, wait);
      frame.src = src;
      stage.append(wait, frame);
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
