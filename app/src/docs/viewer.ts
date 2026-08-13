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
import { fileTypeChip, statusChip as tonePill } from "../../../shared/ui/format";
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
  relativeHint,
  sourceUrlFor,
  transformPdfUrl,
} from "./rows";
import { itemDetails, itemVersions, pagePreviewUrl, presignedUrls } from "./data";
import {
  DOC_LINK_GROUP,
  DOC_LINK_RELS,
  DocLink,
  auditRowsFor,
  groupVersionsByMajor,
  parseDocLinks,
} from "./model";

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
  /** Document linking (relationships L1, Ben 2026-08-13): the pane
   *  only PROVIDES links — editing lives in Edit properties. When the
   *  column's value is the JSON shape it renders as its own grouped
   *  section, names switching the overlay via `open`; legacy free-text
   *  keeps the grid rendering. Absent (cards, kiosk) = names render
   *  still. */
  links?: {
    internal: string;
    open: (l: DocLink) => void;
    /** The DERIVED inbound view (L2): documents naming this one,
     *  already inverted into this pane's voice. `lagging` = the search
     *  road answered and the crawl may trail recent links. */
    derived?: () => Promise<{ links: DocLink[]; lagging: boolean }>;
  };
  /** Date columns (dictionary-derived): their values render in the
   *  app's one format ("5 Oct 2025") from the item's RAW ISO value —
   *  never re-parsed from locale display text, which is ambiguous. */
  dateColumns?: string[];
  /** Internal names (config order) ticked *available* in the library's
   *  settings — the ONLY properties shown when provided. Absent, every
   *  non-noise field renders (the skip set below). */
  columns?: string[];
  /** The columns under their sub-headings (Part II S2) — when provided
   *  the properties pane renders each group as a section, exactly as
   *  the add and edit dialogs do. Flattened, must equal `columns`. */
  sections?: { heading: string; columns: string[] }[];
  /** Version OPEN links are owner/controller-only (Ben, 2026-08-13):
   *  readers see the history cards, not the downloads. Absent (cards,
   *  kiosk) = hidden. Re-read per paint, like the control gates. */
  versionLinks?: () => boolean;
  /** internal → document-management role (O2). Lets the pane promote
   *  the identity roles (docType · documentId · status) to its own
   *  header line, collapse a same-value owner/approver pair, hint the
   *  review-due date, and render the boolean roles as statement chips
   *  — all of which then DROP from the properties grid. */
  roles?: Record<string, string>;
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

  // O1 (overlay polish, completing R3): the header carries the
  // document's IDENTITY — type chip · name · library·date — once, for
  // kiosk and full mode alike; the details pane no longer repeats it.
  // "Open in new tab ↗" lives here too: the pane's solid slot stays
  // reserved for decisions (R1) — and the kiosk keeps NO external
  // door, it is navigation-free by design.
  const pdfUrl = pdfViewUrlFor(site, opts.driveId, row);
  const head = el("div", "app-docs-viewhead");
  head.appendChild(fileTypeChip(row.ext));
  const titleBlock = el("div", "app-docs-viewtitle");
  const docName = el("div", "app-docs-viewdocname", row.name);
  docName.title = row.name;
  titleBlock.appendChild(docName);
  const context = [opts.libraryName, formatWhen(row.modified)]
    .filter((s) => s !== "")
    .join(" · ");
  if (context !== "") titleBlock.appendChild(el("div", "app-field-hint", context));
  head.appendChild(titleBlock);
  // collapsed by default (5I): the document speaks first, the details
  // pane is a click away — and a share-link open IS this default
  let detailsOpen = opts.detailsOpen === true;
  if (opts.solo !== true) {
    head.appendChild(linkBtn("Open in new tab ↗", pdfUrl, false));
    // R4: ONE close control — ✕ alone; the details door lives on the
    // pane itself
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
  // O1 (replacing the accent strip — a deliberate reversal of the D6
  // ask, decided 2026-08-10): EXPANDED, the door is a labelled
  // "Hide »" on the pane's own top row beside a quiet "Details"
  // caption; COLLAPSED, a neutral rail with "« Details" is the way
  // back in. The one solid accent stays the decisions' alone.
  // The kiosk is PURE preview (Ben, 2026-08-07): no details door at all.
  const edge = el("button", "app-docs-edgetoggle") as HTMLButtonElement;
  edge.append(
    el("span", "app-docs-edgeglyph", "«"),
    el("span", "app-docs-edgelabel", "Details")
  );
  edge.title = "Show details";
  edge.setAttribute("aria-label", "Show details");
  if (opts.solo !== true) body.appendChild(edge);
  const aside = el("aside", "app-docs-details");
  body.appendChild(aside);
  const paneHead = el("div", "app-docs-detailshead");
  const hideBtn = el("button", "app-docs-textlink", "Hide »") as HTMLButtonElement;
  hideBtn.setAttribute("aria-label", "Hide details");
  paneHead.append(el("span", "app-docs-detailscap", "Details"), hideBtn);
  aside.appendChild(paneHead);
  const paintDetails = () => {
    aside.style.display = detailsOpen ? "" : "none";
    edge.style.display = detailsOpen ? "none" : "";
    edge.setAttribute("aria-expanded", String(detailsOpen));
  };
  hideBtn.addEventListener("click", () => {
    detailsOpen = false;
    paintDetails();
  });
  edge.addEventListener("click", () => {
    detailsOpen = true;
    paintDetails();
  });
  paintDetails();

  // O2: the pane opens with the document-control IDENTITY line —
  // type · document id · status, from the mapped ROLES — with the
  // decision card directly under it. Values come from the register row
  // when it carries them, from the loaded details otherwise (the
  // details load repaints this line).
  const rolesMap = opts.roles ?? {};
  const internalForRole = (role: string): string | undefined =>
    Object.keys(rolesMap).find((k) => rolesMap[k] === role);
  let lastValues: Record<string, string> | null = null;
  const roleValue = (role: string): string => {
    const k = internalForRole(role);
    if (k === undefined) return "";
    const fromRow = (row.values[k] ?? "").trim();
    return fromRow !== "" ? fromRow : (lastValues?.[k] ?? "").trim();
  };
  const chips = el("div", "app-docs-detailchips");
  const paintChips = () => {
    clear(chips);
    const dt = roleValue("docType").split(";")[0].trim();
    if (dt !== "") chips.appendChild(el("span", "app-docs-chip", dt));
    const docId = roleValue("documentId");
    if (docId !== "") chips.appendChild(el("span", "app-docs-detaildocid", docId));
    const sv =
      typeof opts.statusValue === "function" ? opts.statusValue() : (opts.statusValue ?? "");
    if (sv !== "" && opts.statusChipFor) chips.appendChild(opts.statusChipFor(sv));
  };
  paintChips();
  aside.appendChild(chips);

  // R1/R2 (design review, 2026-08-08): the pane leads with a DECISION
  // ZONE when this viewer has a pending decision — the one solid accent
  // button in the pane lives there (or Open PDF is it, when nothing is
  // pending). Utilities are a fixed 4-up row; everything else tucks
  // into ⋯, so the flat button stack is gone but every action keeps a
  // home (the D4 action-parity rule still holds).
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
      // no decision pending: nothing solid — Open in new tab lives in
      // the header (O1), the accent stays reserved for decisions
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
  // A1: the audit view's mode survives detail repaints
  let auditOn = false;

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
    const labels = { ...(opts.labels ?? {}) };
    const linkCols = new Set(opts.linkColumns ?? []);
    // the links column is found by ROLE even when no actions were
    // passed (cards, kiosk) — the section then renders read-only
    const linksInternal =
      opts.links?.internal ??
      Object.entries(opts.roles ?? {}).find(([, r]) => r === "linkedDocuments")?.[0] ??
      "";
    // O2: the identity line reads from these too, now that they exist
    lastValues = details.values;
    paintChips();
    // R6: one date format app-wide — date columns re-render from the
    // raw ISO twin; a column whose ISO is absent keeps its display text
    // untouched (never guess at "5/10/2025")
    for (const k of opts.dateColumns ?? []) {
      const isoV = details.iso[k];
      if (isoV !== undefined && (details.values[k] ?? "").trim() !== "") {
        details.values[k] = formatDayMonthYear(isoV);
      }
    }
    // O2: the review-due date carries a humane distance beside the
    // absolute one — decoration in the value cell, never the fact
    const hintFor = new Map<string, string>();
    const reviewK = internalForRole("nextReviewDate");
    if (reviewK !== undefined) {
      const isoV = details.iso[reviewK];
      const hint = isoV !== undefined ? relativeHint(isoV) : "";
      if (hint !== "") hintFor.set(reviewK, hint);
    }
    // configured libraries: exactly the ticked columns, in config order —
    // a reader should see the register's fields, not SharePoint's plumbing
    // R3: the filename never repeats — the pane title carries it, so a
    // name column (or any column merely echoing the name) drops out
    const NAME_COLS = new Set(["FileLeafRef", "LinkFilename", "LinkFilenameNoMenu"]);
    const isNameEcho = ([k, v]: [string, string]) =>
      NAME_COLS.has(k) || v.trim() === row.name;
    // O2: the roles the pane renders ELSEWHERE leave the grid — the
    // identity line (docType · documentId · status) and the statement
    // chips (ackRequired, regulatorApproved) below it
    const ELSEWHERE = new Set(["docType", "documentId", "status", "ackRequired", "regulatorApproved"]);
    const dropped = new Set(
      Object.keys(rolesMap).filter((k) => ELSEWHERE.has(rolesMap[k]))
    );
    let shown: [string, string][] = (
      opts.columns
        ? opts.columns
            .map((k): [string, string] => [k, details.values[k] ?? ""])
            .filter(([, v]) => v.trim() !== "")
        : Object.entries(details.values).filter(
            ([k, v]) => v.trim() !== "" && !PROP_SKIP.has(k)
          )
    )
      .filter((e) => !isNameEcho(e))
      .filter(([k]) => !dropped.has(k));
    // O2: a document whose owner IS its (sole) approver shows one row —
    // the same rendered value twice teaches nothing. Display-only: the
    // gates keep comparing emails, never this text.
    const ownerK = internalForRole("owner");
    const apprK = internalForRole("approvers");
    if (ownerK !== undefined && apprK !== undefined) {
      const ov = shown.find(([k]) => k === ownerK)?.[1].trim() ?? "";
      const av = shown.find(([k]) => k === apprK)?.[1].trim() ?? "";
      if (ov !== "" && ov === av) {
        shown = shown.filter(([k]) => k !== apprK);
        labels[ownerK] = "Owner & approver";
      }
    }
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
      // Part II S2: group sub-headings section the pane exactly as they
      // section the add and edit dialogs. A heading renders only when
      // one of its columns actually has a value to show; once any group
      // exists, the ungrouped tail is a section too — "Other" (Ben,
      // 2026-08-10) — never a lone header over a flat list.
      const shownKeys = new Set(shown.map(([k]) => k));
      const headingFor = new Map<string, string>();
      const hasNamed = (opts.sections ?? []).some((s) => s.heading !== "");
      for (const s of opts.sections ?? []) {
        const withValues = s.columns.filter((k) => shownKeys.has(k));
        const heading = s.heading !== "" ? s.heading : hasNamed ? "Other" : "";
        if (heading !== "" && withValues.length > 0) {
          headingFor.set(withValues[0], heading);
        }
      }
      for (const [k, v] of shown) {
        // L1: a JSON-shaped links value leaves the grid for its own
        // section below; legacy text stays right here
        if (k === linksInternal && parseDocLinks(v) !== null) continue;
        const heading = headingFor.get(k);
        if (heading !== undefined) {
          grid.appendChild(el("span", "app-docs-propgroup", heading));
        }
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
          const cell = el("span", "app-docs-propval", v);
          const hint = hintFor.get(k);
          if (hint !== undefined) {
            cell.appendChild(el("span", "app-field-hint", ` · ${hint}`));
          }
          grid.appendChild(cell);
        }
      }
      propsBox.appendChild(grid);
    }

    // O2: the boolean roles as statement chips — quiet when they ask
    // nothing, loud (amber) only when they demand something. The
    // acknowledgement COUNT waits for the 5E ledger.
    const isYes = (v: string) => /^(yes|true|1)$/i.test(v.trim());
    const flags = el("div", "app-docs-flagchips");
    const ackK = internalForRole("ackRequired");
    const ackV = ackK !== undefined ? (details.values[ackK] ?? "").trim() : "";
    if (ackV !== "") {
      flags.appendChild(
        isYes(ackV)
          ? tonePill("Acknowledgement required", "amber")
          : el("span", "app-docs-chip", "No acknowledgement")
      );
    }
    const regK = internalForRole("regulatorApproved");
    const regV = regK !== undefined ? (details.values[regK] ?? "").trim() : "";
    if (regV !== "") {
      // the flag speaks WITH its evidence (Ben, 2026-08-14): amber
      // until the regulator's stamped copy is linked
      const flagLinks = parseDocLinks(details.values[linksInternal] ?? "") ?? [];
      const hasCopy = flagLinks.some((l) => l.rel === "regulatorCopy");
      flags.appendChild(
        !isYes(regV)
          ? el("span", "app-docs-chip", "Not regulator-approved")
          : hasCopy
            ? el("span", "app-docs-chip", "✓ Regulator-approved · copy linked")
            : tonePill("Regulator-approved — copy not linked", "amber")
      );
    }
    if (flags.children.length > 0) propsBox.appendChild(flags);

    // ---- L1: linked documents — grouped, uid-anchored ------------------
    if (linksInternal !== "") {
      const rawLinks = details.values[linksInternal] ?? "";
      const parsedLinks = parseDocLinks(rawLinks) ?? [];
      if (parsedLinks.length > 0) {
        const box = el("div", "app-docs-linksbox");
        box.appendChild(el("div", "app-docs-linkshead", "Linked documents"));
        for (const rel of DOC_LINK_RELS) {
          const group = parsedLinks.filter((l) => l.rel === rel);
          if (group.length === 0) continue;
          box.appendChild(el("div", "app-docs-linkgroup", DOC_LINK_GROUP[rel]));
          for (const l of group) {
            const rowEl = el("div", "app-docs-linkrow");
            const label = l.name !== "" ? l.name : l.uid;
            if (opts.links !== undefined) {
              const openBtn = el("button", "app-docs-linkname", label) as HTMLButtonElement;
              openBtn.title = "Open the linked document";
              openBtn.addEventListener("click", () => opts.links?.open(l));
              rowEl.appendChild(openBtn);
            } else {
              rowEl.appendChild(el("span", "app-docs-linkname app-docs-linkname-still", label));
            }
            if (l.docId !== "") rowEl.appendChild(el("span", "app-docs-linkdocid", l.docId));
            box.appendChild(rowEl);
          }
        }
        propsBox.appendChild(box);
      }
      // L2: the derived inbound view — appended as it resolves, marked
      // apart from what this document declared itself
      const derived = opts.links?.derived;
      if (derived !== undefined) {
        const dBox = el("div", "app-docs-linksbox");
        propsBox.appendChild(dBox);
        void derived().then(({ links: inbound, lagging }) => {
          if (!dBox.isConnected) return;
          const declared = new Set(parsedLinks.map((l) => `${l.uid.toLowerCase()}|${l.rel}`));
          const fresh = inbound.filter(
            (l) => !declared.has(`${l.uid.toLowerCase()}|${l.rel}`)
          );
          if (fresh.length === 0) return;
          if (parsedLinks.length === 0) {
            dBox.appendChild(el("div", "app-docs-linkshead", "Linked documents"));
          }
          for (const rel of DOC_LINK_RELS) {
            const group = fresh.filter((l) => l.rel === rel);
            if (group.length === 0) continue;
            dBox.appendChild(
              el("div", "app-docs-linkgroup", `${DOC_LINK_GROUP[rel]} · derived`)
            );
            for (const l of group) {
              const rowEl = el("div", "app-docs-linkrow");
              const openBtn = el(
                "button",
                "app-docs-linkname",
                l.name !== "" ? l.name : l.uid
              ) as HTMLButtonElement;
              openBtn.title = "Open the linking document";
              openBtn.addEventListener("click", () => opts.links?.open(l));
              rowEl.appendChild(openBtn);
              if (l.docId !== "") rowEl.appendChild(el("span", "app-docs-linkdocid", l.docId));
              dBox.appendChild(rowEl);
            }
          }
          if (lagging) {
            dBox.appendChild(
              el("div", "app-field-hint", "Found by search — recently added links can lag.")
            );
          }
        });
      }
    }


    // A1: owners/controllers may flip the history into the audit
    // view — the flat who · step · comment answer
    const verHeadRow = el("div", "app-docs-verheadrow");
    verHeadRow.appendChild(
      el("div", "app-field-label", auditOn ? "Audit view" : "Version history")
    );
    if (opts.versionLinks?.() === true) {
      const tog = el(
        "button",
        "app-docs-audittoggle",
        auditOn ? "Cards" : "Audit view"
      ) as HTMLButtonElement;
      tog.addEventListener("click", () => {
        auditOn = !auditOn;
        void loadDetails();
      });
      verHeadRow.appendChild(tog);
    }
    propsBox.appendChild(verHeadRow);
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
    // O3: one card per MAJOR — the milestones people mean by
    // "version" — each with its draft trail behind a disclosure. The
    // current group opens; the rest fold to a one-line summary.
    if (auditOn && opts.versionLinks?.() === true) {
      const rows = auditRowsFor(vres.versions);
      const table = el("div", "app-docs-audittable");
      table.append(
        el("span", "app-docs-audith", "When"),
        el("span", "app-docs-audith", "Who"),
        el("span", "app-docs-audith", "Step"),
        el("span", "app-docs-audith", "Comment")
      );
      for (const r of rows) {
        table.append(
          el("span", "app-docs-auditc", `${formatWhen(r.when)} · v${r.version}`),
          el("span", "app-docs-auditc", r.who),
          el("span", "app-docs-auditc app-docs-auditstep", r.step),
          el("span", "app-docs-auditc", r.comment)
        );
      }
      propsBox.appendChild(table);
      const csv = el("button", "app-btn app-docs-auditcsv", "Export CSV") as HTMLButtonElement;
      csv.addEventListener("click", () => {
        const esc = (x: string) => `"${x.replace(/"/g, '""')}"`;
        const text = [
          ["When", "Version", "Who", "Step", "Comment"].map(esc).join(","),
          ...rows.map((r) =>
            [r.when, r.version, r.who, r.step, r.comment].map(esc).join(",")
          ),
        ].join("\n");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
        a.download = `audit-${row.name.replace(/\.[^.]+$/, "")}-${new Date()
          .toISOString()
          .slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
      propsBox.appendChild(csv);
      return;
    }

    const groups = groupVersionsByMajor(vres.versions);
    const origin = (() => {
      try {
        return new URL(site).origin;
      } catch {
        return "";
      }
    })();
    const webPath = site.replace(origin, "").replace(/\/$/, "");
    /** Where a version opens: the current one through the Office WEB
     *  viewer (?web=1 — a raw file URL just downloads, Ben 2026-08-13);
     *  the _vti_history address otherwise (a NEW TAB — old versions
     *  have no web viewer, the download is SharePoint's limit, and the
     *  tab carries the user's own session). */
    const versionUrl = (v: (typeof vres.versions)[number]): string => {
      if (v.current) return origin === "" ? "" : `${origin}${row.serverUrl}?web=1`;
      const m = v.label.match(/^(\d+)\.(\d+)$/);
      const id = v.versionId > 0 ? v.versionId : m ? Number(m[1]) * 512 + Number(m[2]) : 0;
      if (id === 0 || origin === "") return "";
      const rel = row.serverUrl.startsWith(webPath)
        ? row.serverUrl.slice(webPath.length).replace(/^\//, "")
        : row.serverUrl.replace(/^\//, "");
      return `${site.replace(/\/$/, "")}/_vti_history/${id}/${rel}`;
    };
    const openLink = (v: (typeof vres.versions)[number]): HTMLElement | null => {
      // owner/controller-only (Ben, 2026-08-13): readers get the
      // cards, not the downloads
      if (opts.versionLinks?.() !== true) return null;
      const url = versionUrl(v);
      if (url === "") return null;
      const a = el("a", "app-docs-verlink", "Open ↗") as HTMLAnchorElement;
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      return a;
    };
    const commentEl = (comment: string): HTMLElement =>
      comment !== ""
        ? el("span", "app-docs-vercomment", `“${comment}”`)
        : el("span", "app-docs-vercomment app-docs-vernone", "No comment");
    const list = el("div", "app-docs-verlist");
    for (const g of groups) {
      const card = el("div", "app-docs-vercard");
      let open = g.current;
      let showAll = false;
      const paintCard = () => {
        clear(card);
        const head = el("button", "app-docs-verhead") as HTMLButtonElement;
        head.setAttribute("aria-expanded", String(open));
        head.append(
          el("span", "app-docs-vercaret", open ? "▾" : "▸"),
          el(
            "span",
            "app-docs-verlabel",
            g.head !== null ? `v${g.head.label}` : "In progress"
          ),
          g.current
            ? tonePill(g.head !== null ? "✓ Published · current" : "● Draft · current", "green")
            : g.head !== null
              ? el("span", "app-docs-chip", "Superseded")
              : g.drafts.some((d) => d.modStatus === 2)
                ? tonePill("Awaiting approval", "amber")
                : el("span", "app-docs-chip", "Draft"),
          el(
            "span",
            "app-docs-verwhen",
            formatWhen(g.head?.when ?? g.drafts[0]?.when ?? "")
          )
        );
        head.addEventListener("click", () => {
          open = !open;
          paintCard();
        });
        card.appendChild(head);
        const headMeta = el("div", "app-docs-vermeta");
        if (g.head !== null) {
          if (g.head.author !== "") headMeta.appendChild(el("span", "", g.head.author));
          headMeta.appendChild(commentEl(g.head.comment));
        }
        if (!open && g.drafts.length > 0) {
          headMeta.appendChild(
            el("span", "app-field-hint", `${g.drafts.length} draft${g.drafts.length === 1 ? "" : "s"}`)
          );
        }
        const headOpen = g.head !== null ? openLink(g.head) : null;
        if (headOpen !== null) headMeta.appendChild(headOpen);
        if (headMeta.children.length > 0) card.appendChild(headMeta);
        if (open && g.drafts.length > 0) {
          const trail = el("div", "app-docs-vertrail");
          const shown = showAll ? g.drafts : g.drafts.slice(0, 2);
          for (const d of shown) {
            const line = el("div", "app-docs-verdraft");
            // under moderation the word is the VERSION's own standing —
            // a published minor is reader-facing content, not a draft
            const word =
              d.modStatus === 0
                ? "published"
                : d.modStatus === 2
                  ? "awaiting approval"
                  : d.modStatus === 1
                    ? "rejected"
                    : "draft";
            line.append(
              el("span", "app-docs-verlabel", `v${d.label}`),
              el("span", "", d.author),
              el(
                "span",
                "app-field-hint",
                d.current && (d.modStatus === null || d.modStatus === undefined)
                  ? `${word} · current`
                  : word
              ),
              el("span", "app-docs-verwhen", formatWhen(d.when))
            );
            const a = openLink(d);
            if (a !== null) line.appendChild(a);
            line.title = d.comment !== "" ? d.comment : "No comment";
            trail.appendChild(line);
          }
          if (!showAll && g.drafts.length > 2) {
            const more = el(
              "button",
              "app-docs-textlink",
              `Show ${g.drafts.length - 2} more draft${g.drafts.length - 2 === 1 ? "" : "s"}…`
            ) as HTMLButtonElement;
            more.addEventListener("click", () => {
              showAll = true;
              paintCard();
            });
            trail.appendChild(more);
          }
          card.appendChild(trail);
        }
      };
      paintCard();
      list.appendChild(card);
    }
    propsBox.appendChild(list);
    // O3: restoring an old version is a LIFECYCLE act, never a raw
    // write — the pointer keeps the history honest about that
    if (groups.filter((g) => g.head !== null).length > 1) {
      propsBox.appendChild(
        el(
          "div",
          "app-field-hint",
          "Older versions restore through the lifecycle — Cancel revision mid-cycle, Reinstate after retirement."
        )
      );
    }
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
