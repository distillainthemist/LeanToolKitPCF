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
  ControlDoc,
  ControlHealthReport,
  ControlRoles,
  controlHealth,
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
  };
  /** The screen's stage reading — one status vocabulary for the app. */
  stageOf: (row: DocRow) => ControlDoc["stage"];
  host: HTMLElement;
  /** Open a document from the report (the dialog closes first). */
  onOpenDoc: (row: DocRow) => void;
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
    const { roles } = opts;
    const out: ControlDoc[] = [];
    for (const lib of opts.libraries) {
      const carried = new Set(lib.config.columns.map((c) => c.internal));
      const orgCol = roles.org.find((c) => carried.has(c)) ?? "";
      const wanted = [
        roles.owner,
        roles.status,
        orgCol,
        roles.docType,
        roles.documentId,
        roles.review,
        roles.links,
      ].filter((f) => f !== "" && carried.has(f));
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
          });
        }
        next = page.next;
        if (next === "" || truncated) break;
      }
      if (truncated) break;
    }
    return out;
  };

  const paint = (docs: ControlDoc[]) => {
    const r = controlHealth(docs, roleFlags(opts.roles), Date.now(), opts.site);
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
});
