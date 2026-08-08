// Standard Documents — the #/docs area (plan Phase 2): title bar with
// search, left navigation (All documents / per-library / the org tree
// from the term store), right document list. Browse mode reads list
// REST pages; any search text (and the All view) rides permission-
// trimmed site search. The viewer and properties overlays hang off rows.
//
// Org-tree nodes render from the term store but stay selection-disabled
// until a deployment maps crawled → managed properties (spike 3's
// lead-time item) — filtering that silently applied to loaded rows only
// would lie about the corpus.

import { el, clear } from "../../../shared/ui/dom";
import { fileTypeChip, statusChip as tonePill, withStatusGlyph } from "../../../shared/ui/format";
import { draggableRow } from "../../../shared/ui/dragList";
import { showLoading } from "../loading";
import { detectHost } from "../runtime";
import { paletteMap, resolvePaletteColor } from "../../../shared/palette";
import { textOn } from "../../../shared/tokens";
import { appPalettes } from "../store/config";
import {
  driveIdFor,
  listItemCount,
  renderListPage,
  searchPage,
  tileThumbFor,
} from "./data";
import { DocList, ListColumn, mountDocList } from "./listView";
import { mountDocTiles } from "./docsTiles";
import {
  DocRow,
  browseComparator,
  buildRenderViewXml,
  formatDayMonthYear,
  formatWhen,
  isNonCurrentStatus,
  pdfViewUrlFor,
  pickBrowseHead,
  splitNameForEllipsis,
  taxonomySearchProperty,
} from "./rows";
import { DocLibrary, docsConfig } from "./docsStore";
import {
  BasePermissions,
  LifecycleCommandDef,
  LifecycleStage,
  emptySiteDictionary,
  isDateColumn,
  lifecycleCommandsFor,
  paletteEntryFor,
  parseBasePermissions,
  siteKey,
  sortByDictionary,
  sortLibrariesForDisplay,
  spErrorText,
  stageOfTerm,
  termForStage,
  termsForStage,
} from "./model";
import { viewerInPool, viewerIsController } from "./accessGates";
import {
  TermNode,
  checkInFile,
  checkOutFile,
  fetchFileInfo,
  fetchLibraries,
  fetchListPermissions,
  fetchListRoot,
  cachedTermPaths,
  fetchTermsInSet,
  undoCheckOut,
} from "./sp";
import { openDialog } from "../../../shared/ui/dialog";
import { currentViewer } from "../runtime";
import { viewerPerson } from "../store/people";
import {
  docLinkUrl,
  docLinkUrlMobile,
  docLinkUrlWork,
  docsViewUrl,
  takePendingDocView,
  takePendingWorkDoc,
} from "../links";
import { rememberTaskCount } from "../taskBadge";
import { accessRequestPlan, notifyPlanFor } from "./notifyModel";
import {
  DocUiPrefs,
  DocView,
  FavDoc,
  decodeDocView,
  emptyDocUiPrefs,
  emptyDocView,
  encodeDocView,
  toCsv,
} from "./views";
import {
  deleteDocView,
  docPrefs,
  saveDocUi,
  saveDocView,
  toggleFavorite,
} from "./prefs";

// Applied by the next mount: saved-view clicks, the Favourites entry and
// library ticks re-mount the screen in place (the embedded pattern), and
// the state rides here rather than in the hash.
let pendingView: DocView | null = null;
let pendingFav = false;
let pendingLibs: string[] | null = null;
import { openDocViewer } from "./viewer";

const PAGE = 50;

/**
 * How many rows the header's match total may read per library. Core
 * fields only, so this is a small payload — but a library past the cap
 * would report a floor as if it were a total, and the header says
 * "so far" instead of overstating.
 */
const COUNT_CAP = 2000;

/**
 * How many content matches the index may contribute to one search.
 * CAML's `In` operator carries at most 500 values, and postquery returns
 * at most 500 rows a page — so 500 is both engines' natural ceiling.
 * Ranked by relevance, so a truncated set is the BEST content matches,
 * and the status line says when it truncated rather than implying the
 * answer was complete.
 */
const CONTENT_HITS = 500;

export interface DocsMountOpts {
  /** Inside the hub's Documents tab: no page title, and navigation
   *  re-mounts in place instead of writing the hash (a hash write would
   *  route away to the standalone #/docs screen). */
  embedded?: boolean;
  /** How many things await this viewer in Documents — reported whenever
   *  the tasks badge repaints, so the hub can carry the same number on
   *  its tab label. ONE selector feeds both, which is the R7 rule: two
   *  counters drift, and a badge nobody believes is worse than none. */
  onTaskCount?: (n: number) => void;
}

export function mountDocs(
  parent: HTMLElement,
  selected: string,
  opts: DocsMountOpts = {}
): () => void {
  const wrap = el("div", "app-docs-wrap");
  parent.appendChild(wrap);
  const stopLoading = showLoading(wrap);
  let dead = false;
  // document-level listeners this mount registers (Cmd/K, menu close) —
  // run on the returned cleanup AND on in-place remounts, or every
  // library click would stack another global listener
  const innerCleanups: (() => void)[] = [];

  void (async () => {
    // a bare dev server has no host — SDK calls would HANG, not reject
    if (!(await detectHost())) {
      stopLoading();
      if (dead) return;
      if (!opts.embedded) wrap.appendChild(el("h2", "app-docs-title", "Documents"));
      wrap.appendChild(
        el(
          "div",
          "app-settings-note",
          "Standard documents run in the hosted app (SharePoint and Dataverse live host-side)."
        )
      );
      return;
    }
    let cfg: Awaited<ReturnType<typeof docsConfig>>;
    let palettes: Awaited<ReturnType<typeof appPalettes>>;
    try {
      [cfg, palettes] = await Promise.all([docsConfig(), appPalettes()]);
    } catch (e) {
      stopLoading();
      if (dead) return;
      wrap.appendChild(
        el(
          "div",
          "app-settings-note",
          `Standard documents need the hosted app. ${String(e).slice(0, 160)}`
        )
      );
      return;
    }
    stopLoading();
    if (dead) return;

    const { app } = cfg;
    // display order everywhere libraries are listed: standards, working,
    // revision, records, templates — then by name (Ben, 2026-08-04)
    const libraries = sortLibrariesForDisplay(cfg.libraries);
    if (app.siteUrl === "" || libraries.length === 0) {
      if (!opts.embedded) wrap.appendChild(el("h2", "app-docs-title", "Documents"));
      wrap.appendChild(
        el(
          "div",
          "app-settings-note",
          "Standard documents haven't been set up yet — a super admin connects SharePoint " +
            "and picks the libraries under Settings → Documents."
        )
      );
      return;
    }

    const states = paletteMap(palettes.states);
    const byListId = new Map(libraries.map((l) => [l.listId.toLowerCase(), l]));
    /** The whole corpus LeanBoard can see — every exposed library, and
     *  the widest any query here is ever allowed to reach. */
    const allListIds = libraries.map((l) => l.listId);

    // a view to boot into: a saved-view click (module stash) or a shared
    // link's payload (launch param, consumed once)
    const bootRaw = takePendingDocView();
    const bootView: DocView | null =
      pendingView ?? (bootRaw !== "" ? decodeDocView(bootRaw) : null);
    pendingView = null;
    const favMode = pendingFav;
    pendingFav = false;

    const stashedLibs = pendingLibs;
    pendingLibs = null;

    const whoId = currentViewer()?.objectId ?? "";
    /** Who I am to SharePoint. Email, because that is what a person
     *  field carries back and what makes "checked out by me" reliable. */
    const myEmail = (currentViewer()?.email ?? "").toLowerCase();

    // ---- document control state (Phase 4B/4C) ---------------------------
    // Declared up here because the toolbar reads it synchronously while
    // it is being built; the commands themselves live further down.

    /** listId → what SharePoint says this user may do. Primed for the
     *  writable libraries at mount, so the kebab can answer instantly. */
    const permsByLib = new Map<string, BasePermissions>();

    const permsReady = Promise.all(
      libraries
        // standards included since 5C+: content edits ride check-out
        // while a standard is in a content stage (draft / in review)
        .filter(
          (l) => l.libType === "working" || l.libType === "revision" || l.libType === "standard"
        )
        .map(async (l) => {
          const r = await fetchListPermissions(app.siteUrl, l.listId);
          if (r.ok) permsByLib.set(l.listId.toLowerCase(), parseBasePermissions(r.data));
        })
    );

    /** One host for every command dialog, carrying the toolkit's colour
     *  variables — see .app-dlghost. Created once, reused, so nothing
     *  accumulates on the body. */
    const dialogHost = el("div", "app-dlghost");
    document.body.appendChild(dialogHost);
    innerCleanups.push(() => dialogHost.remove());

    /** The open document overlay's repaints, while one is open. A
     *  command run from the overlay changes state the overlay is
     *  showing, so it has to hear about it — discarding a check-out
     *  left "Check in…" sitting there otherwise (Ben, 2026-08-03). A
     *  SET since 5B: the control row and the lifecycle row each
     *  register their own. */
    const viewerRepaints = new Set<() => void>();

    const canWriteIn = (lib: DocLibrary | null | undefined): boolean =>
      lib != null &&
      (lib.libType === "working" || lib.libType === "revision") &&
      (permsByLib.get(lib.listId.toLowerCase())?.edit ?? false);

    /** Where check-out/check-in/discard are offered. Working and
     *  revision libraries always (4B); a STANDARD joins them while it is
     *  in a CONTENT stage — draft or in review — which is how a version
     *  update gets edited (Ben, 2026-08-04). Approved and
     *  awaiting-approval standards change only through lifecycle
     *  commands. */
    const canEditContent = (lib: DocLibrary | null | undefined, row: DocRow): boolean => {
      if (canWriteIn(lib)) return true;
      if (lib?.libType !== "standard") return false;
      if (!(permsByLib.get(lib.listId.toLowerCase())?.edit ?? false)) return false;
      const stage = stageOfRow(row);
      return stage === "draft" || stage === "inReview";
    };

    /** Mine by EMAIL. Display names collide, and two people called Ben
     *  would each be offered the other's check-in. */
    const isMine = (row: DocRow): boolean =>
      myEmail !== "" && (row.checkoutEmail ?? "") === myEmail;
    let favs: FavDoc[] = [];
    let savedViews: DocView[] = [];

    // ---- library selection (Vault V1: a ticked set, minimum one) -------
    // Presentation prefs ride the person's userprefs row (Ben's call:
    // Dataverse, so state follows them across devices). The read is the
    // same cached promise the favourites/views block awaits below — the
    // first Documents open of a session pays it once.
    let uiState: DocUiPrefs = emptyDocUiPrefs();
    if (whoId !== "") {
      uiState = await docPrefs(whoId).then(
        (p) => p.ui,
        () => emptyDocUiPrefs()
      );
      if (dead) return;
    }
    const validIds = new Set(allListIds.map((id) => id.toLowerCase()));
    const wantedIds: string[] =
      bootView !== null
        ? bootView.listId !== ""
          ? [bootView.listId]
          : allListIds
        : (stashedLibs ??
          (selected !== ""
            ? [selected]
            : uiState.libraries.length > 0
              ? uiState.libraries
              : allListIds));
    let selectedIds = wantedIds.filter((id) => validIds.has(id.toLowerCase()));
    if (selectedIds.length === 0) selectedIds = allListIds;
    const isSelected = (listId: string): boolean =>
      selectedIds.some((id) => id.toLowerCase() === listId.toLowerCase());
    const allSelected = selectedIds.length === allListIds.length;

    const current: DocLibrary | null =
      favMode || selectedIds.length !== 1
        ? null
        : (byListId.get(selectedIds[0].toLowerCase()) ?? null);

    // ---- what a column MEANS (C3) ---------------------------------------
    // Every question below used to be asked of `current`, which is null
    // the moment two libraries are ticked — so the union register lost
    // its status, owner and type columns entirely, and the data layer
    // stopped even requesting them (the plan's finding F2). A column's
    // meaning belongs to the site, so it is answered by the dictionary
    // and holds however many libraries are in view.
    const siteDict = app.sites[siteKey(app.siteUrl)] ?? emptySiteDictionary();
    const dictBy = new Map(siteDict.columns.map((c) => [c.internal, c]));
    /** The libraries whose rows can appear right now. */
    const viewLibs = (): DocLibrary[] =>
      scopeAll ? libraries : libraries.filter((l) => isSelected(l.listId));
    const roleOf = (internal: string): string => dictBy.get(internal)?.role ?? "";
    const labelOf = (internal: string): string => {
      const c = dictBy.get(internal);
      return c && c.label !== "" ? c.label : internal;
    };
    const internalForRole = (role: string): string =>
      siteDict.columns.find((c) => c.role === role)?.internal ?? "";
    const statusInternal = internalForRole("status");
    const ownerInternal = internalForRole("owner");
    const reviewInternal = internalForRole("nextReviewDate");
    const approversInternal = internalForRole("approvers");
    const reviewersInternal = internalForRole("reviewers");
    /** The edit-access GRANT column (5G3) — "" until the site maps one,
     *  and approve-request is withheld until it does. */
    const revEditorsInternal = internalForRole("revisionEditors");

    // ---- lifecycle commands (Phase 5B) ---------------------------------
    // Standards move between stages; everything here derives from the
    // row the register already holds. Stage: status label → term id →
    // mapped stage. Gates: person-column EMAILS (names collide), admin
    // standing fetched once.
    let meIsAdmin = false;
    /** Controllers-group membership (5G1) — merged into every admin
     *  gate BESIDE the Dataverse role. viewerIsController fails CLOSED,
     *  so an unreadable group never elevates anyone. */
    let meIsController = false;
    /** Pool membership (5G1): null = unknown (unlinked group or a
     *  failed lookup) — gates that hide affordances stay OPEN on
     *  unknown, SharePoint being the hard gate. */
    let meInPool: boolean | null = null;
    if (whoId !== "") {
      void viewerPerson(whoId).then(
        (p) => {
          meIsAdmin = p?.role === "superadmin" || p?.role === "siteadmin";
        },
        () => {}
      );
      void viewerIsController(whoId).then(
        (v) => {
          meIsController = v;
        },
        () => {}
      );
      void viewerInPool(whoId).then(
        (v) => {
          meInPool = v;
        },
        () => {}
      );
    }
    const docAdmin = () => meIsAdmin || meIsController;
    /** The status set's terms, id + real-cased label — filled by
     *  readStatusTerms; what termForStage resolves a write against. */
    const statusTermList: { id: string; label: string }[] = [];

    const stageOfRow = (row: DocRow): LifecycleStage | "" => {
      if (statusInternal === "") return "";
      const label = (row.values[statusInternal] ?? "").split(";")[0].trim().toLowerCase();
      if (label === "") return "";
      const id = labelToId.get(label);
      return id !== undefined ? stageOfTerm(siteDict, id) : "";
    };
    const lifecycleGatesFor = (row: DocRow) => {
      const emails = (col: string): string[] =>
        col === "" ? [] : (row.values[`${col}#email`] ?? "").split(";").filter((s) => s !== "");
      const approvers = emails(approversInternal);
      const owners = emails(ownerInternal);
      // an owner named as their own (sole) approver adds no second
      // step — their sign-off is already the mandatory finale, so only
      // approvers OUTSIDE the owner list create the endorse round and
      // submission otherwise goes straight to the owner's stage
      const outsideApprovers = approvers.filter((e) => !owners.includes(e));
      // reviewers named = the review round is mandatory; display text is
      // the fallback signal when the email projection is absent
      const hasReviewers =
        reviewersInternal !== "" &&
        (emails(reviewersInternal).length > 0 ||
          (row.values[reviewersInternal] ?? "").trim() !== "");
      return {
        isApprover: myEmail !== "" && approvers.includes(myEmail),
        hasApprovers: outsideApprovers.length > 0,
        hasReviewers,
        isOwner: myEmail !== "" && owners.includes(myEmail),
        isAdmin: docAdmin(),
        // a granted revision editor (5G3) — may drive THIS document's
        // next cycle, never sign anything off
        isEditor: myEmail !== "" && emails(revEditorsInternal).includes(myEmail),
      };
    };
    /** The commands this row offers this user — only ever for standards,
     *  and only commands whose target stage has a mapped, existing term. */
    const lifecycleActionsFor = (row: DocRow, lib: DocLibrary | null | undefined) => {
      if (lib?.libType !== "standard" || statusInternal === "") return [];
      // a document checked out to someone ELSE is theirs to move
      if ((row.checkoutName ?? "") !== "" && !isMine(row)) return [];
      return lifecycleCommandsFor(stageOfRow(row), lifecycleGatesFor(row)).filter(
        (c) => termForStage(siteDict, c.to, statusTermList) !== null
      );
    };
    const runLifecycle = (row: DocRow, cmd: LifecycleCommandDef) => {
      const target = termForStage(siteDict, cmd.to, statusTermList);
      if (target === null) return;
      // submit-for-review carries the reviewers picker: the submitter
      // may widen the circle, and the column is written before the move
      let reviewersPicker: { internal: string; existing: { email: string; name: string }[] } | undefined;
      if (cmd.key === "submitReview" && reviewersInternal !== "") {
        const names = (row.values[reviewersInternal] ?? "")
          .split(";")
          .map((s) => s.trim())
          .filter((s) => s !== "");
        const mails = (row.values[`${reviewersInternal}#email`] ?? "")
          .split(";")
          .filter((s) => s !== "");
        reviewersPicker = {
          internal: reviewersInternal,
          existing: mails.map((email, i) => ({ email, name: names[i] ?? email })),
        };
      }
      void import("./lifecycleCmds").then(({ openLifecycleCommand }) => {
        openLifecycleCommand({
          site: app.siteUrl,
          listId: row.listId,
          row,
          command: cmd,
          targetTerm: target,
          statusInternal,
          actorName: currentViewer()?.name ?? "",
          actingAsEditor: lifecycleGatesFor(row).isEditor,
          host: dialogHost,
          reviewersPicker,
          // the owner's Approve ends every grant on the document (5G3)
          grantRelease:
            revEditorsInternal !== ""
              ? { internal: revEditorsInternal, emails: grantEmails(row) }
              : undefined,
          // N2: who the next step is and what to say — the dialog's
          // done-state offers it; null = no panel at all
          notify:
            notifyPlanFor({
              commandKey: cmd.key,
              to: cmd.to,
              docName: row.name,
              actorName: currentViewer()?.name ?? "",
              roles: {
                owners: rolePeople(row, ownerInternal),
                approvers: rolePeople(row, approversInternal),
                reviewers: rolePeople(row, reviewersInternal),
                editors: rolePeople(row, revEditorsInternal),
              },
              myEmail,
              link: docLinkUrlWork(row.listId, row.id),
            }) ?? undefined,
          onDone: () => void refreshRow(row),
        });
      });
    };
    /** A person column's people — RLDAS keeps display names in the value
     *  and emails under "<col>#email", paired by position. */
    const rolePeople = (row: DocRow, internal: string): { name: string; email: string }[] => {
      if (internal === "") return [];
      const names = (row.values[internal] ?? "")
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s !== "");
      const mails = (row.values[`${internal}#email`] ?? "").split(";").filter((s) => s !== "");
      return mails.map((email, i) => ({ email, name: names[i] ?? email }));
    };
    /** Current grantee emails from the Revision editors column. */
    const grantEmails = (row: DocRow): string[] =>
      revEditorsInternal === ""
        ? []
        : (row.values[`${revEditorsInternal}#email`] ?? "").split(";").filter((s) => s !== "");

    /** Mark reviewed, offered on the ROW (overlay + kebab, Ben
     *  2026-08-04): an APPROVED standard with a review column, for its
     *  owner or an admin — due or not, an early review is still a
     *  review. The queue's button is the same dialog. */
    const canMarkReviewedRow = (row: DocRow, lib: DocLibrary | null | undefined): boolean => {
      if (lib?.libType !== "standard" || reviewInternal === "") return false;
      if (!lib.config.columns.some((c) => c.internal === reviewInternal)) return false;
      if (stageOfRow(row) !== "approved") return false;
      const g = lifecycleGatesFor(row);
      return g.isOwner || g.isAdmin;
    };
    /** Is the next review inside the task horizon (or past)? Decides
     *  whether Mark reviewed is the overlay's DECISION (R5) or just an
     *  overflow item — an early review is offered quietly, a due one
     *  loudly. */
    const reviewDue = (row: DocRow): boolean => {
      if (reviewInternal === "") return false;
      const iso = row.values[`${reviewInternal}.`] ?? "";
      const t = Date.parse(iso !== "" ? iso : (row.values[reviewInternal] ?? ""));
      return !Number.isNaN(t) && t <= Date.now() + REVIEW_HORIZON_DAYS * 86_400_000;
    };
    const openMarkReviewedRow = (row: DocRow) => {
      void import("./lifecycleCmds").then(({ openMarkReviewed }) => {
        openMarkReviewed({
          site: app.siteUrl,
          listId: row.listId,
          row,
          reviewInternal,
          host: dialogHost,
          onDone: () => void refreshRow(row),
        });
      });
    };

    /** Cancel revision (Ben, 2026-08-04): a mid-cycle standard the owner
     *  or an admin abandons — the last approved major is restored,
     *  content and status together. Not offered while someone ELSE
     *  holds the check-out. */
    const canCancelRevision = (row: DocRow, lib: DocLibrary | null | undefined): boolean => {
      if (lib?.libType !== "standard") return false;
      const stage = stageOfRow(row);
      if (
        stage !== "draft" &&
        stage !== "inReview" &&
        stage !== "inApproval" &&
        stage !== "inOwnerApproval"
      ) {
        return false;
      }
      if ((row.checkoutName ?? "") !== "" && !isMine(row)) return false;
      const g = lifecycleGatesFor(row);
      return g.isOwner || g.isAdmin;
    };
    const openCancelRevisionRow = (row: DocRow) => {
      void import("./lifecycleCmds").then(({ openCancelRevision }) => {
        openCancelRevision({
          site: app.siteUrl,
          row,
          host: dialogHost,
          heldByMe: isMine(row),
          // the restore reverts the grant column; seats/ledger follow
          grantRelease: { emails: grantEmails(row) },
          onDone: () => void refreshRow(row),
        });
      });
    };

    /** Request edit access (5G2): the road onto an approved standard
     *  for someone NOT named on it — the overlay offers it exactly
     *  where the lifecycle offers them nothing. State is fetched when
     *  such an overlay opens and repainted through viewerRepaints. */
    const myRequests = new Map<string, import("./accessRequests").AccessRequest | null>();
    const reqKey = (row: DocRow) => row.uniqueId.trim().toLowerCase();
    const canRequestAccess = (row: DocRow, lib: DocLibrary | null | undefined): boolean =>
      lib?.libType === "standard" &&
      whoId !== "" &&
      row.uniqueId !== "" &&
      stageOfRow(row) === "approved" &&
      lifecycleActionsFor(row, lib).length === 0;
    const requestAccessLabel = (row: DocRow): string => {
      const req = myRequests.get(reqKey(row));
      if (req == null) return "Request edit access…";
      if (req.granted !== undefined) return "Edit access granted ✓";
      return req.declined !== undefined ? "Edit access declined…" : "Edit access requested…";
    };
    const refreshRequestState = async (row: DocRow) => {
      const { myRequestFor } = await import("./accessRequests");
      const req = await myRequestFor(row.uniqueId, whoId).catch(() => null);
      myRequests.set(reqKey(row), req);
      for (const rp of viewerRepaints) rp();
    };
    /** Revoke edit access (5G3): the owner's early exit from a grant —
     *  offered wherever a grant is live and the viewer may end it. */
    const canRevokeAccess = (row: DocRow, lib: DocLibrary | null | undefined): boolean => {
      if (lib?.libType !== "standard" || revEditorsInternal === "") return false;
      if (grantEmails(row).length === 0) return false;
      const g = lifecycleGatesFor(row);
      return g.isOwner || g.isAdmin;
    };
    const openRevokeAccessRow = (row: DocRow, only?: { email: string; name: string }) => {
      const names = (row.values[revEditorsInternal] ?? "")
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s !== "");
      const mails = grantEmails(row);
      const all = mails.map((email, i) => ({ email, name: names[i] ?? email }));
      // a one-person revoke keeps every other grantee's access intact
      const revoked = only === undefined ? all : [only];
      const revokedSet = new Set(revoked.map((e) => e.email.toLowerCase()));
      void import("./accessRequests").then(({ openRevokeAccess }) => {
        openRevokeAccess({
          site: app.siteUrl,
          row,
          revEditorsInternal,
          editors: revoked,
          remaining: mails.filter((e) => !revokedSet.has(e.toLowerCase())),
          actorName: currentViewer()?.name ?? "",
          host: dialogHost,
          onDone: () => void refreshRow(row),
        });
      });
    };
    /** A grantee ending access they never used (Ben, 2026-08-06) — the
     *  relinquish half of the discard-releases rule. Confirmed, then the
     *  same self-release the discard path runs, with its own comment. */
    const openEndMyAccess = (row: DocRow) => {
      const dlg = openDialog({
        host: dialogHost,
        title: `End your edit access — ${row.name}?`,
        buttons: [
          { label: "Keep access", kind: "secondary", onClick: () => dlg.close() },
          {
            label: "End my access",
            kind: "danger",
            onClick: () => {
              dlg.close();
              void (async () => {
                const { endOwnGrant } = await import("./accessRequests");
                const warn = await endOwnGrant({
                  site: app.siteUrl,
                  row,
                  revEditorsInternal,
                  myEmail,
                  myName: currentViewer()?.name ?? "",
                  current: grantEmails(row),
                  comment: `Edit access relinquished by ${currentViewer()?.name ?? "the grantee"}`,
                }).catch((e) => `Your edit access was not ended: ${String(e).slice(0, 200)}`);
                if (warn !== "") commandFailed("Ending edit access", warn);
                await refreshRow(row);
                void refreshRequestState(row);
              })();
            },
          },
        ],
      });
      dlg.body.appendChild(
        el(
          "div",
          "app-field-hint",
          "Releases the grant without a revision — you can request again later."
        )
      );
    };
    const openRequestAccessRow = (row: DocRow) => {
      const existing = myRequests.get(reqKey(row)) ?? null;
      void import("./accessRequests").then(({ openRequestAccess }) => {
        openRequestAccess({
          doc: { listId: row.listId, itemId: row.id, uniqueId: row.uniqueId, name: row.name },
          owners: (row.values[`${ownerInternal}#email`] ?? "")
            .split(";")
            .filter((s) => s !== ""),
          viewer: { id: whoId, name: currentViewer()?.name ?? "", email: myEmail },
          host: dialogHost,
          existing,
          // ending unused access only makes sense while it is UNUSED —
          // once revising, the road out is Discard check-out
          onEndAccess:
            existing?.granted !== undefined && !isMine(row)
              ? () => openEndMyAccess(row)
              : undefined,
          onChanged: () => void refreshRequestState(row),
          // N3: the owners hear about the request straight away
          notify:
            accessRequestPlan({
              kind: "requested",
              docName: row.name,
              actorName: currentViewer()?.name ?? "",
              targets: rolePeople(row, ownerInternal),
              myEmail,
              link: docLinkUrlWork(row.listId, row.id),
            }) ?? undefined,
        });
      });
    };

    /** Edit properties (5H1): checked out to me → the writes ride the
     *  check-out; free → an auto bracket (working/revision writers;
     *  standards owner/controllers); held by someone else → not
     *  offered. */
    const canEditProps = (row: DocRow, lib: DocLibrary | null | undefined): boolean => {
      if (
        lib == null ||
        (lib.libType !== "working" && lib.libType !== "revision" && lib.libType !== "standard")
      ) {
        return false;
      }
      if ((row.checkoutName ?? "") !== "") return isMine(row);
      if (lib.libType === "standard") {
        const g = lifecycleGatesFor(row);
        return g.isOwner || g.isAdmin;
      }
      return permsByLib.get(row.listId.toLowerCase())?.edit ?? false;
    };
    const openEditPropertiesRow = (row: DocRow) => {
      const lib = byListId.get(row.listId);
      if (lib === undefined) return;
      void import("./editProperties").then(({ openEditProperties }) => {
        openEditProperties({
          site: app.siteUrl,
          row,
          lib,
          dictBy,
          host: dialogHost,
          heldByMe: isMine(row),
          onDone: () => void refreshRow(row),
        });
      });
    };

    /** The staging library resolved by TITLE (H2/H3) — undefined when
     *  unset or unresolvable; failures just withhold the option. */
    const resolveStaging = async (): Promise<
      { listId: string; openUrl: string } | undefined
    > => {
      if (app.stagingLibrary === "") return undefined;
      try {
        const libsRes = await fetchLibraries(app.siteUrl);
        const all =
          ((libsRes.data ?? {}) as { value?: { Id?: string; Title?: string }[] }).value ?? [];
        const hit = all.find(
          (l) => (l.Title ?? "").toLowerCase() === app.stagingLibrary.toLowerCase()
        );
        if (hit?.Id === undefined || hit.Id === "") return undefined;
        const rootRes = await fetchListRoot(app.siteUrl, hit.Id);
        const root = String(
          ((rootRes.data ?? {}) as { ServerRelativeUrl?: unknown }).ServerRelativeUrl ?? ""
        );
        if (root === "") return undefined;
        return { listId: hit.Id, openUrl: `${new URL(app.siteUrl).origin}${root}` };
      } catch {
        return undefined;
      }
    };
    /** Replace content (5H3): whoever HOLDS the check-out may swap the
     *  file — same rule as editing in Office; the check-in/discard
     *  discipline audits and reverts it. */
    const canReplaceContent = (row: DocRow, lib: DocLibrary | null | undefined): boolean =>
      lib != null &&
      (lib.libType === "working" || lib.libType === "revision" || lib.libType === "standard") &&
      app.stagingLibrary !== "" &&
      isMine(row);
    const openReplaceContentRow = (row: DocRow) => {
      void (async () => {
        const staging = await resolveStaging();
        if (staging === undefined) {
          commandFailed(
            "Replace content",
            `The staging library "${app.stagingLibrary}" could not be resolved — check ` +
              "Settings → Access control → Upload staging library."
          );
          return;
        }
        const { openReplaceContent } = await import("./replaceContent");
        openReplaceContent({
          site: app.siteUrl,
          row,
          staging,
          host: dialogHost,
          onDone: () => void refreshRow(row),
        });
      })();
    };

    /** The SOURCE document's Office editor — as distinct from the PDF
     *  (Ben, 2026-08-04). Only Office formats have one. */
    const editSourceUrl = (row: DocRow): string => {
      const office = new Set(["docx", "doc", "xlsx", "xls", "pptx", "ppt"]);
      if (!office.has(row.ext) || row.uniqueId === "") return "";
      return `${app.siteUrl}/_layouts/15/Doc.aspx?sourcedoc={${row.uniqueId}}&action=edit`;
    };
    /**
     * The register's columns: the view's own choice when there is one,
     * otherwise every column any library in view opens with — in
     * dictionary order, so two libraries never disagree about sequence.
     * A row whose library lacks a column simply shows nothing there.
     */
    const defaultInternals = (): string[] => {
      const libs = viewLibs();
      const wanted = new Set<string>();
      for (const lib of libs) {
        for (const c of lib.config.columns) if (c.inDefault) wanted.add(c.internal);
      }
      const out = siteDict.columns
        .filter((c) => c.available && wanted.has(c.internal))
        .map((c) => c.internal);
      // a site with no dictionary yet (nothing exposed) still browses
      return out.length > 0 ? out : [...wanted];
    };

    const persistUi = (patch: Partial<DocUiPrefs>) => {
      if (whoId === "") return;
      uiState = { ...uiState, ...patch };
      saveDocUi(whoId, uiState);
    };

    // ---- chrome: title, search, controls -------------------------------
    const top = el("div", "app-docs-top");
    if (!opts.embedded) top.appendChild(el("h2", "app-docs-title", "Documents"));
    const search = el("input", "app-input app-docs-search") as HTMLInputElement;
    search.type = "search";
    search.placeholder = favMode
      ? "Favourites"
      : current
        ? `Search ${current.config.title || current.name}…`
        : allSelected
          ? "Search all documents…"
          : `Search ${selectedIds.length} libraries…`;
    search.disabled = favMode;
    if (bootView) search.value = bootView.query;
    // (the Cmd/K shortcut and keycap badge were cut — Ben, 2026-08-01)
    const searchWrap = el("div", "app-docs-searchwrap");
    searchWrap.appendChild(search);

    // ---- scope + depth: one dropdown (Vault V2, finding 4) -------------
    // Scope picks the corpus — the ticked set or every exposed library,
    // NEVER the wider SharePoint (the app's standing corpus rule; the
    // Vault's "Everything (all sites)" option is deliberately not built).
    // Depth widens matching from names/titles to contents & every field.
    let scopeAll = false;
    let searchContents = bootView?.contents ?? false;
    const scopeBtn = el("button", "app-btn app-docs-scopebtn") as HTMLButtonElement;
    scopeBtn.title =
      "What to search: the libraries you have ticked, or every library " +
      "this site exposes — never the wider SharePoint.";
    const scopeLabel = (): string =>
      scopeAll || allSelected
        ? "All libraries"
        : current
          ? "This library"
          : "Selected libraries";
    const paintScopeBtn = () => {
      scopeBtn.textContent = `${scopeLabel()} ▾`;
    };
    paintScopeBtn();
    scopeBtn.addEventListener("click", () => {
      if (menu) {
        closeMenu();
        return;
      }
      menu = el("div", "app-docs-menu");
      const pick = (label: string, on: boolean, onPick: () => void) => {
        const b = el("button", "app-docs-menuitem", `${on ? "✓ " : ""}${label}`) as HTMLButtonElement;
        b.setAttribute("aria-pressed", String(on));
        b.addEventListener("click", () => {
          closeMenu();
          onPick();
        });
        menu!.appendChild(b);
      };
      if (!allSelected) {
        pick(current ? "This library" : "Selected libraries", !scopeAll, () => {
          scopeAll = false;
          paintScopeBtn();
          void load(true);
        });
      }
      pick("All libraries", scopeAll || allSelected, () => {
        scopeAll = true;
        paintScopeBtn();
        void load(true);
      });
      menu.appendChild(el("div", "app-docs-menusep", ""));
      const depth = el(
        "button",
        "app-docs-menuitem",
        `${searchContents ? "✓ " : ""}Match contents & every field`
      ) as HTMLButtonElement;
      depth.title =
        "Off, search matches document names and titles — how you look for " +
        "something you know exists. On, it ALSO matches what the index " +
        "reads inside each document, so it can only add results, never " +
        "take them away.";
      depth.addEventListener("click", () => {
        closeMenu();
        searchContents = !searchContents;
        void load(true);
      });
      menu.appendChild(depth);
      const r = scopeBtn.getBoundingClientRect();
      menu.style.top = `${r.bottom + 4}px`;
      menu.style.left = `${Math.max(8, r.right - 240)}px`;
      document.body.appendChild(menu);
    });

    // ---- My tasks (Phase 4D) -------------------------------------------
    // The V2 "Action needed" placeholder, live. A QUERY, not a store:
    // documents checked out to me (any exposed library) and documents I
    // own whose review date is due — both answered by SharePoint's own
    // columns via CAML <UserID/>, so there is no state to go stale and
    // nothing to sweep. Checking a document in makes it leave the list
    // because the list never existed anywhere else.
    const actionNeeded = el("button", "app-btn app-docs-actionneeded", "Document tasks") as HTMLButtonElement;
    actionNeeded.title = "Documents checked out to you, and your documents due for review";

    interface TaskRow {
      row: DocRow;
      libName: string;
      why: string;
      overdue: boolean;
    }
    /** Edit-access requests awaiting this user's decision (5G2) — the
     *  row is fetched live so a click opens the overlay armed; null row
     *  = the document has gone (the request row still offers Decline). */
    interface RequestTaskRow {
      req: import("./accessRequests").AccessRequest;
      row: DocRow | null;
      libName: string;
    }
    interface MyTasks {
      toApprove: TaskRow[];
      toReview: TaskRow[];
      held: TaskRow[];
      review: TaskRow[];
      requests: RequestTaskRow[];
      /** The viewer's OWN requests, every state — an outcome the
       *  requester never sees teaches nothing, and a granted row OPENS
       *  the document it granted (Ben, 2026-08-06). */
      outgoing: RequestTaskRow[];
      /** Grants THIS user presides over (owner emails, admins see all)
       *  — standing visibility with one-click revoke (Ben,
       *  2026-08-06): access nobody remembers granting is how an audit
       *  goes wrong. Info only, never counted on the badge. */
      grantedByMe: RequestTaskRow[];
    }
    /** "Near" for a review date: due within this many days counts. */
    const REVIEW_HORIZON_DAYS = 30;

    const fetchMyTasks = async (): Promise<MyTasks> => {
      const out: MyTasks = {
        toApprove: [],
        toReview: [],
        held: [],
        review: [],
        requests: [],
        outgoing: [],
        grantedByMe: [],
      };
      const nameOf = (l: DocLibrary) => l.config.title || l.name;
      /** every column the opened overlay's gates and chips lean on — a
       *  task row is one click from Approve, so it must arrive armed */
      const gateFields = [
        statusInternal,
        ownerInternal,
        approversInternal,
        reviewersInternal,
        revEditorsInternal,
      ].filter((f) => f !== "");
      /** …but ONLY the ones each library actually carries — an uncarried
       *  column is a guaranteed RLDAS 400 (the refreshRow lesson), and
       *  the grant column may exist on standards alone. */
      const gateFieldsFor = (l: DocLibrary): string[] => {
        const carried = new Set(l.config.columns.map((c) => c.internal));
        return gateFields.filter((f) => carried.has(f));
      };
      const labelsForStage = (stage: LifecycleStage): string[] => {
        const ids = new Set(termsForStage(siteDict, stage));
        return statusTermList
          .filter((t) => ids.has(t.id.trim().toLowerCase()))
          .map((t) => t.label);
      };
      const standards = libraries.filter((l) => l.libType === "standard");
      const carrying = (libs: DocLibrary[], ...cols: string[]) =>
        libs.filter((l) => {
          const set = new Set(l.config.columns.map((c) => c.internal));
          return cols.every((c) => set.has(c));
        });
      const jobs: Promise<void>[] = [];

      // checked out to me — any exposed library
      for (const l of libraries) {
        jobs.push(
          (async () => {
            const page = await renderListPage(
              app.siteUrl,
              l.listId,
              buildRenderViewXml({
                checkedOutToMe: true,
                fields: ["CheckoutUser", ...gateFieldsFor(l)],
                rowLimit: 30,
              })
            );
            for (const row of page.rows) {
              // the group title + pill say WHAT; why carries only extras
              out.held.push({ row, libName: nameOf(l), why: "", overdue: false });
            }
          })()
        );
      }

      // the two circulations (5C) — symmetric, standards only. Approval
      // matches approvers OR owner (two queries, deduped): the queue
      // must agree with the gate, and the owner always retains sign-off.
      const inReviewLabels = statusInternal !== "" ? labelsForStage("inReview") : [];
      const inApprovalLabels = statusInternal !== "" ? labelsForStage("inApproval") : [];
      if (reviewersInternal !== "" && inReviewLabels.length > 0) {
        for (const l of carrying(standards, reviewersInternal, statusInternal)) {
          jobs.push(
            (async () => {
              const page = await renderListPage(
                app.siteUrl,
                l.listId,
                buildRenderViewXml({
                  personIsMe: reviewersInternal,
                  termFilters: [{ cols: [statusInternal], labels: inReviewLabels }],
                  fields: gateFieldsFor(l),
                  rowLimit: 30,
                })
              );
              for (const row of page.rows) {
                out.toReview.push({ row, libName: nameOf(l), why: "", overdue: false });
              }
            })()
          );
        }
      }
      // approval is TWO steps (Ben, 2026-08-04): approvers see the
      // endorsement stage, the owner sees the final-word stage — each
      // queue keys on its own stage, so the sequence enforces itself
      const inOwnerLabels = statusInternal !== "" ? labelsForStage("inOwnerApproval") : [];
      const seen = new Set<string>();
      const approvalQueue = (col: string, labels: string[]) => {
        if (col === "" || labels.length === 0) return;
        for (const l of carrying(standards, col, statusInternal)) {
          jobs.push(
            (async () => {
              const page = await renderListPage(
                app.siteUrl,
                l.listId,
                buildRenderViewXml({
                  personIsMe: col,
                  termFilters: [{ cols: [statusInternal], labels }],
                  fields: gateFieldsFor(l),
                  rowLimit: 30,
                })
              );
              for (const row of page.rows) {
                const key = row.uniqueId !== "" ? row.uniqueId : `${row.listId}:${row.id}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.toApprove.push({ row, libName: nameOf(l), why: "", overdue: false });
              }
            })()
          );
        }
      };
      approvalQueue(approversInternal, inApprovalLabels);
      approvalQueue(ownerInternal, inOwnerLabels);
      // admins stand in at either step, but a queue of everyone else's
      // approvals would drown them — admins act from the register

      // edit-access requests (5G2): entries whose OWNER emails include
      // me — plus everything for doc admins, the deadlock breaker when
      // an owner is away (request volume is small, unlike approvals)
      jobs.push(
        (async () => {
          const { readLedger } = await import("./accessRequests");
          const ledger = await readLedger();
          const outgoingEntries = ledger.filter((e) => e.who.id === whoId);
          const iPreside = (e: (typeof ledger)[number]) =>
            docAdmin() || e.owners.some((o) => o.toLowerCase() === myEmail);
          const mine = ledger.filter(
            (e) => e.declined === undefined && e.granted === undefined && iPreside(e)
          );
          // live grants this user presides over — standing visibility
          // with one-click revoke (their own grants stay in `outgoing`)
          const presided = ledger.filter(
            (e) => e.granted !== undefined && e.who.id !== whoId && iPreside(e)
          );
          // one live-row fetch covers EVERY queue — a request row (any
          // side) opens the document overlay armed
          type Entry = (typeof ledger)[number];
          const need = [...mine, ...outgoingEntries, ...presided];
          const byList = new Map<string, Entry[]>();
          for (const e of need) {
            const k = e.listId.toLowerCase();
            byList.set(k, [...(byList.get(k) ?? []), e]);
          }
          const rowFor = new Map<string, DocRow>(); // listIdLower:itemId
          const libFor = new Map<string, DocLibrary>();
          for (const [k, entries] of byList) {
            const l = byListId.get(k);
            if (l === undefined) continue;
            libFor.set(k, l);
            const ids = [...new Set(entries.map((e) => e.itemId).filter((n) => n > 0))];
            if (ids.length === 0) continue;
            const page = await renderListPage(
              app.siteUrl,
              l.listId,
              buildRenderViewXml({ idIn: ids, fields: gateFieldsFor(l), rowLimit: 30 })
            ).catch(() => ({ rows: [] as DocRow[] }));
            for (const r of page.rows) rowFor.set(`${k}:${r.id}`, r);
          }
          const taskRowOf = (e: Entry): RequestTaskRow => {
            const k = e.listId.toLowerCase();
            return {
              req: e,
              row: rowFor.get(`${k}:${e.itemId}`) ?? null,
              libName: libFor.has(k) ? nameOf(libFor.get(k)!) : "",
            };
          };
          out.requests = mine.map(taskRowOf);
          out.outgoing = outgoingEntries.map(taskRowOf);
          out.grantedByMe = presided.map(taskRowOf);
        })()
      );

      // review due — my standards, date within the horizon. Scoped to
      // the APPROVED stage where the site maps one (5D): a retired or
      // mid-revision standard has no periodic review to chase.
      if (reviewInternal !== "" && ownerInternal !== "") {
        const approvedLabels = statusInternal !== "" ? labelsForStage("approved") : [];
        for (const l of carrying(standards, reviewInternal, ownerInternal)) {
          const scoped =
            approvedLabels.length > 0 &&
            l.config.columns.some((c) => c.internal === statusInternal);
          jobs.push(
            (async () => {
              const page = await renderListPage(
                app.siteUrl,
                l.listId,
                buildRenderViewXml({
                  personIsMe: ownerInternal,
                  dueWithinDays: { col: reviewInternal, days: REVIEW_HORIZON_DAYS },
                  termFilters: scoped
                    ? [{ cols: [statusInternal], labels: approvedLabels }]
                    : undefined,
                  fields: [reviewInternal, ...gateFieldsFor(l)],
                  rowLimit: 30,
                })
              );
              for (const row of page.rows) {
                // the ISO twin ("Column.") is the real value; the display
                // text is a site-locale guess we only fall back to
                const iso = row.values[`${reviewInternal}.`] ?? "";
                const disp = row.values[reviewInternal] ?? "";
                const t = Date.parse(iso !== "" ? iso : disp);
                const when = Number.isNaN(t)
                  ? disp
                  : formatDayMonthYear(new Date(t).toISOString());
                const overdue = !Number.isNaN(t) && t < Date.now();
                // the pill says overdue-or-due (R6); why carries the
                // date alone, in the app's one format ("7 Aug 2026")
                out.review.push({ row, libName: nameOf(l), why: when, overdue });
              }
            })()
          );
        }
      }

      await Promise.all(jobs);
      return out;
    };

    /** ONE selector for the badge AND the panel (R7, design review
     *  2026-08-08): the count is exactly the rows the panel paints —
     *  the earlier badge filtered outgoing news by seen-state while the
     *  panel painted everything, and the two drifted (11 vs 13). One
     *  number, one meaning: "items in your Document tasks". */
    const taskCount = (t: MyTasks) =>
      t.toApprove.length +
      t.toReview.length +
      t.held.length +
      t.review.length +
      t.requests.length +
      t.outgoing.length +
      t.grantedByMe.length;
    const taskVisible = (t: MyTasks) => taskCount(t) > 0;

    let tasksBadgeGen = 0;
    const paintTasksBadge = (n: number) => {
      actionNeeded.textContent = n > 0 ? `Document tasks · ${n}` : "Document tasks";
      actionNeeded.classList.toggle("app-docs-actionneeded-hot", n > 0);
      // the hub's tab label carries the same number, live while the app
      // is open and from the remembered value on the next launch
      opts.onTaskCount?.(n);
      rememberTaskCount(whoId, n);
    };
    /** Recounted in the background — at mount, and after every command
     *  that can change the answer (check-out/in/discard, add, lifecycle). */
    const refreshTasksBadge = () => {
      const gen = ++tasksBadgeGen;
      void fetchMyTasks().then((t) => {
        if (dead || gen !== tasksBadgeGen) return;
        paintTasksBadge(taskCount(t));
      });
    };
    // (the first count is fired from the mount tail, once the status
    // vocabulary has arrived — see the note there)

    actionNeeded.addEventListener("click", () => {
      const scrim = el("div", "app-docs-tasksscrim");
      const panel = el("div", "app-docs-taskspanel");
      const closePanel = () => {
        scrim.remove();
        document.removeEventListener("keydown", onTasksKey, true);
      };
      const onTasksKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          closePanel();
        }
      };
      document.addEventListener("keydown", onTasksKey, true);
      scrim.addEventListener("pointerdown", (e) => {
        if (e.target === scrim) closePanel();
      });
      const r = actionNeeded.getBoundingClientRect();
      panel.style.top = `${r.bottom + 6}px`;
      panel.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
      const bodyEl = el("div", "app-docs-tasksbody");
      const head = el("div", "app-docs-taskshead", "Document tasks");
      // a decision made elsewhere (another person, another tab) shows
      // up without closing and reopening the panel (Ben, 2026-08-06)
      const refreshBtn = el("button", "app-docs-tasksrefresh", "Refresh") as HTMLButtonElement;
      refreshBtn.setAttribute("aria-label", "Refresh tasks");
      refreshBtn.addEventListener("click", () => reload());
      head.appendChild(refreshBtn);
      panel.append(head, bodyEl);
      scrim.appendChild(panel);
      document.body.appendChild(scrim);

      const reload = () => {
        clear(bodyEl);
        bodyEl.appendChild(el("div", "app-loading-line", "Asking SharePoint…"));
        void fetchMyTasks().then((t) => {
          if (!scrim.isConnected) return;
          clear(bodyEl);
          paintTasksBadge(taskCount(t));
          if (!taskVisible(t)) {
            bodyEl.appendChild(el("div", "app-field-hint", "Nothing needs you."));
            return;
          }
          // R6 (design review 2026-08-08): due labels are PILLS — glyph
          // + word via the app's statusChip, never bare red text
          const group = (
            title: string,
            rows: TaskRow[],
            pill: (tr: TaskRow) => HTMLElement
          ) => {
            if (rows.length === 0) return;
            bodyEl.appendChild(el("div", "app-docs-tasksgroup", `${title} (${rows.length})`));
            for (const tr of rows) {
              const rowEl = el("div", "app-docs-taskrow");
              rowEl.setAttribute("role", "button");
              rowEl.tabIndex = 0;
              const open = () => {
                closePanel();
                onRowOpen(tr.row, { details: true }); // a task open arrives with work to do
              };
              rowEl.addEventListener("click", open);
              rowEl.addEventListener("keydown", (e) => {
                if (e.key === "Enter") open();
              });
              // R5 anatomy: pill · name-over-meta · chevron — every row
              // identical, the whole row opens the overlay, where the
              // decision zone handles approve/mark-reviewed (no
              // divergent inline buttons)
              const text = el("div", "app-docs-tasktext");
              text.append(
                el("div", "app-docs-taskname", tr.row.name),
                el("div", "app-field-hint", tr.why !== "" ? `Due ${tr.why}` : tr.libName)
              );
              rowEl.append(pill(tr), text, el("span", "app-docs-taskchev", "›"));
              bodyEl.appendChild(rowEl);
            }
          };
          // edit-access requests (5G2): decisions about PEOPLE lead —
          // someone is blocked until the owner answers
          if (t.requests.length > 0) {
            bodyEl.appendChild(
              el("div", "app-docs-tasksgroup", `Edit-access requests (${t.requests.length})`)
            );
            for (const rt of t.requests) {
              const rowEl = el("div", "app-docs-taskrow");
              if (rt.row !== null) {
                const liveRow = rt.row;
                rowEl.setAttribute("role", "button");
                rowEl.tabIndex = 0;
                const open = () => {
                  closePanel();
                  onRowOpen(liveRow, { details: true });
                };
                rowEl.addEventListener("click", open);
                rowEl.addEventListener("keydown", (e) => {
                  if (e.key === "Enter") open();
                });
              }
              rowEl.append(
                el("span", "app-docs-taskname", rt.req.name),
                el(
                  "span",
                  "app-field-hint",
                  `${rt.req.who.name} · ${rt.req.reason}`
                )
              );
              const decided = () => {
                refreshTasksBadge();
                reload();
              };
              // approve needs the live row (the check-out door) AND a
              // mapped grant column — without one, the hint says which
              if (rt.row !== null && revEditorsInternal !== "") {
                const liveRow = rt.row;
                const app2 = el("button", "app-btn app-btn-primary app-docs-taskact", "Approve…") as HTMLButtonElement;
                app2.addEventListener("click", (e) => {
                  e.stopPropagation();
                  void import("./accessRequests").then(({ openApproveRequest }) => {
                    openApproveRequest({
                      site: app.siteUrl,
                      request: rt.req,
                      row: liveRow,
                      revEditorsInternal,
                      existingEditors: (liveRow.values[`${revEditorsInternal}#email`] ?? "")
                        .split(";")
                        .filter((s) => s !== ""),
                      actorName: currentViewer()?.name ?? "",
                      host: dialogHost,
                      onDone: decided,
                      // N3: the requester hears the good news — the work
                      // link lands them on the overlay with Start
                      // revision live (the seat is instant)
                      notify:
                        accessRequestPlan({
                          kind: "granted",
                          docName: rt.req.name,
                          actorName: currentViewer()?.name ?? "",
                          targets: [{ name: rt.req.who.name, email: rt.req.who.email }],
                          myEmail,
                          link: docLinkUrlWork(rt.req.listId, rt.req.itemId),
                        }) ?? undefined,
                    });
                  });
                });
                rowEl.appendChild(app2);
              } else {
                rowEl.appendChild(
                  el(
                    "span",
                    "app-field-hint",
                    rt.row === null
                      ? "Document not found — decline to clear."
                      : "Map a Revision editors column (Settings → Documents) to approve."
                  )
                );
              }
              const dec = el("button", "app-btn app-docs-taskact", "Decline…") as HTMLButtonElement;
              dec.addEventListener("click", (e) => {
                e.stopPropagation();
                void import("./accessRequests").then(({ openDeclineRequest }) => {
                  openDeclineRequest({
                    request: rt.req,
                    actorName: currentViewer()?.name ?? "",
                    host: dialogHost,
                    onDone: decided,
                    // N3: the outcome reaches the requester directly —
                    // the typed reason rides into the message
                    notify:
                      accessRequestPlan({
                        kind: "declined",
                        docName: rt.req.name,
                        actorName: currentViewer()?.name ?? "",
                        targets: [{ name: rt.req.who.name, email: rt.req.who.email }],
                        myEmail,
                        link: docLinkUrlWork(rt.req.listId, rt.req.itemId),
                      }) ?? undefined,
                  });
                });
              });
              rowEl.appendChild(dec);
              bodyEl.appendChild(rowEl);
            }
          }
          // most actionable first: sign-off, then review work, then
          // your own held documents, then the review cadence
          group("Awaiting your approval", t.toApprove, () => tonePill("◐ Approve", "amber"));
          group("Awaiting your review", t.toReview, () => tonePill("◐ Review", "amber"));
          group("Checked out to you", t.held, () => tonePill("🔒 Checked out", "neutral"));
          group("Review due", t.review, (tr) =>
            tr.overdue ? tonePill("⚑ Overdue", "red") : tonePill("● Due soon", "amber")
          );
          // your OWN requests, every state — the outcome reaches you
          // here, not only buried in the document overlay
          if (t.outgoing.length > 0) {
            bodyEl.appendChild(
              el("div", "app-docs-tasksgroup", `Your access requests (${t.outgoing.length})`)
            );
            for (const rt of t.outgoing) {
              const req = rt.req;
              const rowEl = el("div", "app-docs-taskrow");
              // the row OPENS the document it is about — a granted row
              // is one click from Start revision (Ben, 2026-08-06)
              if (rt.row !== null) {
                const liveRow = rt.row;
                rowEl.setAttribute("role", "button");
                rowEl.tabIndex = 0;
                const open = () => {
                  closePanel();
                  onRowOpen(liveRow, { details: true });
                };
                rowEl.addEventListener("click", open);
                rowEl.addEventListener("keydown", (e) => {
                  if (e.key === "Enter") open();
                });
              }
              const state =
                req.granted !== undefined
                  ? `Granted by ${req.granted.by} — open and Start revision`
                  : req.declined !== undefined
                    ? `Declined by ${req.declined.by} — ${req.declined.reason}`
                    : "Waiting on the document owner";
              rowEl.append(
                el("span", "app-docs-taskname", req.name),
                el("span", "app-field-hint", state)
              );
              if (req.granted === undefined) {
                const act = el(
                  "button",
                  "app-btn app-docs-taskact",
                  req.declined !== undefined ? "Dismiss" : "Withdraw"
                ) as HTMLButtonElement;
                act.addEventListener("click", (e) => {
                  e.stopPropagation();
                  void import("./accessRequests").then(({ removeRequest }) =>
                    removeRequest(req.id).then(() => {
                      refreshTasksBadge();
                      reload();
                    })
                  );
                });
                rowEl.appendChild(act);
              } else if (
                rt.row !== null &&
                revEditorsInternal !== "" &&
                !isMine(rt.row)
              ) {
                // unused grant: the grantee's own exit (once revising,
                // Discard check-out is the road out)
                const liveRow = rt.row;
                const act = el("button", "app-btn app-docs-taskact", "End access…") as HTMLButtonElement;
                act.addEventListener("click", (e) => {
                  e.stopPropagation();
                  closePanel();
                  openEndMyAccess(liveRow);
                });
                rowEl.appendChild(act);
              }
              bodyEl.appendChild(rowEl);
            }
            // painted = seen: the grant stops counting on the badge
            // (the entry itself lives on for the whole cycle)
            const unseen = t.outgoing
              .filter((e) => e.req.granted !== undefined && e.req.seen !== true)
              .map((e) => e.req.id);
            if (unseen.length > 0) {
              void import("./accessRequests").then(({ markSeen }) =>
                markSeen(unseen).then(
                  () => refreshTasksBadge(),
                  () => {}
                )
              );
            }
          }
          // standing grants this user presides over — the easy road to
          // revoke, and the answer to "who can edit what right now"
          if (t.grantedByMe.length > 0) {
            bodyEl.appendChild(
              el("div", "app-docs-tasksgroup", `Edit access you granted (${t.grantedByMe.length})`)
            );
            for (const rt of t.grantedByMe) {
              const req = rt.req;
              const rowEl = el("div", "app-docs-taskrow");
              if (rt.row !== null) {
                const liveRow = rt.row;
                rowEl.setAttribute("role", "button");
                rowEl.tabIndex = 0;
                const open = () => {
                  closePanel();
                  onRowOpen(liveRow, { details: true });
                };
                rowEl.addEventListener("click", open);
                rowEl.addEventListener("keydown", (e) => {
                  if (e.key === "Enter") open();
                });
              }
              rowEl.append(
                el("span", "app-docs-taskname", req.name),
                el(
                  "span",
                  "app-field-hint",
                  `${req.who.name} · granted ${req.granted?.when.slice(0, 10) ?? ""}`
                )
              );
              if (rt.row !== null && revEditorsInternal !== "") {
                const liveRow = rt.row;
                const rev = el("button", "app-btn app-docs-taskact", "Revoke…") as HTMLButtonElement;
                rev.addEventListener("click", (e) => {
                  e.stopPropagation();
                  closePanel();
                  // one-person revoke: everyone else's grant survives
                  openRevokeAccessRow(liveRow, { email: req.who.email, name: req.who.name });
                });
                rowEl.appendChild(rev);
              }
              bodyEl.appendChild(rowEl);
            }
          }
          // R5 footer: the panel's DOCUMENTS as a register scope — one
          // click from triage to the full list, filter removable as a
          // chip like any other
          const uniq = new Map<string, DocRow>();
          for (const tr of [...t.toApprove, ...t.toReview, ...t.held, ...t.review]) {
            uniq.set(`${tr.row.listId.toLowerCase()}:${tr.row.id}`, tr.row);
          }
          if (uniq.size > 0) {
            const foot = el(
              "button",
              "app-docs-tasksfoot",
              `Show all ${uniq.size} in register`
            ) as HTMLButtonElement;
            foot.addEventListener("click", () => {
              const map = new Map<string, number[]>();
              for (const r of uniq.values()) {
                const k = r.listId.toLowerCase();
                map.set(k, [...(map.get(k) ?? []), r.id]);
              }
              approvedBeforeTaskFilter = onlyApproved;
              onlyApproved = false; // task documents are mid-workflow by nature
              // "show ALL my tasks" means all of them: any standing
              // query, column filter, folder pick or date window would
              // intersect tasks away (Ben, 2026-08-08)
              query = "";
              search.value = "";
              filters = [];
              dateFilters = [];
              modifiedDays = 0;
              taskFilter = map;
              taskFilterN = uniq.size;
              closePanel();
              paintChips();
              paintTreeSelection();
              void load(true);
            });
            bodyEl.appendChild(foot);
          }
        });
      };
      reload();
    });
    // toggles that used to be toolbar checkboxes ride the register
    // kebab from V3 — state only here
    /**
     * "Show only Approved" — ON by default (Ben, 2026-08-03). A
     * controlled-document register is asked for the approved copy;
     * everything else is noise until someone says otherwise. Stored as
     * its inverse so links and saved views written before this keep
     * meaning what they meant.
     */
    let onlyApproved = !(bootView?.nonCurrent ?? false);
    let modifiedDays = bootView?.modifiedDays ?? 0;
    /** R5 footer filter: the task panel's documents shown AS a register
     *  scope (listId → item ids, CAML idIn). "Show only Approved" is
     *  suspended while it holds — task documents are mid-workflow by
     *  nature — and restored when the chip clears. */
    let taskFilter: Map<string, number[]> | null = null;
    let taskFilterN = 0;
    let approvedBeforeTaskFilter = true;
    // declared HERE, not in the data-flow section: the register's empty
    // state reads it during the initial mount, and a later `let` would be
    // a temporal-dead-zone crash that kills the whole screen
    let query = bootView?.query ?? "";
    const modifiedIso = (): string | undefined =>
      modifiedDays > 0
        ? new Date(Date.now() - modifiedDays * 86400000).toISOString()
        : undefined;

    // secondary actions (share the current filter as a player link,
    // export the register) live behind one kebab — the app's convention
    const topKebab = el("button", "app-kebab app-docs-topkebab", "⋮") as HTMLButtonElement;
    topKebab.title = "More actions";
    top.append(searchWrap, scopeBtn, actionNeeded);
    if (favMode) {
      scopeBtn.style.display = "none";
      actionNeeded.style.display = "none";
    }
    // the toolbar rides the REGISTER pane, not the whole screen (Ben,
    // 2026-08-01): appended into `main` below, above the title row

    const bodyRow = el("div", "app-docs-body");
    wrap.appendChild(bodyRow);

    // ---- left nav ------------------------------------------------------
    const nav = el("nav", "app-docs-nav");
    bodyRow.appendChild(nav);

    /** Re-mount in place with a stashed boot state (both modes — the
     *  embedded pattern; the hash stays put). */
    const remount = () => {
      dead = true;
      for (const f of innerCleanups) f();
      innerCleanups.length = 0;
      wrap.remove();
      mountDocs(parent, "", opts);
    };

    const navCard = (label: string): { card: HTMLElement; head: HTMLElement } => {
      const card = el("section", "app-docs-navcard");
      const head = el("div", "app-docs-navhead");
      head.appendChild(el("span", "app-docs-navheadlabel", label));
      card.appendChild(head);
      nav.appendChild(card);
      return { card, head };
    };

    // ---- FAVOURITES (Ben, 2026-08-08) ----------------------------------
    // The star has been settable since Vault V1 with nowhere to go — the
    // entry point was cut in the flat-2.0 pass and the favMode machinery
    // left waiting for a home. This is it: one row above the libraries,
    // a scope of its own (filled accent = a location, the app's rule 1).
    const favNav = el(
      "button",
      `app-docs-favnav${favMode ? " app-docs-favnav-on" : ""}`
    ) as HTMLButtonElement;
    const favNavCount = el("span", "app-docs-favnavcount", "");
    favNav.append(
      el("span", "app-docs-favnavstar", favMode ? "★" : "☆"),
      el("span", "app-docs-favnavlabel", "Favourites"),
      favNavCount
    );
    favNav.title = "The documents you have starred, across every library";
    favNav.setAttribute("aria-pressed", String(favMode));
    favNav.addEventListener("click", () => {
      if (favMode) return; // already here — the libraries below lead out
      pendingFav = true;
      remount();
    });
    if (whoId !== "") nav.appendChild(favNav);

    // ---- LIBRARIES card (Vault V1) -------------------------------------
    // Checkbox = include toggle (minimum one stays ticked); the name and
    // the hover/focus "Only" affordance solo-select (finding 3). One
    // ticked library keeps the fast browse path; two or more ride search.
    const switchTo = (ids: string[]) => {
      persistUi({ libraries: ids });
      pendingLibs = ids;
      remount();
    };
    const libCard = navCard("Libraries");
    const selectAll = el(
      "button",
      "app-linklike app-docs-navheadaction",
      "Select all"
    ) as HTMLButtonElement;
    selectAll.title = "Include every library";
    selectAll.disabled = allSelected && !favMode;
    selectAll.addEventListener("click", () => switchTo(allListIds));
    libCard.head.appendChild(selectAll);
    for (const lib of libraries) {
      const on = !favMode && isSelected(lib.listId);
      const row = el("div", `app-docs-librow2${on ? " app-docs-librow2-on" : ""}`);
      const box = el("input", "app-docs-libcheck") as HTMLInputElement;
      box.type = "checkbox";
      box.checked = on;
      box.setAttribute("aria-label", `Include ${lib.config.title || lib.name}`);
      box.addEventListener("change", () => {
        const next = box.checked
          ? [...selectedIds.filter((id) => id.toLowerCase() !== lib.listId.toLowerCase()), lib.listId]
          : selectedIds.filter((id) => id.toLowerCase() !== lib.listId.toLowerCase());
        if (next.length === 0) {
          box.checked = true; // the last library cannot be unticked
          return;
        }
        switchTo(next);
      });
      const name = el(
        "button",
        "app-docs-libname2",
        lib.config.title || lib.name
      ) as HTMLButtonElement;
      name.title = "Show only this library";
      name.addEventListener("click", () => switchTo([lib.listId]));
      const only = el("button", "app-docs-only", "Only") as HTMLButtonElement;
      only.setAttribute("aria-label", `Only ${lib.config.title || lib.name}`);
      only.addEventListener("click", () => switchTo([lib.listId]));
      row.append(box, name, only);
      libCard.card.appendChild(row);
    }
    // (the ★ Favourites row and the libType subtitles were cut — Ben,
    // 2026-08-02; favourite toggles remain in the kebab and overlay, and
    // the favMode machinery stays for a future entry point)

    // saved views moved OUT of this pane (Ben, 2026-08-01) — they live
    // in the register kebab now; the nav is libraries + browse-by only
    if (whoId !== "") {
      void docPrefs(whoId).then((p) => {
        if (dead) return;
        favs = p.favorites;
        savedViews = p.views;
        favNavCount.textContent = favs.length > 0 ? String(favs.length) : "";
        if (favMode) void load(true); // favourites arrived — paint them
      });
    }
    // ---- taxonomy filters + the group-by tree (Phase 3a) ---------------
    // Filtering keys on the auto-created owstaxId<Column> property with
    // term GUIDs (verified 2026-07-28: no admin mapping needed on the dev
    // tenant). A GUID matches only its exact term, so picking a node ORs
    // the node with its whole subtree — the walk yields it anyway. The
    // organisation filter of Phase 2 is now one entry in a general list:
    // any taxonomy column with a known term set can filter, and any of
    // them can drive the tree.
    const orgCols = new Set<string>();
    for (const lib of libraries) {
      for (const c of lib.config.columns) if (c.role === "orgUnit") orgCols.add(c.internal);
    }
    const orgProps = [...orgCols].map(taxonomySearchProperty);

    /** Taxonomy columns beyond the organisation, unioned across the
     *  exposed libraries: internal → display label + term set. */
    const taxCols = new Map<string, { label: string; setId: string }>();
    for (const lib of libraries) {
      for (const c of lib.config.columns) {
        if (!c.available || c.termSetId === "" || c.role === "orgUnit") continue;
        if (!taxCols.has(c.internal)) {
          taxCols.set(c.internal, { label: c.label || c.internal, setId: c.termSetId });
        }
      }
    }
    /** Date columns the site left filterable — the from/to rows in the
     *  Filters pane (Ben, 2026-08-03). */
    const dateCols = (): { internal: string; label: string }[] =>
      siteDict.columns
        .filter((c) => c.available && c.filterable && isDateColumn(c))
        .map((c) => ({ internal: c.internal, label: c.label !== "" ? c.label : c.internal }));

    /** col "" = the organisation (its own slot in links). */
    const colLabel = (col: string): string =>
      col === "" ? "Organisation" : (taxCols.get(col)?.label ?? col);
    const setFor = (col: string): string =>
      col === "" ? app.orgSetId : (taxCols.get(col)?.setId ?? "");
    const propsFor = (col: string): string[] =>
      col === "" ? orgProps : [taxonomySearchProperty(col)];

    interface ActiveFilter {
      col: string;
      node: TermNode;
      ids: string[];
      /** Lowercased subtree labels — the REST-path label match. */
      labels: Set<string>;
    }
    let filters: ActiveFilter[] = [];
    const filterFor = (col: string): ActiveFilter | null =>
      filters.find((f) => f.col === col) ?? null;

    /** From/to bounds per date column (Ben, 2026-08-03). Either end may
     *  be blank; an entry with both blank is dropped rather than kept as
     *  a filter that filters nothing. */
    interface DateFilter {
      col: string;
      from: string;
      to: string;
    }
    let dateFilters: DateFilter[] = (bootView?.dates ?? []).map((d) => ({ ...d }));
    const dateFor = (col: string): DateFilter | null =>
      dateFilters.find((d) => d.col === col) ?? null;
    const setDateFilter = (col: string, from: string, to: string) => {
      dateFilters = dateFilters.filter((d) => d.col !== col);
      if (from !== "" || to !== "") dateFilters.push({ col, from, to });
      paintChips();
      void load(true);
    };

    const subtreeIn = (nodes: TermNode[], node: TermNode): TermNode[] =>
      nodes.filter(
        (n) =>
          n.id === node.id ||
          (n.labels.length > node.labels.length &&
            node.labels.every((l, i) => n.labels[i] === l))
      );
    /** Set/replace (node) or clear (null) the filter on one column. */
    const applyFilter = (col: string, node: TermNode | null, nodes: TermNode[]) => {
      filters = filters.filter((f) => f.col !== col);
      if (node !== null) {
        const subtree = subtreeIn(nodes, node);
        filters.push({
          col,
          node,
          ids: subtree.map((n) => n.id),
          labels: new Set(
            // the picked node itself even when the walk missed it
            [node, ...subtree].map((n) => n.labels[n.labels.length - 1].toLowerCase())
          ),
        });
      }
      paintTreeSelection();
      paintChips();
      void load(true);
    };

    // ---- the tree ------------------------------------------------------
    // the tree is FIXED to the organisation hierarchy (Ben, 2026-08-02:
    // with the Filters popover covering every column, a configurable
    // group-by was redundant) — saved views' groupBy is ignored
    const groupBy = "";
    let treeNodes: TermNode[] = [];
    const treeButtons = new Map<string, HTMLElement>();
    let allBtn: HTMLButtonElement | null = null;
    let collapsed = new Set<string>();

    const paintTreeSelection = () => {
      const active = filterFor(groupBy);
      allBtn?.classList.toggle("app-docs-navterm-on", active === null);
      for (const [id, btn] of treeButtons) {
        btn.classList.toggle("app-docs-navterm-on", active?.node.id === id);
      }
    };

    // Folder counts REMOVED (Ben, 2026-08-08, UI design review): the
    // numbers cost one id-and-org query per library in scope after
    // EVERY register reload — bandwidth spent exactly when the rows are
    // loading — and same-named departments merged their counts (the
    // grouped RLDAS placeholder-TermID limitation). The tree is pure
    // navigation now; the register itself says what a folder holds.

    /** Deepest term whose label path matches the viewer's own site /
     *  department / area (offset 1 tolerates a company-rooted set). */
    const viewerNode = async (): Promise<TermNode | null> => {
      const viewer = currentViewer();
      if (!viewer) return null;
      const me = await viewerPerson(viewer.objectId).catch(() => null);
      if (!me) return null;
      const want = [me.site, me.department, me.area]
        .map((s) => (s ?? "").trim().toLowerCase())
        .filter((s) => s !== "");
      if (want.length === 0) return null;
      let best: TermNode | null = null;
      for (const n of treeNodes) {
        for (const offset of [0, 1]) {
          const labels = n.labels.slice(offset).map((l) => l.toLowerCase());
          if (labels.length === 0 || labels.length > want.length) continue;
          if (labels.every((l, i) => l === want[i])) {
            if (!best || n.labels.length > best.labels.length) best = n;
          }
        }
      }
      return best;
    };

    // the browse-by card fills the pane to the bottom (Ben, 2026-08-01:
    // full-height left column per the Vault design), its tree scrolling.
    // In favourites mode it is HIDDEN rather than inert: favourites are
    // local rows carrying no field values, so a folder click would look
    // like a filter and do nothing.
    const treeCard = el("section", "app-docs-navcard app-docs-navcard-fill");
    if (favMode) treeCard.style.display = "none";
    const treeHead = el("div", "app-docs-navhead");
    treeHead.appendChild(el("span", "app-docs-navheadlabel", "Folders"));
    treeCard.appendChild(treeHead);

    /** Persisted collapse state per term set (Vault V1). */
    const persistCollapse = (setId: string) => {
      persistUi({ collapsed: { ...uiState.collapsed, [setId]: [...collapsed] } });
    };
    const treeBox = el("div", "app-docs-navorgbox");

    const paintTree = () => {
      clear(treeBox);
      treeButtons.clear();
      allBtn = null;
      const setId = setFor(groupBy);
      if (setId === "") {
        treeBox.appendChild(el("div", "app-field-hint", "No term set for this column."));
        return;
      }
      collapsed = new Set(uiState.collapsed[setId] ?? []);
      treeBox.appendChild(el("div", "app-field-hint", "Loading…"));
      void cachedTermPaths(app.siteUrl, setId, 4, 60).then(async ({ nodes, error }) => {
        if (dead || setFor(groupBy) !== setId) return;
        clear(treeBox);
        if (error !== "" || nodes.length === 0) {
          treeBox.appendChild(el("div", "app-field-hint", "No terms yet."));
          return;
        }
        treeNodes = nodes;
        const disabled = groupBy === "" && orgProps.length === 0;
        const SEP = "\u0000";
        const key = (labels: string[]) => labels.join(SEP);
        const hasChildren = new Set<string>();
        for (const n of nodes) {
          if (n.labels.length > 1) hasChildren.add(key(n.labels.slice(0, -1)));
        }
        // the misclick recovery row: one click back to the unfiltered
        // register (the Vault's "All folders" anatomy)
        const allRow = el("div", "app-docs-treerow");
        allRow.appendChild(el("span", "app-docs-caret app-docs-caret-none", ""));
        allBtn = el("button", "app-docs-navterm", "All (no filter)") as HTMLButtonElement;
        allBtn.title = `Clear the ${colLabel(groupBy)} filter`;
        if (!(groupBy === "" && orgProps.length === 0)) {
          allBtn.addEventListener("click", () => applyFilter(groupBy, null, []));
        }
        allRow.appendChild(allBtn);
        treeBox.appendChild(allRow);
        const rows = new Map<string, HTMLElement>();
        const paintCollapse = () => {
          for (const n of nodes) {
            const row = rows.get(n.id);
            if (!row) continue;
            let hidden = false;
            for (let d = 1; d < n.labels.length && !hidden; d++) {
              if (collapsed.has(key(n.labels.slice(0, d)))) hidden = true;
            }
            row.style.display = hidden ? "none" : "";
          }
        };
        for (const n of nodes) {
          const row = el("div", "app-docs-treerow");
          row.style.paddingLeft = `${(n.labels.length - 1) * 14}px`;
          const k = key(n.labels);
          if (hasChildren.has(k)) {
            const caret = el("button", "app-docs-caret", collapsed.has(k) ? "▸" : "▾") as HTMLButtonElement;
            caret.setAttribute("aria-expanded", String(!collapsed.has(k)));
            caret.addEventListener("click", () => {
              if (collapsed.has(k)) collapsed.delete(k);
              else collapsed.add(k);
              caret.textContent = collapsed.has(k) ? "▸" : "▾";
              caret.setAttribute("aria-expanded", String(!collapsed.has(k)));
              paintCollapse();
              persistCollapse(setId);
            });
            row.appendChild(caret);
          } else {
            row.appendChild(el("span", "app-docs-caret app-docs-caret-none", ""));
          }
          const btn = el("button", "app-docs-navterm", n.labels[n.labels.length - 1]) as HTMLButtonElement;
          if (disabled) {
            btn.disabled = true;
            btn.title =
              "Map a column to the Organisation unit role in Settings → Documents to filter by organisation.";
          } else {
            btn.title = n.labels.join(" › ");
            btn.addEventListener("click", () =>
              applyFilter(groupBy, filterFor(groupBy)?.node.id === n.id ? null : n, nodes)
            );
          }
          row.appendChild(btn);
          treeButtons.set(n.id, btn);
          rows.set(n.id, row);
          treeBox.appendChild(row);
        }
        paintCollapse();
        paintTreeSelection();
        // boot: a shared/saved view's org filter first; otherwise land on
        // the viewer's own corner of the organisation (chip makes either
        // one-click removable). Organisation tree only.
        if (groupBy === "" && filterFor("") === null) {
          const wantOrg = bootView?.orgTermId ?? "";
          if (wantOrg !== "") {
            const match = nodes.find((x) => x.id === wantOrg);
            if (match) applyFilter("", match, nodes);
          } else if (orgProps.length > 0 && bootView === null && !favMode) {
            const mine = await viewerNode();
            if (!dead && mine && filterFor("") === null) applyFilter("", mine, nodes);
          }
        }
      });
    };

    // keyboard: Up/Down walk the visible rows, Left/Right drive the
    // focused row's caret (Vault V1 accept criterion)
    treeBox.addEventListener("keydown", (e) => {
      const focused = document.activeElement;
      if (!(focused instanceof HTMLElement)) return;
      const rowEls = [...treeBox.querySelectorAll<HTMLElement>(".app-docs-treerow")].filter(
        (r) => r.style.display !== "none"
      );
      const rowOf = rowEls.find((r) => r.contains(focused));
      if (!rowOf) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const i = rowEls.indexOf(rowOf) + (e.key === "ArrowDown" ? 1 : -1);
        const next = rowEls[i]?.querySelector<HTMLButtonElement>("button.app-docs-navterm");
        next?.focus();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const caret = rowOf.querySelector<HTMLButtonElement>("button.app-docs-caret");
        if (!caret) return;
        const expanded = caret.getAttribute("aria-expanded") === "true";
        if ((e.key === "ArrowLeft" && expanded) || (e.key === "ArrowRight" && !expanded)) {
          e.preventDefault();
          caret.click();
        }
      }
    });

    if (app.orgSetId !== "") {
      treeCard.appendChild(treeBox);
      nav.appendChild(treeCard);
      paintTree();
    }

    // boot: filters a shared/saved view carries beyond the organisation —
    // each needs its own set's walk for subtree ids
    for (const f of bootView?.filters ?? []) {
      const setId = setFor(f.col);
      if (setId === "" || filterFor(f.col) !== null) continue;
      void cachedTermPaths(app.siteUrl, setId, 4, 60).then(({ nodes }) => {
        if (dead) return;
        const match = nodes.find((n) => n.id === f.termId);
        if (match && filterFor(f.col) === null) applyFilter(f.col, match, nodes);
      });
    }

    // ---- the register pane ---------------------------------------------
    const main = el("div", "app-docs-main");
    bodyRow.appendChild(main);
    main.appendChild(top); // search + scope + Action needed, full width

    // title row (Vault V3): what you are looking at + the register's own
    // controls — Filters (badged), List/Tiles, the kebab
    const titleRow = el("div", "app-docs-titlerow");
    const titleBlock = el("div", "app-docs-titleblock");
    const h1 = el("h2", "app-docs-h1", "");
    const crumb = el("div", "app-docs-crumb", "");
    titleBlock.append(h1, crumb);
    const filtersBtn = el("button", "app-btn app-docs-filtersbtn", "Filters") as HTMLButtonElement;
    filtersBtn.title = "Filter the register by its configured columns";
    const seg = el("div", "app-docs-seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "Register view");
    const segList = el("button", "app-docs-segbtn", "List") as HTMLButtonElement;
    const segTiles = el("button", "app-docs-segbtn", "Tiles") as HTMLButtonElement;
    seg.append(segList, segTiles);
    // Add a document (Phase 4C) — appears once SharePoint's permission
    // answers arrive and only if somewhere writable exists to add to
    const addBtn = el("button", "app-btn app-btn-primary app-docs-addbtn", "＋ Add document") as HTMLButtonElement;
    addBtn.style.display = "none";
    /** May this user add to this library? Working/revision ride the
     *  SharePoint permission answer alone; STANDARDS additionally need
     *  the pool (5G1) — once general users are read-only, SharePoint
     *  would refuse them late, so the target hides up front. A pool
     *  answer of "unknown" gates OPEN: SharePoint stays the hard gate,
     *  and a Graph hiccup must not strand a legitimate author. */
    const canAddTo = (l: DocLibrary): boolean => {
      if (!(permsByLib.get(l.listId.toLowerCase())?.add ?? false)) return false;
      if (l.libType === "working" || l.libType === "revision") return true;
      if (l.libType !== "standard") return false;
      return meInPool !== false || docAdmin();
    };
    void permsReady.then(() => {
      if (libraries.some(canAddTo) && !favMode) addBtn.style.display = "";
    });
    addBtn.addEventListener("click", () => {
      void (async () => {
        const { openAddDocument } = await import("./addDocument");
        // H2: the upload source, offered to pool members and controllers
        // when a staging library is configured. Unknown pool gates OPEN
        // (the staging library's own permissions are the hard gate).
        const upload =
          meInPool !== false || docAdmin() ? await resolveStaging() : undefined;
        openAddDocument({
          site: app.siteUrl,
          upload,
          targets: libraries.filter(canAddTo),
          templates: libraries.filter((l) => l.libType === "template"),
          dictBy,
          host: dialogHost,
          onCreated: (row) => {
            void load(true);
            refreshTasksBadge();
            onRowOpen(row);
          },
        });
      })();
    });
    titleRow.append(titleBlock, el("div", "app-docs-titlegap"), addBtn, filtersBtn, seg, topKebab);
    if (favMode) {
      filtersBtn.style.display = "none";
      seg.style.display = "none";
      topKebab.style.display = "none";
    }
    main.appendChild(titleRow);

    const libNames = favMode
      ? "Favourites"
      : current
        ? current.config.title || current.name
        : allSelected
          ? "All libraries"
          : selectedIds
              .map((id) => byListId.get(id.toLowerCase()))
              .filter((l): l is DocLibrary => l !== undefined)
              .map((l) => l.config.title || l.name)
              .join(" & ");
    const paintTitle = () => {
      const f = filterFor(groupBy) ?? filters[0] ?? null;
      h1.textContent = f
        ? `${f.node.labels[f.node.labels.length - 1]} — ${libNames}`
        : libNames;
      crumb.textContent = f ? f.node.labels.join(" › ") : "";
      crumb.style.display = f ? "" : "none";
      // the organisation is not counted: the Folders pane IS that
      // selection and shows it, so "Filters · 1" for a picked folder
      // pointed at a pane that had nothing set in it (Ben, 2026-08-03)
      const active =
        filters.filter((f) => f.col !== "").length +
        dateFilters.length +
        (modifiedDays > 0 ? 1 : 0);
      filtersBtn.textContent = active > 0 ? `Filters · ${active}` : "Filters";
      filtersBtn.classList.toggle("app-docs-filtersbtn-on", active > 0);
    };

    const filterBar = el("div", "app-docs-filterbar");
    main.appendChild(filterBar);
    const status = el("div", "app-docs-status");
    main.appendChild(status);

    const paintChips = () => {
      paintTitle();
      clear(filterBar);
      if (taskFilter !== null) {
        const chip = el("span", "app-docs-orgchip");
        chip.appendChild(document.createTextNode(`Document tasks · ${taskFilterN}`));
        const x = el("button", "app-docs-orgchip-x", "×") as HTMLButtonElement;
        x.title = "Show the whole register again";
        x.addEventListener("click", () => {
          taskFilter = null;
          onlyApproved = approvedBeforeTaskFilter;
          paintChips();
          void load(true);
        });
        chip.appendChild(x);
        filterBar.appendChild(chip);
      }
      if (modifiedDays > 0) {
        const chip = el("span", "app-docs-orgchip");
        chip.appendChild(document.createTextNode(`Modified: last ${modifiedDays} days`));
        const x = el("button", "app-docs-orgchip-x", "×") as HTMLButtonElement;
        x.title = "Clear the modified filter";
        x.addEventListener("click", () => {
          modifiedDays = 0;
          paintChips();
          void load(true);
        });
        chip.appendChild(x);
        filterBar.appendChild(chip);
      }
      for (const f of filters) {
        // the organisation has no chip: the Folders pane is that filter,
        // shows the selection and clears it, so a chip said it twice
        // (Ben, 2026-08-03)
        if (f.col === "") continue;
        const chip = el("span", "app-docs-orgchip");
        chip.appendChild(
          document.createTextNode(`${colLabel(f.col)}: ${f.node.labels.join(" › ")}`)
        );
        const x = el("button", "app-docs-orgchip-x", "×") as HTMLButtonElement;
        x.title = `Clear the ${colLabel(f.col)} filter`;
        x.addEventListener("click", () => applyFilter(f.col, null, []));
        chip.appendChild(x);
        filterBar.appendChild(chip);
      }
      for (const d of dateFilters) {
        const name = siteDict.columns.find((c) => c.internal === d.col);
        const label = name && name.label !== "" ? name.label : d.col;
        const when =
          d.from !== "" && d.to !== ""
            ? `${d.from} to ${d.to}`
            : d.from !== ""
              ? `from ${d.from}`
              : `up to ${d.to}`;
        const chip = el("span", "app-docs-orgchip");
        chip.appendChild(document.createTextNode(`${label}: ${when}`));
        const x = el("button", "app-docs-orgchip-x", "×") as HTMLButtonElement;
        x.title = `Clear the ${label} filter`;
        x.addEventListener("click", () => setDateFilter(d.col, "", ""));
        chip.appendChild(x);
        filterBar.appendChild(chip);
      }
      // adding filters lives in the Filters popover (Vault V3); the chip
      // row only shows what is applied
    };
    paintChips();

    // ---- Filters popover (Vault V3) ------------------------------------
    // The popover is the EDITOR; applied state keeps painting as the chip
    // row. Pills are the app's filter-chip treatment; one term per column
    // (a pick includes its subtree — the shipped semantics), AND across
    // columns. Counts stay honest: they ride the chips/tree, loaded-rows
    // only.
    filtersBtn.addEventListener("click", () => {
      if (menu) {
        closeMenu();
        return;
      }
      menu = el("div", "app-docs-menu app-docs-filterpop");
      const body = el("div", "app-docs-filterpop-body");
      menu.appendChild(body);
      const paintPop = () => {
        clear(body);
        const group = (label: string): HTMLElement => {
          const g = el("div", "app-docs-fgroup");
          g.appendChild(el("div", "app-docs-fgroup-label", label));
          body.appendChild(g);
          return g;
        };
        // the site says which columns filter (Ben, 2026-08-03)
        const filterable = new Set(
          siteDict.columns.filter((c) => c.available && c.filterable).map((c) => c.internal)
        );
        // …and the organisation obeys that too. It used to be exempt
        // because the Folders pane drives it, which meant unticking it
        // in Settings changed nothing (Ben's screenshot). Unknown to the
        // dictionary = still shown, so a site that has never opened the
        // new settings keeps the pane it had.
        const orgCol = siteDict.columns.find((c) => orgCols.has(c.internal));
        const orgFilterable = orgCol === undefined || (orgCol.available && orgCol.filterable);
        const cols: string[] = [];
        if (app.orgSetId !== "" && orgProps.length > 0 && orgFilterable) cols.push("");
        cols.push(
          ...[...taxCols.keys()].filter(
            (c) =>
              filterable.has(c) &&
              // "Show only Approved" IS the status filter while it is on
              !(onlyApproved && c === statusInternal)
          )
        );
        for (const col of cols) {
          const g = group(colLabel(col));
          const pills = el("div", "app-docs-fpills");
          g.appendChild(pills);
          pills.appendChild(el("span", "app-field-hint", "Loading…"));
          const setId = setFor(col);
          void cachedTermPaths(app.siteUrl, setId, 4, 60).then(({ nodes, error }) => {
            if (dead || !menu || !menu.contains(pills)) return;
            clear(pills);
            if (error !== "" || nodes.length === 0) {
              pills.appendChild(el("span", "app-field-hint", "No terms."));
              return;
            }
            const active = filterFor(col);
            // top two levels as pills; a deeper active pick still shows
            const shallow = nodes.filter((n) => n.labels.length <= 2);
            const deepPick =
              active && !shallow.some((n) => n.id === active.node.id)
                ? [active.node]
                : [];
            const CAP = 14;
            let shown = [...deepPick, ...shallow];
            const capped = shown.length > CAP;
            if (capped) shown = shown.slice(0, CAP);
            for (const n of shown) {
              const on = active?.node.id === n.id;
              const pb = el(
                "button",
                `app-docs-fpill${on ? " app-docs-fpill-on" : ""}`,
                n.labels[n.labels.length - 1]
              ) as HTMLButtonElement;
              pb.title = n.labels.join(" › ");
              pb.setAttribute("aria-pressed", String(on));
              pb.addEventListener("click", () => {
                applyFilter(col, on ? null : n, nodes);
                paintPop();
              });
              pills.appendChild(pb);
            }
            if (capped) {
              pills.appendChild(
                el("span", "app-field-hint", "Deeper terms live in the Browse-by tree")
              );
            }
          });
        }
        // date columns: a from/to pair each (Ben, 2026-08-03). Native
        // date inputs, so the platform's own picker and keyboard entry
        // come for free — and blank means unbounded at that end.
        for (const dc of dateCols()) {
          const g = group(dc.label);
          const row = el("div", "app-docs-fdates");
          const cur = dateFor(dc.internal);
          const from = el("input", "app-input app-docs-fdate") as HTMLInputElement;
          from.type = "date";
          from.value = cur?.from ?? "";
          from.setAttribute("aria-label", `${dc.label} from`);
          const to = el("input", "app-input app-docs-fdate") as HTMLInputElement;
          to.type = "date";
          to.value = cur?.to ?? "";
          to.setAttribute("aria-label", `${dc.label} to`);
          const push = () => {
            setDateFilter(dc.internal, from.value.trim(), to.value.trim());
            paintPop();
          };
          from.addEventListener("change", push);
          to.addEventListener("change", push);
          row.append(
            el("span", "app-field-hint", "from"),
            from,
            el("span", "app-field-hint", "to"),
            to
          );
          if (cur) {
            const clear = el("button", "app-docs-fpill", "Clear") as HTMLButtonElement;
            clear.addEventListener("click", () => {
              setDateFilter(dc.internal, "", "");
              paintPop();
            });
            row.appendChild(clear);
          }
          g.appendChild(row);
        }

        const mg = group("Modified");
        const mp = el("div", "app-docs-fpills");
        mg.appendChild(mp);
        for (const [days, label] of [
          [0, "Any time"],
          [7, "Last 7 days"],
          [30, "Last 30 days"],
          [90, "Last 90 days"],
        ] as const) {
          const on = modifiedDays === days;
          const pb = el(
            "button",
            `app-docs-fpill${on ? " app-docs-fpill-on" : ""}`,
            label
          ) as HTMLButtonElement;
          pb.setAttribute("aria-pressed", String(on));
          pb.addEventListener("click", () => {
            modifiedDays = days;
            paintChips();
            void load(true);
            paintPop();
          });
          mp.appendChild(pb);
        }
        const foot = el("div", "app-docs-fpop-foot");
        const clearAll = el("button", "app-btn", "Clear all") as HTMLButtonElement;
        clearAll.addEventListener("click", () => {
          filters = [];
          dateFilters = [];
          modifiedDays = 0;
          paintTreeSelection();
          paintChips();
          void load(true);
          paintPop();
        });
        const doneB = el("button", "app-btn app-btn-primary", "Done") as HTMLButtonElement;
        doneB.addEventListener("click", () => closeMenu());
        foot.append(clearAll, doneB);
        body.appendChild(foot);
      };
      paintPop();
      const r = filtersBtn.getBoundingClientRect();
      menu.style.top = `${r.bottom + 4}px`;
      menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 420))}px`;
      document.body.appendChild(menu);
    });

    /** The status column, from the dictionary — so it is found whether
     *  one library is in view or five (C3). */
    const statusCol = statusInternal !== "" ? (dictBy.get(statusInternal) ?? null) : null;
    /** Lowercased term label → GUID for the status set. The palette is
     *  keyed by GUID, and this is what lets a RENAMED term keep its
     *  colour: the row paints the new label, which resolves here to the
     *  id the palette already holds. Until it answers (or if it never
     *  does), matching falls back to the label stored beside each entry,
     *  so colours are never withheld waiting on a round trip. */
    const labelToId = new Map<string, string>();
    /** Read the status vocabulary once: it gives the palette its ids AND
     *  tells "Show only Approved" which values count as approved. */
    const readStatusTerms = async (): Promise<void> => {
      if (statusCol === null || statusCol.termSetId === "") return;
      const r = await fetchTermsInSet(app.siteUrl, statusCol.termSetId);
      const rows = Array.isArray((r.data as { value?: unknown[] })?.value)
        ? ((r.data as { value: unknown[] }).value as Record<string, unknown>[])
        : [];
      const labels: string[] = [];
      statusTermList.length = 0;
      for (const t of rows) {
        const names = t.labels as { name?: string; isDefault?: boolean }[] | undefined;
        const def = Array.isArray(names) ? (names.find((l) => l.isDefault) ?? names[0]) : undefined;
        const name = (def?.name ?? "").trim();
        if (name === "") continue;
        labels.push(name);
        if (typeof t.id === "string") {
          labelToId.set(name.toLowerCase(), t.id);
          statusTermList.push({ id: t.id, label: name });
        }
      }
      // "approved" is whatever this site's vocabulary calls current —
      // the same reading the status glyphs use, so ✓ and "only Approved"
      // can never disagree about what a value means
      approvedLabels = labels.filter((l) => !isNonCurrentStatus(l));
    };

    // glyph + word so status reads under any colour-vision (finding 5);
    // both now come from the site palette, falling back to the built-in
    // vocabulary when a site has not set a glyph of its own.
    // R8 (design review 2026-08-08), the quiet/loud rule: APPROVED is
    // the register's normal state — when every row wears a solid green
    // pill the one exception drowns. Approved renders as an OUTLINE;
    // only exception states keep the fill. Tiles share this function,
    // so the rule holds in both views by construction.
    const statusChip = (value: string): HTMLElement => {
      const col = statusCol;
      const entry = paletteEntryFor(
        siteDict,
        col?.termSetId ?? "",
        col?.internal ?? "",
        value,
        labelToId
      );
      const glyph = entry?.glyph ?? "";
      const chip = el(
        "span",
        "app-docs-chip",
        glyph !== "" ? `${glyph} ${value}` : withStatusGlyph(value)
      );
      const color = resolvePaletteColor(states, entry?.color ?? "", "");
      const termId = labelToId.get(value.split(";")[0].trim().toLowerCase()) ?? "";
      const quiet = termId !== "" && stageOfTerm(siteDict, termId) === "approved";
      if (quiet) {
        chip.classList.add("app-docs-chip-quiet");
        if (color !== "") chip.style.borderColor = color;
      } else if (color !== "") {
        chip.style.background = color;
        chip.style.color = textOn(color);
      }
      return chip;
    };

    const ownerColCfg = ownerInternal !== "" ? (dictBy.get(ownerInternal) ?? null) : null;
    /** Initials avatar + the full owner text (Vault V3 row anatomy). */
    const ownerCell = (v: string): HTMLElement => {
      const first = v.split(";")[0].trim();
      const initials = first
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? "")
        .join("");
      const cell = el("span", "app-docs-ownercell");
      cell.title = v;
      cell.append(
        el("span", "app-docs-avatar", initials === "" ? "•" : initials),
        el("span", "app-docs-ownername", v)
      );
      return cell;
    };

    const nameCol: ListColumn<DocRow> = {
      key: "name",
      label: "Document",
      width: "minmax(190px, 3fr)",
      sortKey: "name",
      render: (row) => {
        const cell = el("span", "app-docs-namecell");
        // extension dropped from the display (Ben, 2026-08-02) — the
        // file-type chip carries it; the full filename stays in title
        const { stem } = splitNameForEllipsis(row.name);
        const nm = el("span", "app-docs-name");
        nm.title = row.name;
        nm.append(el("span", "app-docs-namestem", stem));
        cell.append(fileTypeChip(row.ext), nm);
        // checked out is a state worth seeing without opening anything,
        // and MINE is the only actionable case — so it reads differently
        if ((row.checkoutName ?? "") !== "") {
          const mine = isMine(row);
          const lock = el(
            "span",
            `app-docs-lock${mine ? " app-docs-lock-mine" : ""}`,
            mine ? "✎ you" : `🔒 ${row.checkoutName}`
          );
          lock.title = mine
            ? "You have this checked out"
            : `Checked out by ${row.checkoutName}`;
          cell.append(lock);
        }
        return cell;
      },
    };
    const kebabCol: ListColumn<DocRow> = {
      key: "kebab",
      label: "",
      width: "34px",
      render: (row) => {
        const b = el("button", "app-kebab app-docs-kebab", "⋮") as HTMLButtonElement;
        b.setAttribute("aria-label", "Document actions");
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          openKebab(b, row);
        });
        return b;
      },
    };
    const modifiedCol: ListColumn<DocRow> = {
      key: "modified",
      label: "Modified",
      width: "124px",
      sortKey: "modified",
      render: (row) => formatWhen(row.modified),
    };

    // the view's own column set beats the library default (Phase 3a —
    // carried by saved views and shared links; [] = default)
    const chosenColumns = bootView?.columns ?? [];
    /** Column set for the current width bucket (Vault V3: the status
     *  column drops out first as the pane narrows, then owner and the
     *  other configured columns — name and Modified always survive). */
    const buildColumns = (): ListColumn<DocRow>[] => {
      const columns: ListColumn<DocRow>[] = [nameCol];
      // which columns to show is a VIEW question (the chooser, or what
      // the libraries in view open with); what each one means is the
      // dictionary's answer, so this holds for any number of libraries
      // the chooser and view templates decide WHICH columns show; the
      // dictionary decides their ORDER, so columns sit in the same
      // relative sequence whatever is hidden (Ben, 2026-08-04).
      // Modified is unknown to the dictionary, so it lands last.
      const wanted = sortByDictionary(
        chosenColumns.length > 0
          ? chosenColumns.filter((i) => i === "Modified" || dictBy.get(i)?.available === true)
          : defaultInternals(),
        [...dictBy.keys()]
      );
      // more than one library in view: say which one each row came from
      if (viewLibs().length > 1 && bucket !== "narrow") {
        columns.push({
          key: "library",
          label: "Library",
          width: "minmax(110px, 1fr)",
          render: (row) => {
            const lib = byListId.get(row.listId);
            return lib ? lib.config.title || lib.name : "";
          },
        });
      }
      for (const internal of wanted) {
        if (internal === "Modified") {
          columns.push(modifiedCol);
          continue;
        }
        const role = roleOf(internal);
        if (bucket !== "full" && role === "status") continue;
        if (bucket === "narrow") continue;
        columns.push({
          key: internal,
          label: labelOf(internal),
          render: (row) => {
            const v = row.values[internal] ?? "";
            if (v === "") return "";
            if (role === "status") return statusChip(v);
            if (role === "owner") return ownerCell(v);
            // RLDAS date fields arrive as ISO — humanize them
            return /^\d{4}-\d{2}-\d{2}T/.test(v) ? formatWhen(v) : v;
          },
        });
      }
      if (!wanted.includes("Modified")) columns.push(modifiedCol);
      columns.push(kebabCol);
      return columns;
    };

    /** Favourite wiring shared by the overlay and the row kebab. */
    const favToggleFor = (row: DocRow) => async (): Promise<boolean> => {
      const next = await toggleFavorite(whoId, {
        uniqueId: row.uniqueId,
        name: row.name,
        ext: row.ext,
        serverUrl: row.serverUrl,
        listId: row.listId,
      });
      if (!dead) {
        favs = next;
        if (favMode) void load(true);
      }
      return next.some((f) => f.uniqueId === row.uniqueId);
    };

    /** Share one document (5I): the permalink opens the app on this
     *  document alone — preview up, details collapsed (the default) —
     *  plus a QR of the same link for print or a wall poster. */
    const openShareDoc = (row: DocRow) => {
      const url = docLinkUrl(row.listId, row.id);
      const dlg = openDialog({
        host: dialogHost,
        title: `Share — ${row.name}`,
        buttons: [{ label: "Close", kind: "secondary", onClick: () => dlg.close() }],
      });
      dlg.body.appendChild(
        el(
          "div",
          "app-field-hint",
          "Opens JUST this document — full-screen, no navigation: made for reading " +
            "a procedure in the field. Anyone with app access can follow it."
        )
      );
      const linkRow = el("div", "app-docs-sharelink");
      const input = el("input", "app-input") as HTMLInputElement;
      input.readOnly = true;
      input.value = url;
      input.addEventListener("focus", () => input.select());
      const copyBtn = el("button", "app-btn app-btn-primary", "Copy link") as HTMLButtonElement;
      copyBtn.addEventListener("click", () => {
        void navigator.clipboard.writeText(url).then(() => {
          copyBtn.textContent = "Copied ✓";
          window.setTimeout(() => (copyBtn.textContent = "Copy link"), 1500);
        });
      });
      linkRow.append(input, copyBtn);
      dlg.body.appendChild(linkRow);
      // the QR: a scan happens on a PHONE, so it carries the ms-apps
      // deep link that opens Power Apps MOBILE directly (browser users
      // take the text link above — no toggle needed, Ben 2026-08-07)
      const mobileUrl = docLinkUrlMobile(row.listId, row.id);
      const qrLabel = el("div", "app-field-hint", "");
      const qrHost = el("div", "app-docs-shareqr");
      // the copied image IS the displayed canvas: title band + code,
      // ready for a job pack or a laminated poster
      const copyQrBtn = el("button", "app-btn", "Copy QR image") as HTMLButtonElement;
      copyQrBtn.style.display = "none";
      const qrActions = el("div", "app-docs-shareqractions");
      qrActions.appendChild(copyQrBtn);
      dlg.body.append(qrHost, qrActions, qrLabel);
      const stem = row.ext !== "" ? row.name.slice(0, -(row.ext.length + 1)) : row.name;
      copyQrBtn.addEventListener("click", () => {
        const canvas = qrHost.querySelector("canvas");
        if (canvas === null) return;
        canvas.toBlob((blob) => {
          if (blob === null) return;
          void navigator.clipboard
            .write([new ClipboardItem({ "image/png": blob })])
            .then(
              () => {
                copyQrBtn.textContent = "Copied ✓";
                window.setTimeout(() => (copyQrBtn.textContent = "Copy QR image"), 1500);
              },
              () => {
                copyQrBtn.textContent = "Copy not supported here";
              }
            );
        }, "image/png");
      });
      qrLabel.textContent =
        "Scanning opens Power Apps mobile (the app must be installed). If " +
        "LeanBoard is already running, close it first — a scan cannot redirect " +
        "a running app.";
      // the encoder loads on demand — nobody pays its bytes until the
      // first Share
      void import("../../../shared/ui/qr").then(({ qrCanvas }) => {
        if (!qrHost.isConnected) return;
        clear(qrHost);
        const canvas = qrCanvas(mobileUrl !== "" ? mobileUrl : url, stem);
        if (canvas !== null) {
          qrHost.appendChild(canvas);
          copyQrBtn.style.display = "";
        } else {
          copyQrBtn.style.display = "none";
          qrHost.appendChild(
            el("div", "app-field-hint", "The link is too long for a QR code — copy it instead.")
          );
        }
      });
    };

    /** Does this document await an ACTIVITY from the viewer? Opens the
     *  details pane unprompted (Ben, 2026-08-08) — a pending decision
     *  hidden behind a collapsed pane is a prompt nobody hears. Same
     *  pending definition as the overlay's decision zone. */
    const needsMyActivity = (row: DocRow, lib: DocLibrary | null | undefined): boolean => {
      if (isMine(row)) return true; // checked out to me = mid-activity
      if (lifecycleActionsFor(row, lib).some((a) => a.primary)) return true;
      return canMarkReviewedRow(row, lib) && reviewDue(row);
    };
    const onRowOpen = (row: DocRow, openOpts?: { details?: boolean }) => {
      const lib = byListId.get(row.listId) ?? current;
      // the drive is per LIBRARY, and the PDF routes need it — resolve
      // before opening (cached, so only the first open of a library pays)
      void driveIdFor(app.siteUrl, row.listId || lib?.listId || "").then((driveId) => {
        if (dead) return;
        const libStatusCol = lib?.config.columns.find((c) => c.role === "status") ?? null;
        // a previous overlay's repaint must not outlive it
        viewerRepaints.clear();
        openDocViewer({
          site: app.siteUrl,
          row,
          driveId,
          libraryName: lib ? lib.config.title || lib.name : "",
          // collapsed is the default (5I) — a task-list open, or a
          // document this user holds, arrives with work to do
          detailsOpen: openOpts?.details ?? needsMyActivity(row, lib),
          share: () => openShareDoc(row),
          askToWork: lib?.libType === "working",
          // details pane (Vault V4): the register's fields, never
          // SharePoint's plumbing — exactly the available-ticked columns
          labels: Object.fromEntries(
            (lib?.config.columns ?? [])
              .filter((c) => c.label !== "")
              .map((c) => [c.internal, c.label])
          ),
          linkColumns: (lib?.config.columns ?? [])
            .filter((c) => c.role === "linkedDocuments")
            .map((c) => c.internal),
          // R6: date columns render in the one app format, from raw ISO
          dateColumns: siteDict.columns.filter((c) => isDateColumn(c)).map((c) => c.internal),
          // dictionary order — the same order the add form uses,
          // adjustable under Settings → Documents → Document columns
          columns: lib
            ? sortByDictionary(
                lib.config.columns.filter((c) => c.available).map((c) => c.internal),
                [...dictBy.keys()]
              )
            : undefined,
          // a getter, read on every details repaint: a lifecycle command
          // rewrites the status while the overlay is open, and the chip
          // must follow the buttons (Ben, 2026-08-04)
          statusValue: libStatusCol
            ? () => row.values[libStatusCol.internal] ?? ""
            : "",
          statusChipFor: statusChip,
          // the details pane's own repaint (chip + properties + version
          // history) — fired by refreshRow alongside the button repaints
          register: (repaint) => {
            viewerRepaints.add(repaint);
          },
          favorite:
            whoId === ""
              ? null
              : {
                  isFav: () => favs.some((f) => f.uniqueId === row.uniqueId),
                  toggle: favToggleFor(row),
                },
          // passed for every library that could EVER edit — a standard
          // opened as Approved grows its check-out buttons the moment
          // Start revision puts it in a content stage, without a reopen
          control:
            lib != null &&
            (lib.libType === "working" ||
              lib.libType === "revision" ||
              lib.libType === "standard")
              ? {
                // read live: a command run behind the overlay has to
                // move these buttons too
                state: () => ({
                  checkedOut: (row.checkoutName ?? "") !== "",
                  mine: isMine(row),
                  by: row.checkoutName ?? "",
                  canEdit: canEditContent(lib, row),
                  canProps: canEditProps(row, lib),
                  canReplace: canReplaceContent(row, lib),
                }),
                register: (repaint) => {
                  viewerRepaints.add(repaint);
                },
                checkOut: () => runCommand("out", row),
                checkIn: () => openCheckIn(row),
                discard: () => openDiscard(row),
                editProps: () => openEditPropertiesRow(row),
                replace: () => openReplaceContentRow(row),
                editUrl: editSourceUrl(row),
              }
            : null,
          lifecycle:
            lib?.libType === "standard"
              ? {
                  actions: () => [
                    ...lifecycleActionsFor(row, lib).map((c) => ({
                      key: c.key,
                      label: c.label,
                      primary: c.primary,
                    })),
                    // primary exactly when due (R5): the task-panel row
                    // lands here and the decision zone must offer the
                    // job the row promised
                    ...(canMarkReviewedRow(row, lib)
                      ? [{ key: "markReviewed", label: "Mark reviewed…", primary: reviewDue(row) }]
                      : []),
                    ...(canCancelRevision(row, lib)
                      ? [{ key: "cancelRevision", label: "Cancel revision…", primary: false }]
                      : []),
                    // the not-named user's one door (5G2) — offered
                    // exactly where the lifecycle offers nothing
                    ...(canRequestAccess(row, lib)
                      ? [{ key: "requestAccess", label: requestAccessLabel(row), primary: false }]
                      : []),
                    // a live grant the viewer may end early (5G3)
                    ...(canRevokeAccess(row, lib)
                      ? [{ key: "revokeAccess", label: "Revoke edit access…", primary: false }]
                      : []),
                    // the grantee's own exit while the grant is UNUSED —
                    // once revising, Discard check-out is the road out
                    ...(discardEndsMyGrant(row) && !isMine(row)
                      ? [{ key: "endMyAccess", label: "End my edit access…", primary: false }]
                      : []),
                  ],
                  run: (key) => {
                    if (key === "markReviewed") {
                      openMarkReviewedRow(row);
                      return;
                    }
                    if (key === "cancelRevision") {
                      openCancelRevisionRow(row);
                      return;
                    }
                    if (key === "requestAccess") {
                      openRequestAccessRow(row);
                      return;
                    }
                    if (key === "revokeAccess") {
                      openRevokeAccessRow(row);
                      return;
                    }
                    if (key === "endMyAccess") {
                      openEndMyAccess(row);
                      return;
                    }
                    const cmd = lifecycleActionsFor(row, lib).find((c) => c.key === key);
                    if (cmd !== undefined) runLifecycle(row, cmd);
                  },
                  register: (repaint) => {
                    viewerRepaints.add(repaint);
                  },
                }
              : null,
        });
        // arm the request-access button with this user's live request
        // state — the repaint set was just cleared and re-registered
        if (canRequestAccess(row, lib)) void refreshRequestState(row);
        // standards: one arming read so gates see EVERY gate column —
        // the register feed deliberately carries only some of them (the
        // grant column would be lookup thirteen); no badge churn
        if (lib?.libType === "standard") void refreshRow(row, false);
      });
    };

    // ---- the register: one host, two views (Vault V3) ------------------
    // Sort and the Modified window are server-side; switching view or
    // density rebuilds the component and re-seats the loaded rows.
    const listHost = el("div", "app-docs-registerhost");
    main.appendChild(listHost);
    // every row is rendered by the browse feed, so the chosen sort always
    // applies — there is no relevance order left to preserve
    let sort: { key: string; asc: boolean } = { key: "modified", asc: false };
    let viewMode: "list" | "tiles" = uiState.viewMode === "tiles" ? "tiles" : "list";
    let density: "comfortable" | "compact" =
      uiState.density === "compact" ? "compact" : "comfortable";
    let bucket: "full" | "mid" | "narrow" = "full";

    const emptyExtra = (): HTMLElement | null => {
      if (filters.length === 0 && modifiedDays === 0 && query.trim() === "") return null;
      const b = el("button", "app-btn app-docs-clearfilters", "Clear all filters") as HTMLButtonElement;
      b.addEventListener("click", () => {
        filters = [];
        modifiedDays = 0;
        query = "";
        search.value = "";
        paintTreeSelection();
        paintChips();
        void load(true);
      });
      return b;
    };

    let list: DocList<DocRow>;
    const buildRegister = () => {
      const prev: DocRow[] = list !== undefined ? list.rows() : [];
      list?.destroy();
      list =
        viewMode === "tiles"
          ? mountDocTiles(listHost, {
              onRow: onRowOpen,
              onNearEnd: () => void loadMore(),
              emptyText: favMode
                ? "No favourites yet — open a document's ⋮ menu and choose ☆ Add to favourites."
                : "No documents here yet.",
              emptyExtra,
              statusChip: statusCol ? statusChip : null,
              statusColumn: statusCol?.internal ?? "",
              typeColumn: internalForRole("docType"),
              thumbUrlFor: (row) => tileThumbFor(app.siteUrl, row),
            })
          : mountDocList<DocRow>(listHost, {
              columns: buildColumns(),
              onRow: onRowOpen,
              onNearEnd: () => void loadMore(),
              emptyText: favMode
                ? "No favourites yet — open a document's ⋮ menu and choose ☆ Add to favourites."
                : "No documents here yet.",
              emptyExtra,
              sort,
              onSort: (key) => {
                sort = sort.key === key ? { key, asc: !sort.asc } : { key, asc: key === "name" };
                buildRegister();
                void load(true);
              },
              density,
            });
      if (prev.length > 0) list.setRows(prev);
    };
    buildRegister();
    const loadedRows = (): DocRow[] => list.rows();

    const paintSeg = () => {
      segList.classList.toggle("app-docs-segbtn-on", viewMode === "list");
      segTiles.classList.toggle("app-docs-segbtn-on", viewMode === "tiles");
      segList.setAttribute("aria-pressed", String(viewMode === "list"));
      segTiles.setAttribute("aria-pressed", String(viewMode === "tiles"));
    };
    paintSeg();
    segList.addEventListener("click", () => {
      if (viewMode === "list") return;
      viewMode = "list";
      persistUi({ viewMode });
      paintSeg();
      buildRegister();
    });
    segTiles.addEventListener("click", () => {
      if (viewMode === "tiles") return;
      viewMode = "tiles";
      persistUi({ viewMode });
      paintSeg();
      buildRegister();
    });

    // width buckets: the pane, not the window — the hub splits the screen
    const bucketFor = (w: number): "full" | "mid" | "narrow" =>
      w < 380 ? "narrow" : w < 560 ? "mid" : "full";
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w === 0) return;
      const b = bucketFor(w);
      if (b !== bucket) {
        bucket = b;
        if (viewMode === "list") buildRegister();
      }
    });
    ro.observe(main);
    innerCleanups.push(() => ro.disconnect());

    // ---- document control (Phase 4B): the commands -----------------------
    // Check-out, check-in and discard. Three rules hold the whole thing
    // together: only libraries meant to be worked on offer them; only
    // SharePoint decides whether the write lands; and afterwards the row
    // is re-read from list REST, never from the index, because the index
    // lags and a command's own result must not be a guess.
    // (The shared state — permsByLib, permsReady, dialogHost — lives up
    // near the top of the mount: the toolbar's Add button reads it
    // synchronously long before this section runs.)

    /** Re-read one document's live state — check-out, status, the gate
     *  columns — and repaint just it. A full reload would lose the
     *  scroll position and re-ask for everything, to answer a question
     *  about one row. One list-door call since 5B: lifecycle commands
     *  change status and version, not only the check-out. */
    const refreshRow = async (row: DocRow, withBadge = true) => {
      // ONLY columns this library carries — an uncarried field is a
      // guaranteed RLDAS 400, and a silently failed refresh left the
      // overlay painting the old stage (Ben, 2026-08-04)
      const carried = new Set(
        (byListId.get(row.listId)?.config.columns ?? []).map((c) => c.internal)
      );
      const fields = [
        statusInternal,
        ownerInternal,
        approversInternal,
        reviewersInternal,
        revEditorsInternal,
      ].filter((f) => f !== "" && carried.has(f));
      fields.push("CheckoutUser");
      // a freshly created grant column may exist on the LIST before the
      // library CONFIG learns it — for standards, ask for it anyway and
      // fall back to carried-only if the optimistic guess 400s (a stale
      // config must not hide a live grant from its grantee)
      const lib = byListId.get(row.listId);
      const optimistic =
        lib?.libType === "standard" &&
        revEditorsInternal !== "" &&
        !fields.includes(revEditorsInternal)
          ? [...fields, revEditorsInternal]
          : fields;
      let page: Awaited<ReturnType<typeof renderListPage>>;
      try {
        page = await renderListPage(
          app.siteUrl,
          row.listId,
          buildRenderViewXml({ idIn: [row.id], fields: optimistic, rowLimit: 1 })
        );
        if (optimistic !== fields) fields.push(revEditorsInternal);
      } catch (e) {
        if (optimistic === fields) throw e;
        page = await renderListPage(
          app.siteUrl,
          row.listId,
          buildRenderViewXml({ idIn: [row.id], fields, rowLimit: 1 })
        );
      }
      const fresh = page.rows[0];
      if (fresh !== undefined) {
        row.checkoutName = fresh.checkoutName ?? "";
        row.checkoutEmail = fresh.checkoutEmail ?? "";
        for (const f of fields) {
          if (f === "CheckoutUser") continue;
          row.values[f] = fresh.values[f] ?? "";
          const emailKey = `${f}#email`;
          if (fresh.values[emailKey] !== undefined) row.values[emailKey] = fresh.values[emailKey];
          else delete row.values[emailKey];
        }
      }
      list?.setRows(list.rows());
      for (const rp of viewerRepaints) rp();
      // a command that changes checkout state changes the My tasks count
      // (skipped for the overlay-open arming read, which changed nothing)
      if (withBadge) refreshTasksBadge();
    };

    const commandFailed = (what: string, why: string) => {
      const dlg = openDialog({
        host: dialogHost,
        title: `${what} did not go through`,
        buttons: [{ label: "Close", kind: "secondary", onClick: () => dlg.close() }],
      });
      // SharePoint's own sentence, not the JSON-inside-JSON it travels in
      dlg.body.appendChild(
        el(
          "div",
          "app-field-hint",
          why !== "" ? spErrorText(why) : "SharePoint refused it without saying why."
        )
      );
    };

    /**
     * What SharePoint says about this file RIGHT NOW. The register's row
     * is a snapshot: the document may have been checked in from Office,
     * or the check-out discarded in SharePoint, since it was painted —
     * and acting on the snapshot is what produced "the file is not
     * checked out" against a button that offered to check it in (Ben,
     * 2026-08-03). Every command asks first.
     */
    const liveCheckout = async (row: DocRow): Promise<"none" | "held" | "unknown"> => {
      const info = await fetchFileInfo(app.siteUrl, row.serverUrl);
      if (!info.ok) return "unknown";
      const t = Number(((info.data ?? {}) as { CheckOutType?: unknown }).CheckOutType ?? 2);
      return t === 2 ? "none" : "held";
    };

    const staleNotice = async (row: DocRow, what: string) => {
      await refreshRow(row);
      const dlg = openDialog({
        host: dialogHost,
        title: `${what} is no longer available`,
        buttons: [{ label: "OK", kind: "secondary", onClick: () => dlg.close() }],
      });
      dlg.body.appendChild(
        el(
          "div",
          "app-field-hint",
          "SharePoint says this document is not checked out any more — someone may have " +
            "checked it in, or it was done from Office. The register has been brought up to date."
        )
      );
    };

    const runCommand = async (
      kind: "out" | "undo",
      row: DocRow
    ): Promise<void> => {
      // ask SharePoint what is true before acting on a painted row
      const live = await liveCheckout(row);
      if (kind === "undo" && live === "none") {
        await staleNotice(row, "Discard");
        return;
      }
      if (kind === "out" && live === "held") {
        await refreshRow(row);
        commandFailed("Check-out", "Someone checked this document out first.");
        return;
      }
      const res =
        kind === "out"
          ? await checkOutFile(app.siteUrl, row.serverUrl)
          : await undoCheckOut(app.siteUrl, row.serverUrl);
      if (!res.ok) {
        commandFailed(kind === "out" ? "Check-out" : "Discard", res.status);
        return;
      }
      await refreshRow(row);
      // a GRANTEE's discard ends their own grant with it (Ben,
      // 2026-08-06): self out of the column, seat released unless
      // another live grant needs it. The discard already landed, so a
      // failure here warns rather than undoes anything.
      if (kind === "undo" && discardEndsMyGrant(row)) {
        const { endOwnGrant } = await import("./accessRequests");
        const warn = await endOwnGrant({
          site: app.siteUrl,
          row,
          revEditorsInternal,
          myEmail,
          myName: currentViewer()?.name ?? "",
          current: grantEmails(row),
        }).catch((e) => `Your edit access was not ended: ${String(e).slice(0, 200)}`);
        if (warn !== "") commandFailed("Ending edit access", warn);
        await refreshRow(row);
      }
    };
    /** Discarding on a granted standard where I am a grantee (but not
     *  the owner/an admin — their check-outs are ordinary work). */
    const discardEndsMyGrant = (row: DocRow): boolean => {
      const lib = byListId.get(row.listId);
      if (lib?.libType !== "standard" || revEditorsInternal === "" || myEmail === "") return false;
      if (!grantEmails(row).includes(myEmail)) return false;
      const g = lifecycleGatesFor(row);
      return !g.isOwner && !g.isAdmin && !g.isApprover;
    };

    /** Check-in asks for a comment and REQUIRES it (Ben, 2026-08-03):
     *  the entry an auditor reads is worth more than a keystroke saved,
     *  so the button stays disabled until there is something to read. */
    const openCheckIn = (row: DocRow) => {
      let major = false;
      const comment = el("textarea", "app-input app-docs-cicomment") as HTMLTextAreaElement;
      comment.rows = 3;
      comment.placeholder = "What changed?";
      const dlg = openDialog({
        host: dialogHost,
        title: `Check in ${row.name}`,
        buttons: [
          { label: "Cancel", kind: "secondary", onClick: () => dlg.close() },
          {
            label: "Check in",
            kind: "primary",
            onClick: () => {
              const text = comment.value.trim();
              if (text === "") return;
              dlg.close();
              void (async () => {
                if ((await liveCheckout(row)) === "none") {
                  await staleNotice(row, "Check-in");
                  return;
                }
                const res = await checkInFile(app.siteUrl, row.serverUrl, text, major);
                if (!res.ok) commandFailed("Check-in", res.status);
                else await refreshRow(row);
              })();
            },
          },
        ],
      });
      const submit = dlg.root.querySelector(".ltk-btn-primary") as HTMLButtonElement | null;
      const sync = () => {
        if (submit) submit.disabled = comment.value.trim() === "";
      };
      comment.addEventListener("input", sync);
      sync();
      const kinds = el("div", "app-docs-cikinds");
      for (const opt of [
        { label: "Minor version — still a draft", value: false },
        { label: "Major version", value: true },
      ]) {
        const wrap = el("label", "app-docs-check");
        const radio = el("input", "") as HTMLInputElement;
        radio.type = "radio";
        radio.name = "ltk-checkin-kind";
        radio.checked = opt.value === major;
        radio.addEventListener("change", () => {
          major = opt.value;
        });
        wrap.append(radio, document.createTextNode(` ${opt.label}`));
        kinds.appendChild(wrap);
      }
      dlg.body.append(el("div", "app-field-label", "Comment"), comment, kinds);
      comment.focus();
    };

    /** Discarding destroys the edits made under the check-out and
     *  SharePoint keeps no copy — so it confirms, and says that. */
    const openDiscard = (row: DocRow) => {
      const dlg = openDialog({
        host: dialogHost,
        title: `Discard your check-out of ${row.name}?`,
        buttons: [
          { label: "Keep it checked out", kind: "secondary", onClick: () => dlg.close() },
          {
            label: "Discard",
            kind: "danger",
            onClick: () => {
              dlg.close();
              void runCommand("undo", row);
            },
          },
        ],
      });
      dlg.body.appendChild(
        el(
          "div",
          "app-field-hint",
          "Everything changed since the check-out is lost. SharePoint keeps no copy of it."
        )
      );
      if (discardEndsMyGrant(row)) {
        dlg.body.appendChild(
          el(
            "div",
            "app-field-hint",
            "This also ENDS your edit access on this document — request again if you need another go."
          )
        );
      }
    };

    // ---- kebab menu ----------------------------------------------------
    let menu: HTMLElement | null = null;
    const closeMenu = () => {
      menu?.remove();
      menu = null;
    };
    const onMenuPointer = (e: PointerEvent) => {
      if (menu && !menu.contains(e.target as Node)) closeMenu();
    };
    document.addEventListener("pointerdown", onMenuPointer);
    innerCleanups.push(() => document.removeEventListener("pointerdown", onMenuPointer));
    // Escape cascade (Vault V5): an open menu/popover eats Escape before
    // any overlay behind it — capture phase, so it runs first
    const onMenuKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && menu) {
        e.stopPropagation();
        closeMenu();
      }
    };
    document.addEventListener("keydown", onMenuKey, true);
    innerCleanups.push(() => document.removeEventListener("keydown", onMenuKey, true));
    const openKebab = (anchor: HTMLElement, row: DocRow) => {
      closeMenu();
      menu = el("div", "app-docs-menu");
      const item = (label: string, onPick: (() => void) | null, hint = "") => {
        const b = el("button", "app-docs-menuitem", label) as HTMLButtonElement;
        if (onPick) {
          b.addEventListener("click", () => {
            closeMenu();
            onPick();
          });
        } else {
          b.disabled = true;
          if (hint !== "") b.title = hint;
        }
        menu!.appendChild(b);
      };
      const lib = byListId.get(row.listId) ?? current;
      // R10 (design review 2026-08-08): grouped, not flat — Open PDF
      // first, then (link/share), (work-on-it + favourites), (review),
      // and the lifecycle transitions LAST behind their own separator.
      // A divider only lands between non-empty groups.
      const divider = () => {
        if (menu!.childElementCount === 0) return;
        if (menu!.lastElementChild?.classList.contains("app-docs-menusep")) return;
        menu!.appendChild(el("div", "app-docs-menusep", ""));
      };
      // readers get the PDF rendering, never the editable source.
      // A LINK, not a button running window.open: `window.open("",
      // "_blank", "noopener")` returns null — that is what noopener
      // means — so the old handler had nothing to point at, and the
      // retry that fired when the drive resolved was no longer a user
      // gesture, so the popup blocker ate it and the item did nothing
      // (Ben, 2026-08-02). The link carries the site-scoped viewer URL
      // immediately and upgrades to the converted-PDF one when the drive
      // resolves — a cached lookup, so normally before the click.
      let bestPdf = pdfViewUrlFor(app.siteUrl, "", row);
      const openPdf = el("a", "app-docs-menuitem", "Open PDF ↗") as HTMLAnchorElement;
      openPdf.href = bestPdf;
      openPdf.target = "_blank";
      openPdf.rel = "noopener";
      openPdf.addEventListener("click", () => closeMenu());
      menu.appendChild(openPdf);
      void driveIdFor(app.siteUrl, row.listId || lib?.listId || "").then((d) => {
        bestPdf = pdfViewUrlFor(app.siteUrl, d, row);
        openPdf.href = bestPdf;
      });
      divider();
      item("Copy link", () => {
        void navigator.clipboard.writeText(bestPdf);
      });
      item("Share document…", () => openShareDoc(row));
      divider();
      // work-on-it group — properties, content, check-out, favourites
      if (canEditProps(row, lib)) {
        item("Edit properties…", () => openEditPropertiesRow(row));
      }
      if (canReplaceContent(row, lib)) {
        item("Replace content…", () => openReplaceContentRow(row));
      }
      const lcCmds = lifecycleActionsFor(row, lib);
      const revise = lcCmds.find((c) => c.key === "revise");
      if (revise !== undefined) {
        item(`${revise.label}…`, () => runLifecycle(row, revise));
      }
      if (canEditContent(lib, row)) {
        const held = (row.checkoutName ?? "") !== "";
        if (!held) {
          item("Check out", () => void runCommand("out", row));
        } else if (isMine(row)) {
          item("Check in…", () => openCheckIn(row));
          item("Discard check-out", () => openDiscard(row));
        } else {
          item(`Checked out by ${row.checkoutName}`, null, "Only they can check it in");
        }
      }
      if (whoId !== "") {
        const isFav = favs.some((f) => f.uniqueId === row.uniqueId);
        item(isFav ? "★ Remove favourite" : "☆ Add to favourites", () => {
          void favToggleFor(row)();
        });
      }
      divider();
      if (canMarkReviewedRow(row, lib)) {
        item("Mark reviewed…", () => openMarkReviewedRow(row));
      }
      divider();
      // lifecycle TRANSITIONS last, behind their own line — a stage
      // move must never sit shoulder to shoulder with Copy link
      for (const cmd of lcCmds.filter((c) => c.key !== "revise")) {
        item(`${cmd.label}…`, () => runLifecycle(row, cmd));
      }
      if (canCancelRevision(row, lib)) {
        item("Cancel revision…", () => openCancelRevisionRow(row));
      }
      if (menu.lastElementChild?.classList.contains("app-docs-menusep")) {
        menu.lastElementChild.remove();
      }
      const r = anchor.getBoundingClientRect();
      menu.style.top = `${r.bottom + 4}px`;
      menu.style.left = `${Math.max(8, r.right - 200)}px`;
      document.body.appendChild(menu);
    };

    // ---- data flow -----------------------------------------------------
    let generation = 0;
    let inFlight = false;
    let done = false;
    /** A reset asked for while a load was in flight (typing during a
     *  page): replayed when the load finishes, or the keystroke that
     *  landed mid-flight would silently never be queried. */
    let pendingReset = false;
    /** Per-library feed state for the browse union (RenderListDataAsStream). */
    interface BrowseFeed {
      listId: string;
      viewXml: string;
      buf: DocRow[];
      next: string;
      done: boolean;
    }
    let feeds: BrowseFeed[] = [];
    /** Library-total for plain browsing ("50 of 150"); null = unknown. */
    let knownTotal: number | null = null;
    /** How many documents match the CURRENT question — null until it
     *  answers, or when the answer would be a floor dressed as a total. */
    let matchTotal: number | null = null;
    /** listId (lowercase) → item ids the index matched inside documents,
     *  resolved once per reset and OR'd into every page's CAML. */
    let contentIds = new Map<string, number[]>();
    /** Honesty about the content half: "" fine, "capped" the index had
     *  more matches than one CAML In can carry, "failed" the index did
     *  not answer (name matching still stands). */
    let contentsNote: "" | "capped" | "failed" = "";

    /**
     * Status values meaning "this is the approved copy", read from the
     * status column's own term set — never typed here. Empty when the
     * set cannot be read, and the register then falls back to hiding
     * non-current rows client-side, which is what it did before.
     */
    let approvedLabels: string[] = [];
    /**
     * The silent status clause ([] when the toggle is off or the status
     * vocabulary could not be read). It applies to EVERY library,
     * working ones included (Ben, 2026-08-03): "only Approved" that
     * quietly excused a library would be answering a different question
     * there — a working library simply shows nothing until its drafts
     * are approved, which is the honest answer.
     */
    const approvedFilterFor = (): { cols: string[]; labels: string[] }[] =>
      onlyApproved && statusInternal !== "" && approvedLabels.length > 0
        ? [{ cols: [statusInternal], labels: approvedLabels }]
        : [];

    const applyNonCurrent = (rows: DocRow[]): DocRow[] => {
      // a no-op once the CAML filter carries this; it still covers the
      // case where the term set could not be read
      if (!onlyApproved || !statusCol || approvedLabels.length > 0) return rows;
      // every library, working ones included — the fallback has to mean
      // what the CAML filter means
      return rows.filter((r) => !isNonCurrentStatus(r.values[statusCol.internal] ?? ""));
    };

    const paintStatus = (total: number | null, error: string) => {
      if (error !== "") {
        status.textContent = `Something refused: ${error}`;
        return;
      }
      const n = list.count();
      if (n === 0) {
        // an empty answer names the way out rather than dead-ending
        status.textContent =
          filters.length > 0 || query.trim() !== ""
            ? "No documents match — clear filters or change the search."
            : "No documents here yet.";
        return;
      }
      const docs = (k: number) => `${k} document${k === 1 ? "" : "s"}`;
      // plain browsing shows the LIBRARY total up front (ItemCount), so
      // the number does not creep up as pages load (Ben, 2026-08-02)
      const plainBrowse =
        query.trim() === "" && filters.length === 0 && dateFilters.length === 0;
      const note =
        contentsNote === "capped"
          ? ` · top ${CONTENT_HITS} content matches`
          : contentsNote === "failed"
            ? " · contents search unavailable"
            : "";
      // the counted total wins where it is known: a library's raw
      // ItemCount knows nothing of "Show only Approved"
      const shown = matchTotal ?? total;
      const suffix = plainBrowse ? "" : " matching";
      status.textContent =
        (shown !== null
          ? shown > n
            ? `${docs(n)} of ${shown}${suffix}`
            : `${docs(shown)}${suffix}`
          : // no total known: say what this IS — a running count — rather
            // than dressing "what has loaded" as "what there is" (Ben,
            // 2026-08-08: the header climbed as you scrolled)
            done
            ? `${docs(n)}${suffix}`
            : `${docs(n)} so far`) + note;
    };

    /**
     * How many documents match the register's current question.
     *
     * RLDAS cannot answer "how many" without returning them, and our
     * filters are CAML (taxonomy labels, date windows), so no OData
     * $count can stand in. This asks the same Where a SECOND time for
     * the CORE fields only — a small payload — which is what makes a
     * header total possible without the reader scrolling to earn it.
     *
     * This is the folder-count query's honest half: one request per
     * library, no per-term tally. The tally was the part that lied
     * (same-named departments merged) and the part that multiplied.
     */
    const refreshMatchTotal = (gen: number) => {
      const libs =
        taskFilter === null
          ? viewLibs()
          : libraries.filter((l) => (taskFilter?.get(l.listId.toLowerCase())?.length ?? 0) > 0);
      if (favMode || libs.length === 0) {
        matchTotal = null;
        return;
      }
      const words = query.trim() === "" ? undefined : query.trim().split(/\s+/);
      void Promise.all(
        libs.map((lib) => {
          const carried = new Set(lib.config.columns.map((c) => c.internal));
          return renderListPage(
            app.siteUrl,
            lib.listId,
            buildRenderViewXml({
              modifiedAfterIso: modifiedIso(),
              nameWords: words,
              idIn:
                taskFilter?.get(lib.listId.toLowerCase()) ??
                contentIds.get(lib.listId.toLowerCase()) ??
                [],
              termFilters: [
                ...filters.map((f) => ({
                  cols: f.col === "" ? [...orgCols] : [f.col],
                  labels: [...f.labels],
                })),
                ...approvedFilterFor(),
              ],
              dateRanges: dateFilters.filter((d) => carried.has(d.col)),
              // the status column only, and only to feed applyNonCurrent's
              // fallback — everything else the count needs is core
              fields:
                statusInternal !== "" && carried.has(statusInternal) ? [statusInternal] : [],
              rowLimit: COUNT_CAP,
            })
          );
        })
      ).then((pages) => {
        if (dead || gen !== generation) return;
        // a library past the cap (or one that refused) would report a
        // floor as if it were a total — the running count is honester
        matchTotal =
          pages.some((p) => p.next !== "" || p.error !== "")
            ? null
            : applyNonCurrent(pages.flatMap((p) => p.rows)).length;
        paintStatus(knownTotal, "");
      });
    };

    /** End of a load: drop the lock, then replay a reset that arrived
     *  mid-flight (the caller was turned away to keep one loader). */
    const finish = () => {
      inFlight = false;
      if (pendingReset && !dead) {
        pendingReset = false;
        void load(true);
      }
    };

    const load = async (reset: boolean) => {
      if (inFlight) {
        if (reset) pendingReset = true;
        return;
      }
      if (done && !reset) return;
      // favourites are local rows — no query, no paging
      if (favMode) {
        list.setRows(
          favs.map((f) => ({
            id: 0,
            uniqueId: f.uniqueId,
            name: f.name,
            ext: f.ext,
            serverUrl: f.serverUrl,
            listId: f.listId,
            modified: "",
            values: {},
          }))
        );
        done = true;
        status.textContent =
          favs.length === 0
            ? "No favourites yet"
            : `${favs.length} favourite${favs.length === 1 ? "" : "s"}`;
        return;
      }
      inFlight = true;
      const gen = reset ? ++generation : generation;
      if (reset) {
        done = false;
        feeds = [];
        list.setRows([]);
      }
      list.setLoading(true);
      // RenderListDataAsStream renders EVERYTHING: it is the modern-view
      // engine, returns display-ready labels, and CAMLs name search, the
      // Modified window and taxonomy label filters server-side per
      // library. The search index's one irreplaceable job is reading
      // INSIDE documents, and its rows carry no field text — so it feeds
      // item ids into the CAML rather than rendering rows of its own
      // (routing rows through it blanked the register's columns —
      // Ben, 2026-08-02).
      const browseIds = scopeAll ? allListIds : selectedIds;
      const words = query.trim() === "" ? undefined : query.trim().split(/\s+/);
      const wantContents = words !== undefined && searchContents;
      // the up-front total for plain browsing (library ItemCounts) —
      // withheld while "Show only Approved" filters the list: ItemCount
      // knows nothing of status, and with the folder-count query gone
      // (2026-08-08) there is no counted total to correct it, so "12 of
      // 100" would describe a longer list than the one on screen
      if (reset) {
        knownTotal = null;
        matchTotal = null;
        if (
          words === undefined &&
          modifiedDays === 0 &&
          filters.length === 0 &&
          dateFilters.length === 0 &&
          taskFilter === null &&
          (!onlyApproved || statusInternal === "")
        ) {
          void Promise.all(browseIds.map((id) => listItemCount(app.siteUrl, id))).then(
            (counts) => {
              if (dead || gen !== generation) return;
              if (!counts.some((c) => c < 0)) {
                knownTotal = counts.reduce((a, b) => a + b, 0);
                paintStatus(knownTotal, "");
              }
            }
          );
        }
      }
      // "Match contents & every field" resolves to a set of item ids the
      // index matched inside the documents; those ids ride every page's
      // CAML alongside the name match, so the depth toggle can only ever
      // ADD documents to the name-only answer. Resolved once per reset —
      // the ids are baked into each feed's ViewXml.
      if (reset) {
        contentIds = new Map();
        contentsNote = "";
        if (wantContents) {
          const hits = await searchPage(app.siteUrl, query, {
            listIds: browseIds,
            rowLimit: CONTENT_HITS,
            startRow: 0,
            searchContents: true,
            modifiedAfterIso: modifiedIso(),
            termFilters: filters.map((f) => ({ properties: propsFor(f.col), termIds: f.ids })),
          });
          if (dead || gen !== generation) return finish();
          if (hits.error !== "") {
            contentsNote = "failed";
          } else {
            for (const r of hits.rows) {
              if (r.id <= 0 || r.listId === "") continue;
              const bucket = contentIds.get(r.listId) ?? [];
              bucket.push(r.id);
              contentIds.set(r.listId, bucket);
            }
            if (hits.total > hits.rows.length) contentsNote = "capped";
          }
        }
      }
      // the header's total, asked alongside the first page rather than
      // before it — the rows are what the reader is waiting for
      if (reset) refreshMatchTotal(gen);
      {
        // browse via RenderListDataAsStream (single library or union):
        // display-ready values for every field type, with name search,
        // the Modified window and taxonomy label filters all CAML'd
        // SERVER-side per library; feeds k-way merge client-side and a
        // drained buffer refills mid-page so the merge never skips rows
        if (feeds.length === 0) {
          // under the task filter, the TASK documents' libraries define
          // the scope — whatever was ticked in the nav (a task in an
          // unticked library must still show), and a library holding
          // none contributes no feed (an empty idIn would mean "no
          // constraint" and flood the scope back in)
          const feedIds =
            taskFilter === null
              ? browseIds
              : allListIds.filter((id) => (taskFilter?.get(id.toLowerCase())?.length ?? 0) > 0);
          feeds = feedIds.map((id) => {
            const lib = byListId.get(id.toLowerCase());
            // ONLY the fields the register renders: SharePoint throttles
            // any query touching >12 lookup-type columns (taxonomy and
            // person columns all count — Ben's SPQueryThrottledException,
            // 2026-08-02), so "every available column" is not requestable
            const carried = new Set((lib?.config.columns ?? []).map((c) => c.internal));
            const fieldsFor = (): string[] => {
              const out = new Set<string>();
              // EVERY library in view gets the register's columns, not
              // just the one that happened to be "current" — that test
              // is why a multi-library browse fetched no DMS fields at
              // all and rendered three bare columns (C3).
              const shown =
                chosenColumns.length > 0 ? chosenColumns : defaultInternals();
              for (const internal of shown) {
                // asking a library for a column it does not carry is a
                // guaranteed 400 from RLDAS, so each feed asks only for
                // what its own list actually has
                if (internal !== "Modified" && carried.has(internal)) out.add(internal);
              }
              for (const internal of [statusInternal, ownerInternal]) {
                if (internal !== "" && carried.has(internal)) out.add(internal);
              }
              for (const c of groupBy === "" ? [...orgCols] : [groupBy]) out.add(c);
              // who holds it checked out — asked for ONLY where documents
              // can be worked on. It is a person field, so it is a lookup,
              // and this tenant throttles a view past twelve of those
              // (Phase 0). A read-only register pays nothing for 4B.
              const feedLib = byListId.get(id.toLowerCase());
              if (
                feedLib?.libType === "working" ||
                feedLib?.libType === "revision" ||
                // standards too since 5C+: content edits ride check-out
                // while a standard is in a content stage
                feedLib?.libType === "standard"
              ) {
                out.add("CheckoutUser");
              }
              // the approve gate reads the approvers column's EMAILS, so
              // standards feeds carry it (another lookup — scoped to the
              // one library type that needs it, same throttle logic)
              if (
                feedLib?.libType === "standard" &&
                approversInternal !== "" &&
                carried.has(approversInternal)
              ) {
                out.add(approversInternal);
              }
              // the overlay's "Review due" decision (R5) judges the next
              // review date FROM THE ROW — a feed that omits the column
              // leaves reviewDue blind and the prompt silent (Ben's
              // Ship Loader repro, 2026-08-08). A date, not a lookup, so
              // it costs nothing against the throttle.
              if (
                feedLib?.libType === "standard" &&
                reviewInternal !== "" &&
                carried.has(reviewInternal)
              ) {
                out.add(reviewInternal);
              }
              return [...out];
            };
            const viewXml = buildRenderViewXml({
              sortName: sort.key === "name",
              asc: sort.asc,
              modifiedAfterIso: modifiedIso(),
              nameWords: words,
              idIn: taskFilter?.get(id.toLowerCase()) ?? contentIds.get(id.toLowerCase()) ?? [],
              termFilters: [
                ...filters.map((f) => ({
                  cols: f.col === "" ? [...orgCols] : [f.col],
                  labels: [...f.labels],
                })),
                // applied silently: no chip, no filter row — the toggle
                // says it (Ben, 2026-08-03)
                ...approvedFilterFor(),
              ],
              // only bind a date column the library actually carries
              dateRanges: dateFilters.filter((d) => carried.has(d.col)),
              fields: fieldsFor(),
              rowLimit: PAGE,
            });
            return { listId: id, viewXml, buf: [], next: "", done: false };
          });
        }
        let feedError = "";
        const fill = async (f: BrowseFeed) => {
          if (f.done || f.buf.length > 0) return;
          const page = await renderListPage(app.siteUrl, f.listId, f.viewXml, f.next);
          f.buf.push(...page.rows);
          f.next = page.next;
          if (page.error !== "") {
            feedError = page.error;
            f.done = true;
          } else if (page.next === "") {
            f.done = true;
          }
        };
        const cmp = browseComparator(sort.key === "name" ? "name" : "modified", sort.asc);
        const rowsOut: DocRow[] = [];
        while (rowsOut.length < PAGE) {
          await Promise.all(feeds.map(fill));
          if (dead || gen !== generation) return finish();
          const i = pickBrowseHead(feeds.map((f) => f.buf), cmp);
          if (i < 0) break;
          rowsOut.push(feeds[i].buf.shift()!);
        }
        list.append(applyNonCurrent(rowsOut));
        done = feeds.every((f) => f.done && f.buf.length === 0);
        paintStatus(knownTotal, feedError);
      }
      list.setLoading(false);
      finish();
    };
    const loadMore = () => load(false);

    let debounce: ReturnType<typeof setTimeout> | null = null;
    search.addEventListener("input", () => {
      query = search.value;
      if (debounce !== null) clearTimeout(debounce);
      debounce = setTimeout(() => void load(true), 300);
    });

    // ---- share + register export ---------------------------------------
    const currentView = (): DocView => {
      const org = filterFor("");
      return {
        ...emptyDocView(),
        listId: current?.listId ?? "",
        query: query.trim(),
        contents: searchContents,
        nonCurrent: !onlyApproved,
        modifiedDays,
        // the organisation keeps its own slot so pre-3a links stay valid
        orgTermId: org?.node.id ?? "",
        orgPath: org?.node.labels ?? [],
        filters: filters
          .filter((f) => f.col !== "")
          .map((f) => ({ col: f.col, termId: f.node.id, path: f.node.labels })),
        columns: chosenColumns,
        groupBy,
        dates: dateFilters.map((d) => ({ ...d })),
      };
    };
    const copyViewLink = () => {
      void navigator.clipboard
        .writeText(docsViewUrl(encodeDocView(currentView())))
        .then(() => {
          status.textContent = "Link copied ✓ — it opens Documents exactly as you see it now.";
        });
    };

    // saved views (relocated from the nav, Ben 2026-08-01): one menu —
    // save the current state on top, the saved list beneath, delete per
    // row. Opening a view remounts in place, same as always.
    const openViewsMenu = () => {
      menu = el("div", "app-docs-menu app-docs-viewsmenu");
      const paint = () => {
        clear(menu!);
        const saveRow = el("div", "app-docs-saverow");
        const nameIn = el("input", "app-input app-docs-viewname") as HTMLInputElement;
        nameIn.placeholder = "Save current view as…";
        const saveB = el("button", "app-btn app-btn-primary", "Save") as HTMLButtonElement;
        const commit = () => {
          const name = nameIn.value.trim();
          if (name === "") return;
          void saveDocView(whoId, { ...currentView(), name }).then((list) => {
            if (dead) return;
            savedViews = list;
            paint();
          });
        };
        saveB.addEventListener("click", commit);
        nameIn.addEventListener("keydown", (e) => {
          if (e.key === "Enter") commit();
        });
        saveRow.append(nameIn, saveB);
        menu!.appendChild(saveRow);
        if (savedViews.length > 0) menu!.appendChild(el("div", "app-docs-menusep", ""));
        for (const v of savedViews) {
          const row = el("div", "app-docs-viewrow");
          const open = el("button", "app-docs-menuitem", v.name) as HTMLButtonElement;
          open.title = "Open this view";
          open.addEventListener("click", () => {
            closeMenu();
            pendingView = v;
            remount();
          });
          const del = el("button", "app-docs-viewbtn", "×") as HTMLButtonElement;
          del.title = `Delete “${v.name}”`;
          del.setAttribute("aria-label", `Delete the view ${v.name}`);
          del.addEventListener("click", () => {
            void deleteDocView(whoId, v.name).then((list) => {
              if (dead) return;
              savedViews = list;
              paint();
            });
          });
          row.append(open, del);
          menu!.appendChild(row);
        }
      };
      paint();
      const r = topKebab.getBoundingClientRect();
      menu.style.top = `${r.bottom + 4}px`;
      menu.style.left = `${Math.max(8, r.right - 280)}px`;
      document.body.appendChild(menu);
    };
    const EXPORT_CAP = 2000;
    let exporting = false;
    const exportRegister = () => {
      if (exporting) return;
      void (async () => {
        exporting = true;
        status.textContent = "Exporting…";
        const scopeLibs = viewLibs();
        // the register's own columns, named as the site names them and
        // in the same dictionary order — an export that disagreed with
        // the screen it came from would be its own small lie
        const wanted = sortByDictionary(
          chosenColumns.length > 0 ? chosenColumns : defaultInternals(),
          [...dictBy.keys()]
        );
        const cols = wanted
          .filter((i) => i !== "Modified")
          .map((i) => ({ internal: i, label: labelOf(i) }));
        const rows: string[][] = [];
        let truncated = false;
        // RLDAS, like the register (C3b): FieldValuesAsText renders
        // taxonomy as WssIds and drops whole columns depending on the
        // projection, so the old export could differ from the screen
        for (const lib of scopeLibs) {
          const carried = new Set(lib.config.columns.map((c) => c.internal));
          const viewXml = buildRenderViewXml({
            sortName: sort.key === "name",
            asc: sort.asc,
            fields: cols.map((c) => c.internal).filter((i) => carried.has(i)),
            rowLimit: 100,
          });
          let next = "";
          for (;;) {
            const page = await renderListPage(app.siteUrl, lib.listId, viewXml, next);
            for (const r of page.rows) {
              if (rows.length >= EXPORT_CAP) {
                truncated = true;
                break;
              }
              rows.push([
                r.name,
                lib.config.title || lib.name,
                formatWhen(r.modified),
                ...cols.map((c) => r.values[c.internal] ?? ""),
              ]);
            }
            next = page.next;
            if (next === "" || truncated || page.error !== "") break;
          }
          if (truncated) break;
        }
        const csv = toCsv(
          ["Document", "Library", "Modified", ...cols.map((c) => c.label)],
          rows
        );
        const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
        const a = el("a", "") as HTMLAnchorElement;
        a.href = URL.createObjectURL(blob);
        a.download = `documents-register-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
        exporting = false;
        status.textContent = `${rows.length} row(s) exported${truncated ? ` — capped at ${EXPORT_CAP}` : ""}`;
      })();
    };
    /** Pick the view's columns from the library's available set — the
     *  choice rides the view state, so saved views and shared links
     *  carry it (spec: "users can add/remove available columns"). */
    const chooseColumns = () => {
      const scrim = el("div", "app-docs-scrim");
      const dialog = el("div", "app-docs-dialog app-docs-chooser");
      scrim.appendChild(dialog);
      const head = el("div", "app-docs-viewhead");
      head.appendChild(el("span", "app-docs-viewname", "Choose columns"));
      const x = el("button", "app-btn app-docs-viewclose", "✕") as HTMLButtonElement;
      x.addEventListener("click", () => scrim.remove());
      head.appendChild(x);
      dialog.appendChild(head);
      const body = el("div", "app-docs-propsbody");
      dialog.appendChild(body);
      const effective =
        chosenColumns.length > 0 ? chosenColumns : [...defaultInternals(), "Modified"];
      // offerable = what the site says is available AND some library in
      // view actually carries; the chooser opens whatever the scope
      const carried = new Set(viewLibs().flatMap((l) => l.config.columns.map((c) => c.internal)));
      const entries = [
        ...siteDict.columns
          .filter((c) => c.available && carried.has(c.internal))
          .map((c) => ({ internal: c.internal, label: c.label !== "" ? c.label : c.internal })),
        { internal: "Modified", label: "Modified" },
      ];
      // ordered model: the shown columns first in their current order,
      // the rest after — ticks choose, drag sets the order (Ben,
      // 2026-07-30), and Apply reads the ticked rows top to bottom
      const rows: { internal: string; label: string; on: boolean }[] = [];
      for (const key of effective) {
        const e = entries.find((x) => x.internal === key);
        if (e) rows.push({ ...e, on: true });
      }
      for (const e of entries) {
        if (!rows.some((r) => r.internal === e.internal)) rows.push({ ...e, on: false });
      }
      body.appendChild(
        el("div", "app-field-hint", "Tick the columns to show; drag ⠿ to set their order.")
      );
      const listBox = el("div", "app-docs-colslist");
      body.appendChild(listBox);
      const paintRows = () => {
        clear(listBox);
        rows.forEach((r, i) => {
          const row = el("div", "app-docs-colorderrow");
          const handle = el("span", "app-drag-handle", "⠿");
          handle.title = "Drag to reorder";
          const pick = el("label", "app-docs-check");
          const box = el("input", "") as HTMLInputElement;
          box.type = "checkbox";
          box.checked = r.on;
          box.addEventListener("change", () => {
            r.on = box.checked;
          });
          pick.append(box, document.createTextNode(` ${r.label}`));
          row.append(handle, pick);
          draggableRow(row, handle, "docs-cols", i, rows, paintRows);
          listBox.appendChild(row);
        });
      };
      paintRows();
      const actions = el("div", "app-docs-viewactions");
      const apply = el("button", "app-btn app-btn-primary", "Apply") as HTMLButtonElement;
      apply.addEventListener("click", () => {
        const picked = rows.filter((r) => r.on).map((r) => r.internal);
        scrim.remove();
        pendingView = { ...currentView(), columns: picked };
        remount();
      });
      const reset = el("button", "app-btn", "Reset to default") as HTMLButtonElement;
      reset.addEventListener("click", () => {
        scrim.remove();
        pendingView = { ...currentView(), columns: [] };
        remount();
      });
      actions.append(apply, reset);
      dialog.appendChild(actions);
      scrim.addEventListener("pointerdown", (e) => {
        if (e.target === scrim) scrim.remove();
      });
      document.body.appendChild(scrim);
    };

    topKebab.addEventListener("click", () => {
      if (menu) {
        closeMenu();
        return;
      }
      menu = el("div", "app-docs-menu");
      const item = (label: string, title: string, onPick: (() => void) | null) => {
        const b = el("button", "app-docs-menuitem", label) as HTMLButtonElement;
        b.title = title;
        if (onPick) {
          b.addEventListener("click", () => {
            closeMenu();
            onPick();
          });
        } else {
          b.disabled = true;
        }
        menu!.appendChild(b);
      };
      // offered whatever the scope now: the columns come from the site's
      // mapping, so the chooser works across libraries too (C3)
      item(
        "Choose columns…",
        "Add or remove this view's columns from the site's available set.",
        chooseColumns
      );
      // presentation toggles relocated from the toolbar (Vault V3)
      if (viewMode === "list") {
        item(
          `${density === "compact" ? "✓ " : ""}Compact rows`,
          "Denser rows — more of the register on screen.",
          () => {
            density = density === "compact" ? "comfortable" : "compact";
            persistUi({ density });
            buildRegister();
          }
        );
      }
      item(
        `${onlyApproved ? "✓ " : ""}Show only Approved`,
        statusCol
          ? "On, the register answers with the approved copy only, and " +
            "Approval status drops out of Filters — it is already set."
          : "Map a column to the Approval status role in Settings → Documents first",
        statusCol
          ? () => {
              onlyApproved = !onlyApproved;
              // turning it on subsumes any status filter someone set by
              // hand; leaving it there would filter twice, invisibly
              if (onlyApproved && statusInternal !== "") {
                filters = filters.filter((f) => f.col !== statusInternal);
                paintChips();
              }
              void load(true);
            }
          : null
      );
      if (whoId !== "") {
        item(
          "Saved views…",
          "Save the current filter as a view, or open a saved one.",
          openViewsMenu
        );
      }
      item(
        "Copy link to this view",
        "A link that opens Documents exactly as you see it now.",
        copyViewLink
      );
      item(
        "Export register (CSV)",
        "Every document in the current scope with its configured columns " +
          "(search text is not applied).",
        exportRegister
      );
      // the CONTROLLERS' report: document controllers cannot open
      // Settings (documents settings is super-admin only), so their
      // corpus check lives here, with the register they work in.
      // Scope: every library EXCEPT templates (Ben, 2026-08-08) —
      // templates are stationery, not documents under control — and
      // except the upload staging library, whose contents are files
      // mid-handoff that are meant to be transient.
      const healthLibs = libraries.filter(
        (l) =>
          l.libType !== "template" &&
          (app.stagingLibrary === "" ||
            l.name.trim().toLowerCase() !== app.stagingLibrary.trim().toLowerCase())
      );
      if (docAdmin() && healthLibs.length > 0) {
        item(
          "Document control health…",
          "Documents missing what the control system needs — no owner, no " +
            "status, reviews overdue or absent, untagged. Every library " +
            "except templates, whatever this view shows.",
          () => {
            void import("./healthReport").then(({ openControlHealth }) => {
              openControlHealth({
                site: app.siteUrl,
                libraries: healthLibs,
                roles: {
                  owner: ownerInternal,
                  status: statusInternal,
                  org: [...orgCols],
                  docType: internalForRole("docType"),
                  documentId: internalForRole("documentId"),
                  review: reviewInternal,
                },
                stageOf: stageOfRow,
                host: dialogHost,
                onOpenDoc: (row) => onRowOpen(row, { details: true }),
              });
            });
          }
        );
      }
      const r = topKebab.getBoundingClientRect();
      menu.style.top = `${r.bottom + 4}px`;
      menu.style.left = `${Math.max(8, r.right - 200)}px`;
      document.body.appendChild(menu);
    });

    // a notification's WORK link (N1): the recipient arrived to DO
    // their step — resolve the named document and open the overlay
    // with details expanded and the commands live. (A kiosk link never
    // lands here — "#/doc" renders chrome-free; see docSolo.ts.)
    const openWorkDoc = async (payload: string): Promise<void> => {
      const sep = payload.lastIndexOf(":");
      const listId = payload.slice(0, sep);
      const itemId = Number(payload.slice(sep + 1));
      const lib = byListId.get(listId.toLowerCase());
      if (lib === undefined || !Number.isFinite(itemId) || itemId <= 0) {
        status.textContent = "The linked document's library is not available to you.";
        return;
      }
      const page = await renderListPage(
        app.siteUrl,
        lib.listId,
        buildRenderViewXml({
          idIn: [itemId],
          fields: lib.config.columns.filter((c) => c.available).map((c) => c.internal),
          rowLimit: 1,
        })
      );
      if (dead) return;
      const row = page.rows[0];
      if (row === undefined) {
        // soft errors are named, not painted as "gone" (the docSolo lesson)
        status.textContent =
          page.error !== ""
            ? `The linked document could not be loaded: ${page.error.slice(0, 160)}`
            : "The linked document no longer exists (or you cannot see it).";
        return;
      }
      onRowOpen(row, { details: true });
    };

    // the status vocabulary first: "Show only Approved" is on by default,
    // so the very first page should already be filtered rather than
    // arrive unfiltered and blink — and the work link waits for it too,
    // so the overlay's lifecycle commands see the mapped terms
    const workDoc = takePendingWorkDoc();
    void readStatusTerms().finally(() => {
      // …and the task count waits for it too. The queues ask their
      // questions IN that vocabulary — which labels mean approved, in
      // review, awaiting approval — so counting before it lands asks a
      // different question and answers a different number: the
      // review-due sweep runs unscoped and drags in drafts, superseded
      // and obsolete standards (Ben, 2026-08-08: 13 at launch, 9 on
      // opening the panel). One vocabulary, one number.
      refreshTasksBadge();
      void load(true);
      if (workDoc !== "") void openWorkDoc(workDoc);
    });
  })();

  return () => {
    dead = true;
    for (const f of innerCleanups) f();
    innerCleanups.length = 0;
    wrap.remove();
  };
}
