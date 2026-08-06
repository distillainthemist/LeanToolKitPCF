// The kiosk view (5I, Ben 2026-08-07): a shared document link — QR on a
// printed procedure, a link in a job pack — opens ONLY the document.
// No hub, no register, no navigation: someone in the field scans a code
// and reads a procedure, nothing else. The viewer mounts in SOLO mode
// (no close, no escape-away — there is nowhere to go), details pane
// present but collapsed behind the Details toggle so revision/effective
// dates are one tap away.

import { el } from "../../../shared/ui/dom";
import { takePendingDoc } from "../links";
import { docsConfig } from "./docsStore";
import { driveIdFor, renderListPage } from "./data";
import { DocRow, buildRenderViewXml } from "./rows";
import { sortByDictionary } from "./model";
import { openDocViewer } from "./viewer";

export function mountDocSolo(parent: HTMLElement): () => void {
  const note = (text: string) => parent.appendChild(el("div", "app-settings-note", text));
  let dead = false;

  void (async () => {
    const payload = takePendingDoc();
    if (payload === "") {
      note("This link carries no document.");
      return;
    }
    const sep = payload.lastIndexOf(":");
    const listId = payload.slice(0, sep);
    const itemId = Number(payload.slice(sep + 1));
    if (listId === "" || !Number.isFinite(itemId) || itemId <= 0) {
      note("This document link is not valid.");
      return;
    }
    const { app, libraries } = await docsConfig();
    const lib = libraries.find((l) => l.listId.toLowerCase() === listId.toLowerCase());
    if (app.siteUrl === "" || lib === undefined) {
      note("This document's library is not available to you.");
      return;
    }
    const [page, driveId] = await Promise.all([
      renderListPage(
        app.siteUrl,
        lib.listId,
        buildRenderViewXml({
          idIn: [itemId],
          fields: lib.config.columns.filter((c) => c.available).map((c) => c.internal),
          rowLimit: 1,
        })
      ),
      driveIdFor(app.siteUrl, lib.listId),
    ]);
    const row: DocRow | undefined = page.rows[0];
    if (dead) return;
    if (row === undefined) {
      note("This document no longer exists (or you cannot see it).");
      return;
    }
    const dict = app.sites[Object.keys(app.sites)[0] ?? ""] ?? { columns: [] };
    const dictOrder = dict.columns.map((c) => c.internal);
    openDocViewer({
      site: app.siteUrl,
      row,
      driveId,
      libraryName: lib.config.title !== "" ? lib.config.title : lib.name,
      askToWork: false,
      solo: true,
      detailsOpen: false,
      labels: Object.fromEntries(
        lib.config.columns.filter((c) => c.label !== "").map((c) => [c.internal, c.label])
      ),
      columns: sortByDictionary(
        lib.config.columns.filter((c) => c.available).map((c) => c.internal),
        dictOrder
      ),
    });
  })().catch(() => {
    if (!dead) note("The document could not be loaded — check your access and try again.");
  });

  return () => {
    dead = true;
  };
}
