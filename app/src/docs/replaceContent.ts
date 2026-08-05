// Replace content (5H3) — swap a held document's FILE for an uploaded
// one, inside the normal check-out discipline: the caller must hold the
// check-out, the swap is a server-side copy OVER the held file
// (overwrite=true — probe-measured), the document STAYS checked out, and
// the holder publishes with an ordinary check-in or reverts with
// Discard. Same staging handoff as add-by-upload (bytes cannot cross
// the connector), same-extension only (a swapped extension breaks
// renditions and the Edit-source door).

import { clear, el } from "../../../shared/ui/dom";
import { openDialog } from "../../../shared/ui/dialog";
import { spErrorText } from "./model";
import { DocRow, buildRenderViewXml } from "./rows";
import { renderListPage } from "./data";
import { copyFileTo, recycleFile } from "./sp";

export interface ReplaceContentOpts {
  site: string;
  /** Checked out to the acting user — the caller gates. */
  row: DocRow;
  staging: { listId: string; openUrl: string };
  host: HTMLElement;
  onDone: () => void;
}

type Sp = { ok: boolean; status: string; data: unknown };
const timed = async (p: Promise<Sp>, what: string): Promise<Sp> => {
  let clock = 0;
  const timeout = new Promise<Sp>((resolve) => {
    clock = window.setTimeout(
      () => resolve({ ok: false, status: `${what} did not answer within 25 seconds`, data: null }),
      25_000
    );
  });
  const r = await Promise.race([p, timeout]);
  window.clearTimeout(clock);
  return r;
};

export function openReplaceContent(opts: ReplaceContentOpts): void {
  const { site, row } = opts;
  let running = false;

  const dlg = openDialog({
    host: opts.host,
    title: `Replace content — ${row.name}`,
    buttons: [
      { label: "Cancel", kind: "secondary", onClick: () => { if (!running) dlg.close(); } },
      { label: "Replace content", kind: "primary", onClick: () => void go() },
    ],
  });
  const goBtn = dlg.root.querySelector(".ltk-btn-primary") as HTMLButtonElement;
  dlg.body.appendChild(
    el(
      "div",
      "app-field-hint",
      `Swaps this document's file for one you upload (same type only — .${row.ext}). ` +
        "You stay checked out: check in to publish the replacement, or Discard " +
        "check-out to revert it."
    )
  );

  const openLink = el("a", "app-btn", "Open the upload folder ↗") as HTMLAnchorElement;
  openLink.href = opts.staging.openUrl;
  openLink.target = "_blank";
  openLink.rel = "noopener";
  const refreshBtn = el("button", "app-btn", "⟳ Refresh") as HTMLButtonElement;
  refreshBtn.type = "button";
  const sel = el("select", "app-input") as HTMLSelectElement;
  const placeholder = (label: string) => {
    clear(sel);
    const o = el("option", "", label) as HTMLOptionElement;
    o.value = "";
    sel.appendChild(o);
  };
  placeholder("Refresh to list uploaded files…");
  const box = el("div", "app-docs-upbox");
  box.append(openLink, refreshBtn, sel);
  dlg.body.appendChild(box);
  const status = el("div", "app-docs-addstatus");
  dlg.body.appendChild(status);

  const stagingRows = new Map<string, DocRow>();
  const sync = () => {
    goBtn.disabled = running || sel.value === "";
  };
  sel.addEventListener("change", sync);
  sync();

  const loadStaging = () => {
    refreshBtn.disabled = true;
    void renderListPage(site, opts.staging.listId, buildRenderViewXml({ rowLimit: 30 }))
      .then((page) => {
        stagingRows.clear();
        // SAME extension only — the guard is the filter, so a wrong
        // type is never even offerable
        const matching = page.rows.filter(
          (r) => r.ext.toLowerCase() === row.ext.toLowerCase()
        );
        placeholder(
          matching.length === 0
            ? page.rows.length === 0
              ? "No files in the upload folder yet — upload, then Refresh"
              : `No .${row.ext} files in the upload folder — this document only takes .${row.ext}`
            : "Choose the replacement file…"
        );
        for (const r of matching) {
          stagingRows.set(r.uniqueId, r);
          const o = el("option", "", r.name) as HTMLOptionElement;
          o.value = r.uniqueId;
          sel.appendChild(o);
        }
        sel.value = "";
      })
      .catch(() => {
        placeholder("Could not read the upload folder — check the staging library");
      })
      .then(() => {
        refreshBtn.disabled = false;
        sync();
      });
  };
  refreshBtn.addEventListener("click", loadStaging);

  const fail = (what: string, why: string) => {
    status.textContent = `${what}: ${spErrorText(why).slice(0, 300)}`;
    status.classList.add("app-docs-addstatus-warn");
    running = false;
    sync();
  };

  const go = async () => {
    const src = stagingRows.get(sel.value);
    if (running || src === undefined) return;
    running = true;
    sync();
    status.classList.remove("app-docs-addstatus-warn");

    status.textContent = "Replacing the content…";
    const over = await timed(copyFileTo(site, src.serverUrl, row.serverUrl, true), "The replace");
    if (!over.ok) {
      return fail("The replace was refused (your check-out is untouched)", over.status);
    }

    // the staging copy has served its purpose — best effort; the
    // replacement is IN either way
    status.textContent = "Tidying the upload folder…";
    await timed(recycleFile(site, src.serverUrl), "The tidy-up").catch(() => null);

    dlg.close();
    opts.onDone();
  };
}
