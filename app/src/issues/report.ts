// Report a problem or idea (issues plan I1, 2026-08-12) — the
// reporter's whole surface is ONE dialog: describe, paste, send.
// Everything else (who, where, when, what device, what app version) is
// captured automatically; severity and triage are the admin's job, not
// the reporter's.
//
// Two best-practice bets live here (docs/leanboard-issues-plan.md):
//  - dedupe at the source: open issues in the same area render above
//    the form as "+1" rows — following an existing issue beats filing
//    its twin;
//  - screenshots by clipboard PASTE (plus drag-drop and a picker — the
//    road that matters on phones), downscaled client-side before the
//    U0-proven uploadFileToRecord door.
//
// Dataverse only — no connectors, so the board bundle stays clean.

import { el, clear } from "../../../shared/ui/dom";
import { openDialog } from "../../../shared/ui/dialog";
import { currentViewer } from "../runtime";
import { Ben_ltkissuesService } from "../generated/services/Ben_ltkissuesService";
import { Ben_ltkissuefilesService } from "../generated/services/Ben_ltkissuefilesService";
import { Ben_ltkissuemessagesService } from "../generated/services/Ben_ltkissuemessagesService";
import { Ben_ltkissuewatchsService } from "../generated/services/Ben_ltkissuewatchsService";
import type { Ben_ltkissues } from "../generated/models/Ben_ltkissuesModel";
import { shrinkImage } from "../../../shared/ui/imageIngest";

export type IssueArea = "boards" | "cards" | "documents" | "settings" | "other";

const AREAS: { key: IssueArea; label: string }[] = [
  { key: "boards", label: "Boards & meetings" },
  { key: "cards", label: "Cards" },
  { key: "documents", label: "Documents" },
  { key: "settings", label: "Settings & admin" },
  { key: "other", label: "Something else" },
];

/** Which part of the app a route belongs to — the prefill, never a cage. */
export function areaForRoute(hash: string): IssueArea {
  const head = hash.replace(/^#\//, "").split("/")[0] ?? "";
  if (head === "docs" || head === "doc") return "documents";
  if (head === "settings") return "settings";
  if (head === "edit") return "cards";
  if (head === "board" || head === "setup" || head === "adjust" || head === "") return "boards";
  return "other";
}

/** The auto-captured context blob — stored on the issue, shown to the
 *  reporter in one quiet line so nothing is collected in secret. */
function contextBlob(): Record<string, string> {
  return {
    version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "unknown",
    route: window.location.hash || "#/",
    host: window.location.host,
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    when: new Date().toISOString(),
  };
}

// Screenshot downscaling now lives in shared/ui/imageIngest.ts (the
// canvas card's image field shares it); the defaults ARE this dialog's
// historical behaviour (1.5MB threshold, 1600px edge, JPEG 0.85).

export function openReportDialog(opts: { host: HTMLElement }): void {
  const viewer = currentViewer();
  const myEmail = (viewer?.email ?? "").toLowerCase();
  const myName = viewer?.name ?? "";
  let running = false;

  // openDialog paints with the toolkit's --ltk-* variables, which only
  // resolve on a .app-dlghost host — a dialog on a bare screen (no card
  // above it) came out transparent and unstyled (the docs screen's own
  // 2026-08-03 lesson). Supply the host here and clean it up on close.
  const dlgHost = el("div", "app-dlghost");
  opts.host.appendChild(dlgHost);

  const dlg = openDialog({
    host: dlgHost,
    title: "Report a problem or idea",
    maxWidth: 520,
    onClose: () => dlgHost.remove(),
    buttons: [
      { label: "Cancel", kind: "secondary", onClick: () => { if (!running) dlg.close(); } },
      { label: "Send report", kind: "primary", onClick: () => void send() },
    ],
  });
  const sendBtn = dlg.root.querySelector(".ltk-btn-primary") as HTMLButtonElement;
  dlg.body.classList.add("app-issue-body");

  // ---- My reports (I3, option 1): the reporter's own thread view -------
  // Stacked over this dialog in its own host, so a half-typed report
  // survives the detour. The link rides the TITLE row (Ben, 2026-08-12).
  const mine = el("button", "app-issue-minelink", "My reports →") as HTMLButtonElement;
  mine.addEventListener("click", () => openMyReports(opts.host));
  const titleRow = dlg.root.querySelector(".ltk-dialog-title") as HTMLElement;
  titleRow.classList.add("app-issue-titlebar");
  titleRow.appendChild(mine);

  // ---- kind + area ------------------------------------------------------
  const kindRow = el("div", "app-issue-kindrow");
  let kind: "bug" | "idea" = "bug";
  const kindBtns = (["bug", "idea"] as const).map((k) => {
    const b = el(
      "button",
      "app-issue-kind",
      k === "bug" ? "Something's wrong" : "I have an idea"
    ) as HTMLButtonElement;
    b.addEventListener("click", () => {
      kind = k;
      for (const x of kindBtns) x.classList.remove("app-issue-kind-on");
      b.classList.add("app-issue-kind-on");
    });
    kindRow.appendChild(b);
    return b;
  });
  kindBtns[0].classList.add("app-issue-kind-on");

  const area = el("select", "app-input") as HTMLSelectElement;
  for (const a of AREAS) {
    const o = el("option", "", a.label) as HTMLOptionElement;
    o.value = a.key;
    area.appendChild(o);
  }
  area.value = areaForRoute(window.location.hash);
  dlg.body.append(kindRow, el("div", "app-field-label", "Part of the app"), area);

  // ---- dedupe at the source: open issues in this area --------------------
  const knownBox = el("div", "app-issue-known");
  dlg.body.appendChild(knownBox);
  const paintKnown = async () => {
    clear(knownBox);
    const res = await Ben_ltkissuesService.getAll({
      filter:
        `ben_area eq '${area.value}' and ` +
        `(ben_status eq 'new' or ben_status eq 'triaged' or ben_status eq 'inprogress')`,
      select: ["ben_ltkissueid", "ben_name", "ben_status"],
      top: 6,
    });
    const rows = res.success === false ? [] : (res.data ?? []);
    if (rows.length === 0) return;
    knownBox.appendChild(
      el("div", "app-field-hint", "Already reported in this area — is it one of these?")
    );
    for (const r of rows) {
      const row = el("div", "app-issue-knownrow");
      const plus = el("button", "app-btn app-issue-plusone", "+1") as HTMLButtonElement;
      plus.title = "Follow this issue instead of filing a new one — you'll get its updates.";
      plus.addEventListener("click", () => {
        void (async () => {
          plus.disabled = true;
          const mine = await Ben_ltkissuewatchsService.getAll({
            filter: `_ben_issue_value eq '${r.ben_ltkissueid}' and ben_email eq '${myEmail}'`,
            top: 1,
          });
          const already = mine.success !== false && (mine.data ?? []).length > 0;
          if (!already) {
            // sparse create — the generated Base marks statecode required
            await Ben_ltkissuewatchsService.create({
              ben_name: `+1 — ${myEmail}`,
              ben_email: myEmail,
              ben_watchername: myName,
              "ben_Issue@odata.bind": `/ben_ltkissues(${r.ben_ltkissueid})`,
            } as Parameters<typeof Ben_ltkissuewatchsService.create>[0]);
          }
          plus.textContent = "Following ✓";
        })();
      });
      row.append(plus, el("span", "app-issue-knownname", r.ben_name ?? ""));
      knownBox.appendChild(row);
    }
  };
  void paintKnown();
  area.addEventListener("change", () => void paintKnown());

  // ---- title + description -----------------------------------------------
  const title = el("input", "app-input") as HTMLInputElement;
  title.placeholder = "One line — what happened, or what would help?";
  title.maxLength = 290;
  const desc = el("textarea", "app-input app-issue-desc") as HTMLTextAreaElement;
  desc.rows = 4;
  desc.placeholder =
    "What did you do, what did you expect, what happened instead? For ideas: what problem would it solve?";
  // the * follows the app's required-field convention (fieldEditors),
  // and the live line below names what still blocks Send — a disabled
  // button must never be a mystery (Ben, 2026-08-12)
  const needed = el("div", "app-issue-needed");
  dlg.body.append(
    el("div", "app-field-label", "Summary *"),
    title,
    el("div", "app-field-label", "Details *"),
    desc,
    needed
  );
  // both required (Ben, 2026-08-12): a bare title cannot be triaged,
  // and asking now beats an admin asking later
  title.addEventListener("input", () => sync());
  desc.addEventListener("input", () => sync());

  // ---- screenshots: paste, drop, pick ------------------------------------
  const shots: { file: File; url: string }[] = [];
  const shotBox = el("div", "app-issue-shots");
  const zone = el(
    "div",
    "app-issue-paste",
    "Paste a screenshot here (Ctrl/Cmd+V), drop an image, or"
  );
  const pick = el("input", "") as HTMLInputElement;
  pick.type = "file";
  pick.accept = "image/*";
  pick.multiple = true;
  pick.style.display = "none";
  const pickBtn = el("button", "app-btn app-issue-pick", "choose a photo") as HTMLButtonElement;
  pickBtn.addEventListener("click", () => pick.click());
  zone.appendChild(pickBtn);
  dlg.body.append(el("div", "app-field-label", "Screenshots"), zone, shotBox, pick);

  const addShot = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    if (shots.length >= 6) return;
    const key = `${file.name}|${Date.now()}|${Math.random()}`;
    shots.push({ file, url: key });
    const cell = el("div", "app-issue-shot");
    const img = el("img", "") as HTMLImageElement;
    // a DATA url, not an object url: the Power Apps player's CSP blocks
    // blob: images (broken-icon thumbnails, Ben 2026-08-12) while data:
    // renders fine — the branding logo already proves that road
    const reader = new FileReader();
    reader.onload = () => {
      img.src = String(reader.result ?? "");
    };
    reader.readAsDataURL(file);
    img.alt = file.name;
    const rm = el("button", "app-issue-shotrm", "✕") as HTMLButtonElement;
    rm.title = "Remove";
    rm.addEventListener("click", () => {
      const i = shots.findIndex((s) => s.url === key);
      if (i >= 0) shots.splice(i, 1);
      cell.remove();
    });
    cell.append(img, rm);
    shotBox.appendChild(cell);
  };
  const onPaste = (e: ClipboardEvent) => {
    for (const item of e.clipboardData?.items ?? []) {
      if (item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f !== null) addShot(new File([f], `pasted-${Date.now()}.png`, { type: f.type }));
        e.preventDefault();
      }
    }
  };
  dlg.root.addEventListener("paste", onPaste as EventListener);
  zone.addEventListener("dragover", (e) => e.preventDefault());
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    for (const f of e.dataTransfer?.files ?? []) addShot(f);
  });
  pick.addEventListener("change", () => {
    for (const f of pick.files ?? []) addShot(f);
    pick.value = "";
  });

  // ---- the quiet disclosure line -----------------------------------------
  const ctx = contextBlob();
  dlg.body.appendChild(
    el(
      "div",
      "app-field-hint",
      `Sent with your report: app version ${ctx.version}, the screen you're on, ` +
        "your device type and the time — so nobody has to ask."
    )
  );
  const status = el("div", "app-docs-addstatus");
  dlg.body.appendChild(status);

  const sync = () => {
    const missing = [
      title.value.trim() === "" ? "a summary" : "",
      desc.value.trim() === "" ? "details" : "",
    ].filter((s) => s !== "");
    needed.textContent =
      missing.length === 0 ? "" : `Send report needs ${missing.join(" and ")}.`;
    sendBtn.disabled = running || missing.length > 0;
  };
  sync();

  // ---- send ---------------------------------------------------------------
  const send = async () => {
    if (running || sendBtn.disabled) return;
    running = true;
    sync();
    status.textContent = "Sending…";
    status.classList.remove("app-docs-addstatus-warn");
    try {
      const made = await Ben_ltkissuesService.create({
        ben_name: title.value.trim(),
        ben_description: desc.value.trim(),
        ben_kind: kind,
        ben_area: area.value,
        ben_status: "new",
        ben_reporteremail: myEmail,
        ben_reportername: myName,
        ben_context: JSON.stringify(contextBlob()),
      } as Parameters<typeof Ben_ltkissuesService.create>[0]);
      if (made.success === false || made.data?.ben_ltkissueid === undefined) {
        throw new Error(made.error?.message ?? "the issue could not be created");
      }
      const issueId = made.data.ben_ltkissueid;
      for (let i = 0; i < shots.length; i++) {
        status.textContent = `Uploading screenshot ${i + 1} of ${shots.length}…`;
        const file = await shrinkImage(shots[i].file);
        const fileRow = await Ben_ltkissuefilesService.create({
          ben_name: file.name,
          ben_caption: "",
          "ben_Issue@odata.bind": `/ben_ltkissues(${issueId})`,
        } as Parameters<typeof Ben_ltkissuefilesService.create>[0]);
        const fid = fileRow.data?.ben_ltkissuefileid;
        if (fileRow.success === false || fid === undefined) {
          throw new Error("a screenshot's row could not be created");
        }
        const up = await Ben_ltkissuefilesService.upload(fid, "ben_file", file, file.name);
        if (up.success === false) throw new Error("a screenshot upload was refused");
      }
      // done — the dialog says so and offers only the way out
      clear(dlg.body);
      dlg.body.appendChild(
        el(
          "div",
          "app-issue-done",
          kind === "bug"
            ? "Sent — thank you. You'll see updates under My reports as it moves."
            : "Sent — thank you. Ideas are reviewed with the same care as bugs."
        )
      );
      sendBtn.style.display = "none";
      const cancel = dlg.root.querySelector(".ltk-btn-secondary") as HTMLButtonElement | null;
      if (cancel !== null) cancel.textContent = "Close";
      running = false;
    } catch (e) {
      status.textContent = `Could not send: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`;
      status.classList.add("app-docs-addstatus-warn");
      running = false;
      sync();
    }
  };
}

// ---- My reports (issues plan I3, option 1 — Ben, 2026-08-12) ----------
// The reporter's self-serve view: what did I report (and follow), what
// state is it in, what came back. Reporter-visible messages only —
// internal notes never render here. Read-only by design: replying
// happens in the Teams chat the admin's message opened.

const STATUS_WORDS: Record<string, string> = {
  new: "New",
  triaged: "Triaged",
  inprogress: "In progress",
  done: "Done",
  declined: "Declined",
  merged: "Merged",
};

const agoLine = (iso: string | undefined): string => {
  const t = Date.parse(iso ?? "");
  if (Number.isNaN(t)) return "";
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 0) return "today";
  if (days < 60) return `${days} day${days === 1 ? "" : "s"} ago`;
  return `${Math.round(days / 30)} months ago`;
};

export function openMyReports(host: HTMLElement): void {
  const viewer = currentViewer();
  const myEmail = (viewer?.email ?? "").toLowerCase();
  const dlgHost = el("div", "app-dlghost");
  host.appendChild(dlgHost);
  const dlg = openDialog({
    host: dlgHost,
    title: "My reports",
    maxWidth: 520,
    onClose: () => dlgHost.remove(),
    buttons: [{ label: "Close", kind: "secondary", onClick: () => dlg.close() }],
  });
  dlg.body.classList.add("app-issue-body");
  dlg.body.appendChild(el("div", "app-loading-line", "Reading your reports…"));

  void (async () => {
    // mine by authorship, plus everything I +1'd — one list, newest first
    const [ownRes, watchRes] = await Promise.all([
      Ben_ltkissuesService.getAll({
        filter: `ben_reporteremail eq '${myEmail}'`,
        top: 100,
      }),
      Ben_ltkissuewatchsService.getAll({
        filter: `ben_email eq '${myEmail}'`,
        top: 100,
      }),
    ]);
    const own = ownRes.success === false ? [] : (ownRes.data ?? []);
    const watchedIds = (watchRes.success === false ? [] : (watchRes.data ?? []))
      .map((w) => w._ben_issue_value ?? "")
      .filter((id) => id !== "" && !own.some((o) => o.ben_ltkissueid === id));
    const watched: Ben_ltkissues[] = [];
    for (const id of watchedIds.slice(0, 25)) {
      const r = await Ben_ltkissuesService.get(id);
      if (r.success !== false && r.data !== undefined) watched.push(r.data);
    }
    const rows = [...own.map((i) => ({ i, followed: false })), ...watched.map((i) => ({ i, followed: true }))]
      .sort((a, b) => Date.parse(b.i.modifiedon ?? "") - Date.parse(a.i.modifiedon ?? ""));

    clear(dlg.body);
    if (rows.length === 0) {
      dlg.body.appendChild(
        el("div", "app-issue-done", "Nothing yet — reports and +1s you make will live here.")
      );
      return;
    }
    for (const { i, followed } of rows) dlg.body.appendChild(reportRow(i, followed));
  })().catch(() => {
    clear(dlg.body);
    dlg.body.appendChild(el("div", "app-field-hint", "Your reports could not be read — try again."));
  });

  function reportRow(issue: Ben_ltkissues, followed: boolean): HTMLElement {
    const wrap = el("div", "app-issad-item");
    const row = el("button", "app-issad-row") as HTMLButtonElement;
    const text = el("div", "app-issad-text");
    text.append(
      el("div", "app-issad-title", issue.ben_name ?? ""),
      el(
        "div",
        "app-issad-meta",
        [followed ? "following (+1)" : "", agoLine(issue.modifiedon)].filter((s) => s !== "").join(" · ")
      )
    );
    const chip = el(
      "span",
      `app-issad-status app-issad-status-${issue.ben_status ?? "new"}`,
      STATUS_WORDS[issue.ben_status ?? ""] ?? issue.ben_status ?? ""
    );
    row.append(text, chip);
    wrap.appendChild(row);
    let detail: HTMLElement | null = null;
    row.addEventListener("click", () => {
      if (detail !== null) {
        detail.remove();
        detail = null;
        return;
      }
      detail = el("div", "app-issad-detail");
      wrap.appendChild(detail);
      void paintThread(detail, issue);
    });
    return wrap;
  }

  async function paintThread(hostEl: HTMLElement, issue: Ben_ltkissues): Promise<void> {
    hostEl.appendChild(el("div", "app-loading-line", "Reading the thread…"));
    const msgs = await Ben_ltkissuemessagesService.getAll({
      filter: `_ben_issue_value eq '${issue.ben_ltkissueid}' and ben_audience eq 'reporter'`,
    });
    clear(hostEl);
    if ((issue.ben_status ?? "") === "merged" && (issue.ben_duplicateofname ?? "") !== "") {
      hostEl.appendChild(
        el(
          "div",
          "app-field-hint",
          `Merged into "${issue.ben_duplicateofname}" — its updates cover this report too.`
        )
      );
    }
    if ((issue.ben_resolution ?? "").trim() !== "") {
      hostEl.appendChild(el("div", "app-issad-desc", `Resolution: ${issue.ben_resolution}`));
    }
    const list = (msgs.success === false ? [] : (msgs.data ?? [])).sort(
      (a, b) => Date.parse(a.createdon ?? "") - Date.parse(b.createdon ?? "")
    );
    if (list.length === 0) {
      hostEl.appendChild(el("div", "app-field-hint", "No updates yet — it's in the queue."));
      return;
    }
    for (const m of list) {
      const line = el("div", "app-issad-msg");
      line.append(
        el(
          "div",
          "app-issad-msghead",
          `${m.ben_authorname || m.ben_authoremail || ""} · ${agoLine(m.createdon)}`
        ),
        el("div", "app-issad-msgbody", m.ben_body ?? "")
      );
      hostEl.appendChild(line);
    }
  }
}
