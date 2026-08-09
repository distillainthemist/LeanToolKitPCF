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
  formatDayMonthYear,
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
  /** Date columns (dictionary-derived): their values render in the
   *  app's one format ("5 Oct 2025") from the item's RAW ISO value —
   *  never re-parsed from locale display text, which is ambiguous. */
  dateColumns?: string[];
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

/** Returns the CLOSE handle — the kiosk (5I) needs it: a re-scan
 *  remounts the route, and an overlay parked on document.body would
 *  otherwise outlive its screen and stack. */
export function openDocViewer(opts: ViewerOpts): () => void {
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

  // R3 (design review): the filename appears ONCE, in the pane title —
  // the header carries the context line (library · date). The kiosk
  // keeps the name up top: it has no details pane to carry it.
  const head = el("div", "app-docs-viewhead");
  if (opts.solo === true) head.appendChild(el("span", "app-docs-viewname", row.name));
  head.append(
    el(
      "span",
      "app-field-hint",
      [opts.libraryName, formatWhen(row.modified)].filter((s) => s !== "").join(" · ")
    )
  );
  // collapsed by default (5I): the document speaks first, the details
  // pane is a click away — and a share-link open IS this default
  let detailsOpen = opts.detailsOpen === true;
  if (opts.solo !== true) {
    // R4: ONE close control — ✕ alone; the details toggle moves to the
    // pane edge below
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
  // R4: the collapse toggle lives ON the pane edge — a slim strip
  // between preview and details, never mistakable for a dismiss.
  // The kiosk is PURE preview (Ben, 2026-08-07): no details door at all.
  const edge = el("button", "app-docs-edgetoggle") as HTMLButtonElement;
  if (opts.solo !== true) body.appendChild(edge);
  const aside = el("aside", "app-docs-details");
  body.appendChild(aside);
  const paintDetails = () => {
    aside.style.display = detailsOpen ? "" : "none";
    // too subtle as a bare chevron (Ben, 2026-08-08) — the collapsed
    // strip carries a vertical "Details" label so the pane's door is
    // findable, and the open strip still reads as a fold
    clear(edge);
    edge.appendChild(el("span", "app-docs-edgeglyph", detailsOpen ? "»" : "«"));
    if (!detailsOpen) edge.appendChild(el("span", "app-docs-edgelabel", "Details"));
    const label = detailsOpen ? "Hide details" : "Show details";
    edge.title = label;
    edge.setAttribute("aria-label", label);
    edge.setAttribute("aria-expanded", String(detailsOpen));
  };
  edge.addEventListener("click", () => {
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

  // R1/R2 (design review, 2026-08-08): the pane leads with a DECISION
  // ZONE when this viewer has a pending decision — the one solid accent
  // button in the pane lives there (or Open PDF is it, when nothing is
  // pending). Utilities are a fixed 4-up row; everything else tucks
  // into ⋯, so the flat button stack is gone but every action keeps a
  // home (the D4 action-parity rule still holds).
  const pdfUrl = pdfViewUrlFor(site, opts.driveId, row);
  const ctl = opts.control ?? null;
  const lc = opts.lifecycle ?? null;
  const decision = el("div", "app-docs-decision");
  const actions = el("div", "app-docs-detailactions");
  const held = el("span", "app-docs-heldby");

  /** Which non-primary lifecycle keys the decision card surfaced —
   *  the overflow menu offers the rest, never a duplicate. */
  let inCard = new Set<string>();

  const paintActions = () => {
    clear(decision);
    clear(actions);
    inCard = new Set();
    const s = ctl?.state() ?? null;
    const canEdit = s !== null && s.canEdit !== false;
    const heldMine = s?.checkedOut === true && s.mine === true;
    const lcActs = lc?.actions() ?? [];
    // EVERY primary act gets a card button (Ben, 2026-08-09: a draft
    // with no reviewers offers submit-for-review AND submit-for-
    // approval — review is optional there, and the second road was
    // hiding in ⋯). The FIRST keeps the one solid accent; the rest
    // render plain, so the design rule holds.
    const primaryActs = lcActs.filter((a) => a.primary);
    const primaryAct = primaryActs[0];
    const revisionAct = lcActs.find((a) => a.key === "requestRevision");
    held.textContent =
      s?.checkedOut === true && !s.mine ? `🔒 Checked out by ${s.by}` : "";
    held.style.display = held.textContent === "" ? "none" : "";

    const pending = primaryAct !== undefined || heldMine;
    decision.style.display = pending ? "" : "none";
    if (pending) {
      const heading =
        primaryAct?.key === "approve"
          ? "Awaiting your approval"
          : primaryAct?.key === "markReviewed"
            ? "Review due"
            : primaryAct !== undefined
              ? heldMine
                ? "Revision in progress"
                : "Needs revision"
              : "Checked out to you";
      decision.appendChild(el("div", "app-docs-decision-head", heading));
      decision.appendChild(linkBtn("Open PDF ↗", pdfUrl, false));
      // a revision-needed document's real next step is EDITING: the
      // check-out door belongs IN the card, or action parity breaks —
      // the pending branch used to swallow it entirely (Ben, 2026-08-08)
      if (
        primaryAct !== undefined &&
        primaryAct.key !== "approve" &&
        primaryAct.key !== "markReviewed" &&
        ctl !== null &&
        canEdit &&
        s?.checkedOut !== true
      ) {
        const outBtn = el("button", "app-btn", "Check out & edit") as HTMLButtonElement;
        outBtn.addEventListener("click", () => {
          outBtn.disabled = true;
          void ctl.checkOut().finally(() => paintActions());
        });
        decision.appendChild(outBtn);
      }
      // holding the revision, the EDIT door is the activity itself —
      // it must not hide in the ⋯ while the card asks for a submit
      if (
        heldMine &&
        primaryAct !== undefined &&
        primaryAct.key !== "approve" &&
        primaryAct.key !== "markReviewed" &&
        (ctl?.editUrl ?? "") !== ""
      ) {
        decision.appendChild(linkBtn("Edit source ↗", ctl?.editUrl ?? "", false));
      }
      for (const [i, act] of primaryActs.entries()) {
        const go = el(
          "button",
          i === 0 ? "app-btn app-btn-primary" : "app-btn",
          act.key === "approve" ? `✓ ${act.label}` : act.label
        ) as HTMLButtonElement;
        go.addEventListener("click", () => lc?.run(act.key));
        decision.appendChild(go);
        inCard.add(act.key);
      }
      if (heldMine && ctl !== null) {
        const inBtn = el(
          "button",
          `app-btn${primaryAct === undefined ? " app-btn-primary" : ""}`,
          "Check in…"
        ) as HTMLButtonElement;
        inBtn.addEventListener("click", () => ctl.checkIn());
        decision.appendChild(inBtn);
      }
      if (revisionAct !== undefined) {
        const rev = el("button", "app-btn", revisionAct.label) as HTMLButtonElement;
        rev.addEventListener("click", () => lc?.run(revisionAct.key));
        decision.appendChild(rev);
        inCard.add(revisionAct.key);
      }
      if (heldMine && ctl !== null) {
        // the quiet way out — a text link, not a button competing with
        // the decision itself. In a lifecycle (a standard mid-revision)
        // the honest name is the WORKFLOW's ("Cancel revision"), not
        // the mechanism's ("discard check-out").
        const drop = el(
          "button",
          "app-docs-textlink",
          lc !== null ? "Cancel revision…" : "Discard check-out"
        ) as HTMLButtonElement;
        drop.addEventListener("click", () => ctl.discard());
        decision.appendChild(drop);
      }
    } else {
      // no decision pending: Open PDF is the pane's one solid primary
      actions.appendChild(linkBtn("Open PDF ↗", pdfUrl, true));
      if (ctl !== null && canEdit && s?.checkedOut !== true) {
        const outBtn = el("button", "app-btn", "Check out") as HTMLButtonElement;
        outBtn.addEventListener("click", () => {
          outBtn.disabled = true;
          void ctl.checkOut().finally(() => {
            outBtn.disabled = false;
            paintActions();
          });
        });
        actions.appendChild(outBtn);
      }
    }
    actions.appendChild(held);
  };
  paintActions();
  ctl?.register?.(paintActions);
  lc?.register?.(paintActions);

  // the 4-up utility row: Copy link · Share · Favourite · ⋯ — fixed,
  // quiet, and identical whatever the document's state
  const util = el("div", "app-docs-utilrow");
  const copy = el("button", "app-btn", "Copy link") as HTMLButtonElement;
  copy.addEventListener("click", () => {
    void navigator.clipboard.writeText(pdfUrl).then(() => {
      copy.textContent = "Copied ✓";
      setTimeout(() => (copy.textContent = "Copy link"), 1500);
    });
  });
  util.appendChild(copy);
  if (opts.share !== undefined) {
    const shareBtn = el("button", "app-btn", "Share…") as HTMLButtonElement;
    shareBtn.addEventListener("click", () => opts.share?.());
    util.appendChild(shareBtn);
  }
  if (opts.favorite) {
    const fav = opts.favorite;
    const favBtn = el("button", "app-btn app-docs-favbtn") as HTMLButtonElement;
    const paintFav = () => {
      // compact star (the R1 mock's 4-up row) — the word rides the
      // accessible name, the glyph the visible one
      favBtn.textContent = fav.isFav() ? "★" : "☆";
      favBtn.title = fav.isFav() ? "Favourited — click to remove" : "Add to favourites";
      favBtn.setAttribute("aria-label", favBtn.title);
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
    util.appendChild(favBtn);
  }
  const moreBtn = el("button", "app-btn app-docs-utilmore", "⋯") as HTMLButtonElement;
  moreBtn.setAttribute("aria-label", "More actions");
  moreBtn.setAttribute("aria-haspopup", "menu");
  moreBtn.addEventListener("click", () => {
    const open = document.querySelector(".app-docs-panemenu");
    if (open !== null) {
      open.remove();
      return;
    }
    const menu = el("div", "app-docs-menu app-docs-panemenu");
    const closeMenu = () => {
      menu.remove();
      document.removeEventListener("pointerdown", onDoc, true);
      document.removeEventListener("keydown", onMenuKey, true);
    };
    const onDoc = (e: PointerEvent) => {
      if (!menu.contains(e.target as Node)) closeMenu();
    };
    // first Escape closes the menu, the second the overlay
    const onMenuKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeMenu();
      }
    };
    document.addEventListener("pointerdown", onDoc, true);
    document.addEventListener("keydown", onMenuKey, true);
    const item = (label: string, run: () => void) => {
      const b = el("button", "app-docs-menuitem", label) as HTMLButtonElement;
      b.addEventListener("click", () => {
        closeMenu();
        run();
      });
      menu.appendChild(b);
    };
    const s = ctl?.state() ?? null;
    if (s?.canProps === true && ctl?.editProps !== undefined) {
      item("Edit properties…", () => ctl.editProps?.());
    }
    if (s?.canReplace === true && ctl?.replace !== undefined) {
      item("Replace content…", () => ctl.replace?.());
    }
    if (ctl !== null && s !== null && s.canEdit !== false && (ctl.editUrl ?? "") !== "") {
      item("Edit source ↗", () => window.open(ctl.editUrl ?? "", "_blank", "noopener"));
    }
    for (const a of (lc?.actions() ?? []).filter((x) => !x.primary && !inCard.has(x.key))) {
      item(a.label, () => lc?.run(a.key));
    }
    if (menu.childElementCount === 0) {
      menu.appendChild(el("div", "app-field-hint", "No further actions."));
    }
    const r = moreBtn.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    document.body.appendChild(menu);
  });
  util.appendChild(moreBtn);

  aside.append(decision, actions, util);

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
    // R6: one date format app-wide — date columns re-render from the
    // raw ISO twin; a column whose ISO is absent keeps its display text
    // untouched (never guess at "5/10/2025")
    for (const k of opts.dateColumns ?? []) {
      const isoV = details.iso[k];
      if (isoV !== undefined && (details.values[k] ?? "").trim() !== "") {
        details.values[k] = formatDayMonthYear(isoV);
      }
    }
    // configured libraries: exactly the ticked columns, in config order —
    // a reader should see the register's fields, not SharePoint's plumbing
    // R3: the filename never repeats — the pane title carries it, so a
    // name column (or any column merely echoing the name) drops out
    const NAME_COLS = new Set(["FileLeafRef", "LinkFilename", "LinkFilenameNoMenu"]);
    const isNameEcho = ([k, v]: [string, string]) =>
      NAME_COLS.has(k) || v.trim() === row.name;
    const shown: [string, string][] = (
      opts.columns
        ? opts.columns
            .map((k): [string, string] => [k, details.values[k] ?? ""])
            .filter(([, v]) => v.trim() !== "")
        : Object.entries(details.values).filter(
            ([k, v]) => v.trim() !== "" && !PROP_SKIP.has(k)
          )
    ).filter((e) => !isNameEcho(e));
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
  return close;
}
