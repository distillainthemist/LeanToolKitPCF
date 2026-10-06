// Document control health — the CONTROLLERS' report (backlog item 3,
// Ben 2026-08-08). Settings → Documents → Health answers "is the
// configuration consistent?"; this answers "are the documents
// themselves in a state the control system can work with?" — which is a
// document controller's job, and controllers cannot open Settings (the
// documents settings tab is super-admin only), so it lives in the
// register's kebab.
//
// The scan covers EVERY standards library on the site, not the nav's
// current selection: a corpus report that quietly inherited a folder
// filter would be a lie about the corpus. Capped, and the cap is
// reported.

import { clear, el } from "../../../shared/ui/dom";
import { openDialog } from "../../../shared/ui/dialog";
import {
  ControlIssue,
  ControlDoc,
  ControlHealthReport,
  ControlRoles,
  controlHealth,
  isYesValue,
  parseDocLinks,
  tallyByOwner,
} from "./model";
import { DocLibrary } from "./docsStore";
import { renderListPage } from "./data";
import { DocRow, buildRenderViewXml, formatDayMonthYear } from "./rows";
import { toCsv } from "./views";

export interface ControlHealthOpts {
  site: string;
  /** Every library the report scans — all of them except templates
   *  (Ben, 2026-08-08). Lifecycle checks apply only to the controlled
   *  (standards) ones; see ControlDoc.controlled. */
  libraries: DocLibrary[];
  /** Mapped internal names ("" = the role is not mapped here). */
  roles: {
    owner: string;
    status: string;
    org: string[];
    docType: string;
    documentId: string;
    review: string;
    /** The linked-documents column ("" = unmapped). */
    links: string;
    /** The regulator-approved flag column ("" = unmapped). */
    regulator: string;
  };
  /** The screen's stage reading — one status vocabulary for the app. */
  stageOf: (row: DocRow) => ControlDoc["stage"];
  host: HTMLElement;
  /** Open a document from the report (the dialog closes first). */
  onOpenDoc: (row: DocRow) => void;
  /** C1 (feedback round 1): offer "Replace a person…" (document admins). */
  canReassign?: boolean;
  /** After a replace run touched documents — the register re-reads. */
  onReassigned?: () => void;
}

/** Rows read per library before the report admits it is showing a
 *  sample. Ids and a handful of fields, so this is a cheap read — but a
 *  corpus past it must not be described as if it were whole. */
const SCAN_CAP = 2000;
/** Documents listed under one finding before it collapses to a count. */
const LIST_CAP = 25;

export function openControlHealth(opts: ControlHealthOpts): void {
  let report: ControlHealthReport | null = null;
  let truncated = false;
  const errors: string[] = [];
  const rowsById = new Map<string, DocRow>();

  const dlg = openDialog({
    host: opts.host,
    title: "Document control health",
    maxWidth: 620,
    buttons: [
      { label: "Export CSV", kind: "secondary", onClick: () => exportCsv() },
      { label: "Close", kind: "primary", onClick: () => dlg.close() },
    ],
  });
  const exportBtn = dlg.root.querySelector(".ltk-btn-secondary") as HTMLButtonElement | null;
  if (exportBtn) exportBtn.disabled = true;
  const body = dlg.body;
  body.appendChild(el("div", "app-loading-line", "Reading the controlled corpus…"));

  const exportCsv = () => {
    if (report === null) return;
    const rows: string[][] = [];
    for (const issue of report.issues) {
      for (const d of issue.docs) {
        rows.push([
          issue.level === "warn" ? "Warning" : "Information",
          issue.title,
          d.name,
          d.libName,
          d.owner,
          d.documentId,
          d.reviewIso === "" ? "" : formatDayMonthYear(d.reviewIso),
        ]);
      }
    }
    const csv = toCsv(
      ["Level", "Finding", "Document", "Library", "Owner", "Document ID", "Next review"],
      rows
    );
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = el("a", "") as HTMLAnchorElement;
    a.href = URL.createObjectURL(blob);
    a.download = `document-control-health-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const scan = async (): Promise<ControlDoc[]> => {
    const out: ControlDoc[] = [];
    for (const lib of opts.libraries) {
      const carried = new Set(lib.config.columns.map((c) => c.internal));
      const orgCol = opts.roles.org.find((c) => carried.has(c)) ?? "";
      // A8 (feedback round 1): a library's own column mapping comes
      // first — a review column under another internal name read as
      // "no next review date" when only the site-level name was tried
      const libRole = (role: string, fallback: string): string =>
        lib.config.columns.find((c) => c.role === role)?.internal ?? fallback;
      const roles = {
        ...opts.roles,
        owner: libRole("owner", opts.roles.owner),
        status: libRole("status", opts.roles.status),
        docType: libRole("docType", opts.roles.docType),
        documentId: libRole("documentId", opts.roles.documentId),
        review: libRole("review", opts.roles.review),
        links: libRole("linkedDocuments", opts.roles.links),
        regulator: libRole("regulatorApproved", opts.roles.regulator),
      };
      const approversCol = libRole("approvers", "");
      const reviewersCol = libRole("reviewers", "");
      const wanted = [
        roles.owner,
        roles.status,
        orgCol,
        roles.docType,
        roles.documentId,
        roles.review,
        roles.links,
        roles.regulator,
        approversCol,
        reviewersCol,
      ].filter((f) => f !== "" && carried.has(f));
      const peopleOf = (row: DocRow, role: "owner" | "approvers" | "reviewers", col: string) => {
        if (col === "" || !carried.has(col)) return null;
        const names = (row.values[col] ?? "").split(";").map((x) => x.trim()).filter((x) => x !== "");
        const emails = (row.values[`${col}#email`] ?? "").split(";").map((x) => x.trim().toLowerCase()).filter((x) => x !== "");
        return names.length === 0 && emails.length === 0 ? null : { role, col, names, emails };
      };
      const viewXml = buildRenderViewXml({
        fields: [...wanted, "CheckoutUser"],
        rowLimit: 100,
      });
      let next = "";
      const libName = lib.config.title !== "" ? lib.config.title : lib.name;
      for (;;) {
        const page = await renderListPage(opts.site, lib.listId, viewXml, next);
        if (page.error !== "") {
          errors.push(`${libName}: ${page.error.slice(0, 140)}`);
          break;
        }
        for (const row of page.rows) {
          if (out.length >= SCAN_CAP) {
            truncated = true;
            break;
          }
          rowsById.set(`${row.listId.toLowerCase()}:${row.id}`, row);
          out.push({
            listId: row.listId,
            itemId: row.id,
            name: row.name,
            libName,
            controlled: lib.libType === "standard",
            owner: roles.owner !== "" ? (row.values[roles.owner] ?? "") : "",
            people: [
              peopleOf(row, "owner", roles.owner),
              peopleOf(row, "approvers", approversCol),
              peopleOf(row, "reviewers", reviewersCol),
            ].filter((p): p is NonNullable<typeof p> => p !== null),
            stage: opts.stageOf(row),
            org: orgCol !== "" ? (row.values[orgCol] ?? "") : "",
            docType: roles.docType !== "" ? (row.values[roles.docType] ?? "") : "",
            documentId: roles.documentId !== "" ? (row.values[roles.documentId] ?? "") : "",
            // the ISO twin is the real value; the display text is a
            // site-locale rendering we never re-parse (the R6 lesson)
            reviewIso: roles.review !== "" ? (row.values[`${roles.review}.`] ?? "") : "",
            checkedOutTo: row.checkoutName ?? "",
            uniqueId: row.uniqueId ?? "",
            // a feed-clipped JSON parses to null → [] — checks may
            // MISS on huge link lists, never false-positive
            links:
              roles.links !== "" ? (parseDocLinks(row.values[roles.links] ?? "") ?? []) : [],
            regulatorApproved:
              roles.regulator !== "" && isYesValue(row.values[roles.regulator] ?? ""),
          });
        }
        next = page.next;
        if (next === "" || truncated) break;
      }
      if (truncated) break;
    }
    return out;
  };

  /** C1: which people a flagged document carries, per finding key —
   *  painted on the row ("owner Jane Doe not in the group"). */
  const flaggedPeople = new Map<string, string[]>();
  const docKey = (d: ControlDoc) => `${d.listId.toLowerCase()}:${d.itemId}`;

  /** C1 (feedback round 1): the roles checks that need the directory —
   *  named people outside the owners & approvers group, and named
   *  people the directory no longer has (left, or disabled). Async,
   *  appended to the pure report; a lookup that fails skips its check
   *  and says so. */
  const peopleIssues = async (docs: ControlDoc[]): Promise<{ issues: ControlIssue[]; skipped: string[] }> => {
    const issues: ControlIssue[] = [];
    const skipped: string[] = [];
    const withPeople = docs.filter((d) => d.people.length > 0);
    if (withPeople.length === 0) return { issues, skipped };
    // the pool: owners and approvers must be in the group (reviewers may be anyone — C2)
    try {
      const { poolState } = await import("./accessGates");
      const pool = await poolState();
      if (pool.configured && pool.members !== null) {
        const inPool = new Set(pool.members.map((m) => m.email.toLowerCase()).filter((e) => e !== ""));
        const hits: ControlDoc[] = [];
        for (const d of withPeople) {
          const names: string[] = [];
          for (const p of d.people) {
            if (p.role === "reviewers") continue;
            p.emails.forEach((e, i) => {
              if (!inPool.has(e)) names.push(`${p.role === "owner" ? "owner" : "approver"} ${p.names[i] ?? e}`);
            });
          }
          if (names.length > 0) {
            hits.push(d);
            flaggedPeople.set(`notInPool|${docKey(d)}`, names);
          }
        }
        if (hits.length > 0) {
          issues.push({
            key: "notInPool",
            level: "warn",
            title: "Named owner or approver is not in the owners & approvers group",
            detail:
              "The person is named on the document but not in the group that grants the right to approve — " +
              "their approvals will be refused. Add them to the group, or replace them (Replace a person…).",
            docs: hits,
          });
        }
      } else if (pool.configured) skipped.push("The owners & approvers group could not be read — the group check did not run.");
    } catch {
      skipped.push("The owners & approvers group could not be read — the group check did not run.");
    }
    // the directory: every named email, looked up once (capped)
    try {
      const { directoryProfile } = await import("../store/people");
      const emails = [...new Set(withPeople.flatMap((d) => d.people.flatMap((p) => p.emails)))].slice(0, 300);
      const gone = new Set<string>();
      let at = 0;
      const worker = async () => {
        while (at < emails.length) {
          const e = emails[at++];
          const prof = await directoryProfile(e);
          if (!prof.found || !prof.accountEnabled) gone.add(e);
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, emails.length) }, worker));
      const hits: ControlDoc[] = [];
      for (const d of withPeople) {
        const names: string[] = [];
        for (const p of d.people) p.emails.forEach((e, i) => gone.has(e) && names.push(`${p.role === "owner" ? "owner" : p.role === "approvers" ? "approver" : "reviewer"} ${p.names[i] ?? e}`));
        if (names.length > 0) {
          hits.push(d);
          flaggedPeople.set(`leftDirectory|${docKey(d)}`, names);
        }
      }
      if (hits.length > 0) {
        issues.push({
          key: "leftDirectory",
          level: "warn",
          title: "Named person is no longer in the directory",
          detail:
            "The account has left or is disabled, so nobody holds that role in practice. " +
            "Replace them (Replace a person…) — the document keeps its history.",
          docs: hits,
        });
      }
      if (emails.length === 300) skipped.push("Directory check capped at 300 people.");
    } catch {
      skipped.push("The directory could not be read — the left-the-business check did not run.");
    }
    return { issues, skipped };
  };

  const paint = (docs: ControlDoc[], extra?: { issues: ControlIssue[]; skipped: string[] }) => {
    const r = controlHealth(docs, roleFlags(opts.roles), Date.now(), opts.site);
    if (extra !== undefined) {
      r.issues.push(...extra.issues);
      r.skipped.push(...extra.skipped);
      const warned = new Set(r.issues.filter((i) => i.level === "warn").flatMap((i) => i.docs.map(docKey)));
      r.clean = r.scanned - warned.size;
    }
    report = r;
    if (exportBtn) exportBtn.disabled = r.issues.length === 0;
    clear(body);

    const controlledDocs = docs.filter((d) => d.controlled).length;
    body.appendChild(
      el(
        "div",
        "app-settings-note",
        `Scanned ${r.scanned} document${r.scanned === 1 ? "" : "s"} across ` +
          `${opts.libraries.length} ${opts.libraries.length === 1 ? "library" : "libraries"} ` +
          `(every library except templates)` +
          `${truncated ? ` — capped at ${SCAN_CAP}, so this is a sample` : ""}.`
      )
    );
    // the scope of the lifecycle half, stated: a working document owes
    // no approval status, so its silence is not a finding
    body.appendChild(
      el(
        "div",
        "app-field-hint",
        controlledDocs > 0
          ? `Approval-status and review checks apply to the ${controlledDocs} controlled ` +
            "document(s) only; owner, tagging and identification checks apply to all."
          : "No controlled documents in scope — approval-status and review checks did not apply."
      )
    );
    if (errors.length > 0) {
      body.appendChild(
        el("div", "app-field-hint", `Some libraries could not be read — ${errors.join(" · ")}`)
      );
    }
    for (const s of r.skipped) body.appendChild(el("div", "app-field-hint", `Not checked: ${s}`));
    if (opts.canReassign === true) {
      const tools = el("div", "app-docs-hrtools");
      const rep = el("button", "app-btn", "Replace a person…") as HTMLButtonElement;
      rep.title = "Swap one named owner, approver or reviewer for another across the scanned documents";
      rep.addEventListener("click", () => {
        void import("./roleReassign").then(({ openReplacePerson }) => {
          openReplacePerson({
            host: opts.host,
            site: opts.site,
            docs: docs
              .filter((d) => d.people.length > 0)
              .map((d) => {
                const live = rowsById.get(docKey(d));
                return { listId: d.listId, itemId: d.itemId, name: d.name, libName: d.libName, serverUrl: live?.serverUrl ?? "", readerFacing: d.stage === "approved", people: d.people };
              })
              .filter((d) => d.serverUrl !== ""),
            onDone: (changed) => {
              if (changed > 0) {
                opts.onReassigned?.();
                dlg.close();
              }
            },
          });
        });
      });
      tools.appendChild(rep);
      body.appendChild(tools);
    }

    if (r.issues.length === 0) {
      body.appendChild(
        el(
          "div",
          "app-settings-note",
          r.scanned === 0
            ? "No controlled documents found to check."
            : "✓ Nothing to report — every document has what the control system needs."
        )
      );
      return;
    }
    body.appendChild(
      el(
        "div",
        "app-field-hint",
        `${r.clean} of ${r.scanned} documents have no warnings. Open a finding to see which ` +
          "documents, and click one to go and fix it."
      )
    );

    for (const issue of r.issues) {
      const box = el("div", `app-docs-hrissue app-docs-health-${issue.level}`);
      const bar = el("button", "app-docs-hrhead") as HTMLButtonElement;
      bar.setAttribute("aria-expanded", "false");
      bar.append(
        el("span", "app-docs-healthmark", issue.level === "warn" ? "⚠" : "•"),
        el("span", "app-docs-hrtitle", issue.title),
        el("span", "app-docs-hrcount", String(issue.docs.length)),
        el("span", "app-docs-hrcaret", "▸")
      );
      box.appendChild(bar);
      const detail = el("div", "app-docs-hrbody");
      detail.style.display = "none";
      detail.appendChild(el("div", "app-field-hint", issue.detail));
      // "whose reviews are late?" answered without leaving the report
      if (issue.key === "reviewOverdue" || issue.key === "reviewMissing") {
        const byOwner = tallyByOwner(issue.docs)
          .slice(0, 6)
          .map((o) => `${o.owner} (${o.count})`)
          .join(" · ");
        if (byOwner !== "") {
          detail.appendChild(el("div", "app-field-hint", `By owner: ${byOwner}`));
        }
      }
      const list = el("div", "app-docs-hrdocs");
      for (const d of issue.docs.slice(0, LIST_CAP)) {
        const row = el("button", "app-docs-hrdoc") as HTMLButtonElement;
        const meta = [d.libName, d.owner.trim() === "" ? "no owner" : d.owner.split(";")[0].trim()];
        if (issue.key === "reviewOverdue" && d.reviewIso !== "") {
          meta.push(`due ${formatDayMonthYear(d.reviewIso)}`);
        }
        if (issue.key === "inRevision" && d.checkedOutTo !== "") {
          meta.push(`held by ${d.checkedOutTo}`);
        }
        const flagged = flaggedPeople.get(`${issue.key}|${docKey(d)}`);
        if (flagged !== undefined) meta.push(flagged.join(", "));
        row.append(
          el("span", "app-docs-hrdocname", d.name),
          el("span", "app-field-hint", meta.join(" · "))
        );
        const live = rowsById.get(`${d.listId.toLowerCase()}:${d.itemId}`);
        if (live !== undefined) {
          row.addEventListener("click", () => {
            dlg.close();
            opts.onOpenDoc(live);
          });
        } else {
          row.disabled = true;
        }
        list.appendChild(row);
      }
      if (issue.docs.length > LIST_CAP) {
        list.appendChild(
          el(
            "div",
            "app-field-hint",
            `… and ${issue.docs.length - LIST_CAP} more — Export CSV for the full list.`
          )
        );
      }
      detail.appendChild(list);
      box.appendChild(detail);
      bar.addEventListener("click", () => {
        const open = detail.style.display !== "none";
        detail.style.display = open ? "none" : "";
        bar.setAttribute("aria-expanded", String(!open));
        const caret = bar.querySelector(".app-docs-hrcaret");
        if (caret) caret.textContent = open ? "▸" : "▾";
      });
      body.appendChild(box);
    }
  };

  void scan().then(
    (docs) => {
      if (!body.isConnected) return;
      paint(docs);
      // C1: the directory-backed checks arrive after the pure report
      void peopleIssues(docs).then((extra) => {
        if (!body.isConnected) return;
        paint(docs, extra);
      });
    },
    (e: unknown) => {
      if (!body.isConnected) return;
      clear(body);
      body.appendChild(
        el(
          "div",
          "app-settings-note",
          `The scan failed: ${e instanceof Error ? e.message : String(e)}`
        )
      );
    }
  );
}

const roleFlags = (r: ControlHealthOpts["roles"]): ControlRoles => ({
  owner: r.owner !== "",
  status: r.status !== "",
  org: r.org.length > 0,
  docType: r.docType !== "",
  documentId: r.documentId !== "",
  review: r.review !== "",
  links: r.links !== "",
  regulator: r.regulator !== "",
});
