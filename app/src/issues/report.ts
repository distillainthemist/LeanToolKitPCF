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
import { Ben_ltkissuewatchsService } from "../generated/services/Ben_ltkissuewatchsService";

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

/** Downscale a screenshot before upload: long edge capped at 1600,
 *  JPEG — a pasted 4K screenshot is bytes nobody needs. Small files
 *  pass through untouched (text screenshots keep their crisp PNG). */
async function shrinkImage(file: File): Promise<File> {
  if (file.size <= 1_500_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85)
    );
    if (blob === null || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file; // an undecodable image still uploads as-is
  }
}

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
  dlg.body.append(el("div", "app-field-label", "Summary"), title, el("div", "app-field-label", "Details"), desc);
  title.addEventListener("input", () => sync());

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
    const url = URL.createObjectURL(file);
    shots.push({ file, url });
    const cell = el("div", "app-issue-shot");
    const img = el("img", "") as HTMLImageElement;
    img.src = url;
    img.alt = file.name;
    const rm = el("button", "app-issue-shotrm", "✕") as HTMLButtonElement;
    rm.title = "Remove";
    rm.addEventListener("click", () => {
      const i = shots.findIndex((s) => s.url === url);
      if (i >= 0) {
        URL.revokeObjectURL(shots[i].url);
        shots.splice(i, 1);
      }
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
    sendBtn.disabled = running || title.value.trim() === "";
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
