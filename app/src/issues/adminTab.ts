// Issues — the Administration tab (issues plan I2, 2026-08-12).
// Superadmin-gated by the settings screen (the tab only exists for
// superadmins); everything here is Dataverse, no connectors.
//
// The triage rules this encodes (docs/leanboard-issues-plan.md):
//  - status changes write themselves into the thread, so the reporter
//    timeline is complete without admin effort;
//  - DECLINE PROMPTS for a reporter-facing message (Ben, 2026-08-12) —
//    prefilled courteously, edited before sending, never silent;
//  - MERGE closes the child as status=merged pointing at its parent,
//    the child's reporter joins the parent's watch audience, and the
//    child's thread says where the conversation continues.

import { el, clear } from "../../../shared/ui/dom";
import { openDialog } from "../../../shared/ui/dialog";
import { currentViewer } from "../runtime";
import { Ben_ltkissuesService } from "../generated/services/Ben_ltkissuesService";
import { Ben_ltkissuefilesService } from "../generated/services/Ben_ltkissuefilesService";
import { Ben_ltkissuemessagesService } from "../generated/services/Ben_ltkissuemessagesService";
import { Ben_ltkissuewatchsService } from "../generated/services/Ben_ltkissuewatchsService";
import type { Ben_ltkissues } from "../generated/models/Ben_ltkissuesModel";

const OPEN_STATUSES = ["new", "triaged", "inprogress"] as const;
const STATUS_WORDS: Record<string, string> = {
  new: "New",
  triaged: "Triaged",
  inprogress: "In progress",
  done: "Done",
  declined: "Declined",
  merged: "Merged",
};
const AREA_WORDS: Record<string, string> = {
  boards: "Boards",
  cards: "Cards",
  documents: "Documents",
  settings: "Settings",
  other: "Other",
};

/** Chunked base64 — String.fromCharCode over a whole screenshot would
 *  blow the argument limit. */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return btoa(bin);
}

/** Full-size viewer: a fixed overlay, closed by any click — data: urls
 *  cannot ride window.open. */
function openLightbox(url: string, alt: string): void {
  const box = el("div", "app-issad-lightbox");
  const img = el("img", "") as HTMLImageElement;
  img.src = url;
  img.alt = alt;
  box.appendChild(img);
  box.addEventListener("click", () => box.remove());
  document.body.appendChild(box);
}

const ago = (iso: string | undefined): string => {
  const t = Date.parse(iso ?? "");
  if (Number.isNaN(t)) return "";
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  if (days < 60) return `${days} days`;
  return `${Math.round(days / 30)} months`;
};

type Issue = Ben_ltkissues;

export async function renderIssuesAdmin(body: HTMLElement): Promise<void> {
  const me = currentViewer();
  const myEmail = (me?.email ?? "").toLowerCase();
  const myName = me?.name ?? "";
  const note = (text: string) => el("div", "app-settings-note", text);

  body.appendChild(el("div", "app-section", "Issues"));
  body.appendChild(
    note(
      "Reports and ideas from the ⚐ Report button. Status changes write themselves into " +
        "the reporter's thread; declining asks you for a message first."
    )
  );

  // ---- filters ----------------------------------------------------------
  const filters = el("div", "app-issad-filters");
  const statusSel = el("select", "app-input") as HTMLSelectElement;
  for (const [v, l] of [
    ["open", "Open (new · triaged · in progress)"],
    ["new", "New"],
    ["triaged", "Triaged"],
    ["inprogress", "In progress"],
    ["done", "Done"],
    ["declined", "Declined"],
    ["merged", "Merged"],
    ["all", "Everything"],
  ]) {
    const o = el("option", "", l) as HTMLOptionElement;
    o.value = v;
    statusSel.appendChild(o);
  }
  const kindSel = el("select", "app-input") as HTMLSelectElement;
  for (const [v, l] of [["all", "Bugs & ideas"], ["bug", "Bugs"], ["idea", "Ideas"]]) {
    const o = el("option", "", l) as HTMLOptionElement;
    o.value = v;
    kindSel.appendChild(o);
  }
  const areaSel = el("select", "app-input") as HTMLSelectElement;
  {
    const all = el("option", "", "All areas") as HTMLOptionElement;
    all.value = "all";
    areaSel.appendChild(all);
    for (const [v, l] of Object.entries(AREA_WORDS)) {
      const o = el("option", "", l) as HTMLOptionElement;
      o.value = v;
      areaSel.appendChild(o);
    }
  }
  filters.append(statusSel, kindSel, areaSel);
  body.appendChild(filters);

  const listHost = el("div", "app-issad-list");
  body.appendChild(listHost);

  // ---- data helpers ------------------------------------------------------
  const authorLine = () => ({ ben_authoremail: myEmail, ben_authorname: myName });
  const say = (e: unknown) => String(e instanceof Error ? e.message : e).slice(0, 200);

  const writeMessage = async (
    issueId: string,
    bodyText: string,
    audience: "reporter" | "internal"
  ) => {
    const r = await Ben_ltkissuemessagesService.create({
      ben_name: bodyText.slice(0, 290),
      ben_body: bodyText,
      ben_audience: audience,
      ...authorLine(),
      "ben_Issue@odata.bind": `/ben_ltkissues(${issueId})`,
    } as Parameters<typeof Ben_ltkissuemessagesService.create>[0]);
    if (r.success === false) throw new Error(r.error?.message ?? "the message was refused");
  };

  const ensureWatch = async (issueId: string, email: string, name: string) => {
    if (email === "") return;
    const has = await Ben_ltkissuewatchsService.getAll({
      filter: `_ben_issue_value eq '${issueId}' and ben_email eq '${email}'`,
      top: 1,
    });
    if (has.success !== false && (has.data ?? []).length > 0) return;
    await Ben_ltkissuewatchsService.create({
      ben_name: `+1 — ${email}`,
      ben_email: email,
      ben_watchername: name,
      "ben_Issue@odata.bind": `/ben_ltkissues(${issueId})`,
    } as Parameters<typeof Ben_ltkissuewatchsService.create>[0]);
  };

  // ---- the list ----------------------------------------------------------
  const paint = async () => {
    clear(listHost);
    listHost.appendChild(el("div", "app-loading-line", "Reading issues…"));
    const parts: string[] = [];
    if (statusSel.value === "open") {
      parts.push(`(${OPEN_STATUSES.map((s) => `ben_status eq '${s}'`).join(" or ")})`);
    } else if (statusSel.value !== "all") {
      parts.push(`ben_status eq '${statusSel.value}'`);
    }
    if (kindSel.value !== "all") parts.push(`ben_kind eq '${kindSel.value}'`);
    if (areaSel.value !== "all") parts.push(`ben_area eq '${areaSel.value}'`);
    const res = await Ben_ltkissuesService.getAll({
      ...(parts.length > 0 ? { filter: parts.join(" and ") } : {}),
      top: 200,
    });
    clear(listHost);
    if (res.success === false) {
      listHost.appendChild(note(`Issues could not be read: ${res.error?.message ?? ""}`));
      return;
    }
    // priority rank first (unranked last), then oldest first — the
    // queue reads top-to-bottom as "work on this next"
    const rows = [...(res.data ?? [])].sort((a, b) => {
      const pa = a.ben_priority ?? Number.POSITIVE_INFINITY;
      const pb = b.ben_priority ?? Number.POSITIVE_INFINITY;
      if (pa !== pb) return pa - pb;
      return Date.parse(a.createdon ?? "") - Date.parse(b.createdon ?? "");
    });
    if (rows.length === 0) {
      listHost.appendChild(note("Nothing here — adjust the filters, or enjoy the silence."));
      return;
    }
    for (const issue of rows) listHost.appendChild(issueRow(issue));
  };
  statusSel.addEventListener("change", () => void paint());
  kindSel.addEventListener("change", () => void paint());
  areaSel.addEventListener("change", () => void paint());

  // ---- one row + its expanding detail -------------------------------------
  const issueRow = (issue: Issue): HTMLElement => {
    const wrap = el("div", "app-issad-item");
    const row = el("button", "app-issad-row") as HTMLButtonElement;
    const pill = el(
      "span",
      `app-issad-pill app-issad-pill-${issue.ben_kind === "idea" ? "idea" : "bug"}`,
      issue.ben_kind === "idea" ? "Idea" : "Bug"
    );
    const text = el("div", "app-issad-text");
    text.append(
      el("div", "app-issad-title", issue.ben_name ?? ""),
      el(
        "div",
        "app-issad-meta",
        [
          AREA_WORDS[issue.ben_area ?? ""] ?? issue.ben_area ?? "",
          issue.ben_reportername || issue.ben_reporteremail || "",
          ago(issue.createdon),
        ]
          .filter((s) => s !== "")
          .join(" · ")
      )
    );
    const right = el("div", "app-issad-right");
    if (issue.ben_priority !== undefined && issue.ben_priority !== null) {
      right.appendChild(el("span", "app-issad-prio", `P${issue.ben_priority}`));
    }
    right.appendChild(
      el(
        "span",
        `app-issad-status app-issad-status-${issue.ben_status ?? "new"}`,
        STATUS_WORDS[issue.ben_status ?? ""] ?? issue.ben_status ?? ""
      )
    );
    row.append(pill, text, right);
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
      void paintDetail(detail, issue);
    });
    return wrap;
  };

  const paintDetail = async (host: HTMLElement, issue: Issue) => {
    const id = issue.ben_ltkissueid;
    host.appendChild(el("div", "app-loading-line", "Reading the details…"));
    const [files, messages, watches, children] = await Promise.all([
      Ben_ltkissuefilesService.getAll({ filter: `_ben_issue_value eq '${id}'` }),
      Ben_ltkissuemessagesService.getAll({ filter: `_ben_issue_value eq '${id}'` }),
      Ben_ltkissuewatchsService.getAll({ filter: `_ben_issue_value eq '${id}'` }),
      Ben_ltkissuesService.getAll({
        filter: `_ben_duplicateof_value eq '${id}'`,
        select: ["ben_ltkissueid", "ben_name", "ben_reportername"],
      }),
    ]);
    clear(host);

    // description + context
    if ((issue.ben_description ?? "").trim() !== "") {
      host.appendChild(el("div", "app-issad-desc", issue.ben_description ?? ""));
    }
    try {
      const ctx = JSON.parse(issue.ben_context ?? "{}") as Record<string, string>;
      const line = ["version", "route", "viewport", "when"]
        .map((k) => (ctx[k] !== undefined ? `${k}: ${ctx[k]}` : ""))
        .filter((s) => s !== "")
        .join("  ·  ");
      const ua = ctx.userAgent ?? "";
      host.appendChild(el("div", "app-issad-ctx", `${line}${ua !== "" ? `\n${ua}` : ""}`));
    } catch {
      /* unparseable context stays unshown */
    }
    const mergedIn = children.success !== false ? (children.data ?? []) : [];
    if (mergedIn.length > 0) {
      host.appendChild(
        el(
          "div",
          "app-field-hint",
          `Includes ${mergedIn.length} merged report${mergedIn.length > 1 ? "s" : ""}: ` +
            mergedIn.map((c) => c.ben_name ?? "").join(" · ")
        )
      );
    }
    const watchers = watches.success !== false ? (watches.data ?? []) : [];
    if (watchers.length > 0) {
      host.appendChild(
        el("div", "app-field-hint", `${watchers.length} following (+1) beyond the reporter`)
      );
    }

    // attachments — bytes through the SDK's file door, painted as DATA
    // urls (the player's CSP blocks blob: images — Ben, 2026-08-12) with
    // an in-app lightbox for full size (window.open on data: is blocked
    // everywhere)
    const fileRows = files.success !== false ? (files.data ?? []) : [];
    if (fileRows.length > 0) {
      const shots = el("div", "app-issue-shots");
      host.appendChild(shots);
      void (async () => {
        const { getClient } = await import("@microsoft/power-apps/data");
        const { dataSourcesInfo } = await import("../../.power/schemas/appschemas/dataSourcesInfo");
        const client = getClient(dataSourcesInfo);
        for (const f of fileRows) {
          const down = await client.downloadFileFromRecord(
            "ben_ltkissuefiles",
            f.ben_ltkissuefileid,
            "ben_file"
          );
          if (down.success === false || !(down.data instanceof Uint8Array)) continue;
          const name = f.ben_name ?? "shot";
          const type = /\.png$/i.test(name) ? "image/png" : "image/jpeg";
          const url = `data:${type};base64,${bytesToBase64(down.data)}`;
          const cell = el("div", "app-issue-shot");
          const img = el("img", "") as HTMLImageElement;
          img.src = url;
          img.alt = name;
          img.title = "View full size";
          img.style.cursor = "zoom-in";
          img.addEventListener("click", () => openLightbox(url, name));
          cell.appendChild(img);
          shots.appendChild(cell);
        }
        if (shots.childElementCount === 0) shots.remove();
      })();
    }

    // the thread — reporter-visible and internal, marked apart
    const thread = el("div", "app-issad-thread");
    const msgs = (messages.success !== false ? (messages.data ?? []) : []).sort(
      (a, b) => Date.parse(a.createdon ?? "") - Date.parse(b.createdon ?? "")
    );
    for (const m of msgs) {
      const line = el(
        "div",
        `app-issad-msg${m.ben_audience === "internal" ? " app-issad-msg-int" : ""}`
      );
      line.append(
        el(
          "div",
          "app-issad-msghead",
          `${m.ben_authorname || m.ben_authoremail || ""} · ${ago(m.createdon)}` +
            (m.ben_audience === "internal" ? " · internal" : "")
        ),
        el("div", "app-issad-msgbody", m.ben_body ?? "")
      );
      thread.appendChild(line);
    }
    if (msgs.length > 0) host.appendChild(thread);

    // ---- controls ---------------------------------------------------------
    const controls = el("div", "app-issad-controls");
    host.appendChild(controls);
    const status = el("div", "app-docs-addstatus");
    const fail = (what: string, e: unknown) => {
      status.textContent = `${what}: ${say(e)}`;
      status.classList.add("app-docs-addstatus-warn");
    };
    const refresh = async () => {
      const fresh = await Ben_ltkissuesService.get(id);
      if (fresh.success !== false && fresh.data !== undefined) {
        Object.assign(issue, fresh.data);
      }
      clear(host);
      await paintDetail(host, issue);
    };

    // status — declining routes through the message prompt
    const statusPick = el("select", "app-input app-issad-ctl") as HTMLSelectElement;
    for (const s of ["new", "triaged", "inprogress", "done", "declined"]) {
      const o = el("option", "", STATUS_WORDS[s]) as HTMLOptionElement;
      o.value = s;
      statusPick.appendChild(o);
    }
    statusPick.value = OPEN_STATUSES.includes(issue.ben_status as never)
      ? (issue.ben_status ?? "new")
      : (issue.ben_status ?? "new");
    statusPick.addEventListener("change", () => {
      const to = statusPick.value;
      if (to === issue.ben_status) return;
      if (to === "declined") {
        openDecline(id, issue, () => void refresh());
        statusPick.value = issue.ben_status ?? "new"; // the dialog decides
        return;
      }
      void (async () => {
        try {
          const r = await Ben_ltkissuesService.update(id, { ben_status: to });
          if (r.success === false) throw new Error(r.error?.message ?? "refused");
          await writeMessage(id, `Status → ${STATUS_WORDS[to] ?? to}`, "reporter");
          await refresh();
        } catch (e) {
          fail("The status change was refused", e);
        }
      })();
    });

    // priority — the queue rank; lower runs first
    const prio = el("input", "app-input app-issad-ctl app-issad-prioin") as HTMLInputElement;
    prio.type = "number";
    prio.min = "0";
    prio.max = "1000";
    prio.placeholder = "P";
    prio.title = "Priority rank — lower sorts first, empty is unranked";
    prio.value =
      issue.ben_priority !== undefined && issue.ben_priority !== null
        ? String(issue.ben_priority)
        : "";
    prio.addEventListener("change", () => {
      void (async () => {
        const v = prio.value.trim() === "" ? null : Number(prio.value);
        try {
          const r = await Ben_ltkissuesService.update(id, {
            ben_priority: v,
          } as Parameters<typeof Ben_ltkissuesService.update>[1]);
          if (r.success === false) throw new Error(r.error?.message ?? "refused");
          issue.ben_priority = v ?? undefined;
        } catch (e) {
          fail("The priority write was refused", e);
        }
      })();
    });

    const mergeBtn = el("button", "app-btn app-issad-ctl", "Merge into…") as HTMLButtonElement;
    mergeBtn.addEventListener("click", () => openMerge(issue, () => void paint()));

    controls.append(
      el("span", "app-field-label", "Status"),
      statusPick,
      el("span", "app-field-label", "Priority"),
      prio,
      mergeBtn
    );

    // resolution note — what shipped, or why not
    const resoBox = el("textarea", "app-input app-issad-reso") as HTMLTextAreaElement;
    resoBox.rows = 2;
    resoBox.placeholder = "Resolution — what shipped, or why not (kept on the issue)";
    resoBox.value = issue.ben_resolution ?? "";
    const resoSave = el("button", "app-btn", "Save resolution") as HTMLButtonElement;
    resoSave.addEventListener("click", () => {
      void (async () => {
        try {
          const r = await Ben_ltkissuesService.update(id, { ben_resolution: resoBox.value });
          if (r.success === false) throw new Error(r.error?.message ?? "refused");
          issue.ben_resolution = resoBox.value;
          resoSave.textContent = "Saved ✓";
          window.setTimeout(() => (resoSave.textContent = "Save resolution"), 1500);
        } catch (e) {
          fail("The resolution write was refused", e);
        }
      })();
    });
    const resoRow = el("div", "app-issad-resorow");
    resoRow.append(resoBox, resoSave);
    host.appendChild(resoRow);

    // message compose — the reporter loop's admin half
    const compose = el("textarea", "app-input app-issad-compose") as HTMLTextAreaElement;
    compose.rows = 2;
    compose.placeholder = `Message ${issue.ben_reportername || "the reporter"}…`;
    const sendRep = el("button", "app-btn", "Send to reporter") as HTMLButtonElement;
    const sendInt = el("button", "app-btn", "Internal note") as HTMLButtonElement;
    const sendIt = (audience: "reporter" | "internal") => {
      const text = compose.value.trim();
      if (text === "") return;
      void (async () => {
        sendRep.disabled = sendInt.disabled = true;
        try {
          await writeMessage(id, text, audience);
          compose.value = "";
          await refresh();
        } catch (e) {
          fail("The message was refused", e);
          sendRep.disabled = sendInt.disabled = false;
        }
      })();
    };
    sendRep.addEventListener("click", () => sendIt("reporter"));
    sendInt.addEventListener("click", () => sendIt("internal"));
    const composeRow = el("div", "app-issad-composerow");
    composeRow.append(compose, sendRep, sendInt);
    host.appendChild(composeRow);
    host.appendChild(status);
  };

  // ---- decline: the message IS the act ------------------------------------
  const openDecline = (id: string, issue: Issue, onDone: () => void) => {
    const dlgHost = el("div", "app-dlghost");
    body.appendChild(dlgHost);
    let running = false;
    const dlg = openDialog({
      host: dlgHost,
      title: `Decline — ${issue.ben_name ?? ""}`,
      maxWidth: 480,
      onClose: () => dlgHost.remove(),
      buttons: [
        { label: "Cancel", kind: "secondary", onClick: () => { if (!running) dlg.close(); } },
        { label: "Decline & send", kind: "primary", onClick: () => void go() },
      ],
    });
    dlg.body.appendChild(
      el(
        "div",
        "app-field-hint",
        "Declining always tells the reporter why — edit the message before it goes."
      )
    );
    const msg = el("textarea", "app-input") as HTMLTextAreaElement;
    msg.rows = 4;
    msg.value =
      `Thanks for reporting this — we've decided not to take it further right now. ` +
      `It stays on record, and we may revisit it as the app evolves.`;
    dlg.body.append(el("div", "app-field-label", "Message to the reporter"), msg);
    const st = el("div", "app-docs-addstatus");
    dlg.body.appendChild(st);
    const go = async () => {
      if (running || msg.value.trim() === "") return;
      running = true;
      st.textContent = "Declining…";
      try {
        const r = await Ben_ltkissuesService.update(id, { ben_status: "declined" });
        if (r.success === false) throw new Error(r.error?.message ?? "refused");
        await writeMessage(id, `Status → Declined`, "reporter");
        await writeMessage(id, msg.value.trim(), "reporter");
        dlg.close();
        onDone();
      } catch (e) {
        st.textContent = `Could not decline: ${say(e)}`;
        st.classList.add("app-docs-addstatus-warn");
        running = false;
      }
    };
  };

  // ---- merge: the child closes, its people follow the parent --------------
  const openMerge = (child: Issue, onDone: () => void) => {
    const dlgHost = el("div", "app-dlghost");
    body.appendChild(dlgHost);
    let running = false;
    let picked: Issue | null = null;
    const dlg = openDialog({
      host: dlgHost,
      title: `Merge — ${child.ben_name ?? ""}`,
      maxWidth: 520,
      onClose: () => dlgHost.remove(),
      buttons: [
        { label: "Cancel", kind: "secondary", onClick: () => { if (!running) dlg.close(); } },
        { label: "Merge", kind: "primary", onClick: () => void go() },
      ],
    });
    const goBtn = dlg.root.querySelector(".ltk-btn-primary") as HTMLButtonElement;
    goBtn.disabled = true;
    dlg.body.appendChild(
      el(
        "div",
        "app-field-hint",
        "This report closes as merged; its reporter follows the issue it merges into and " +
          "gets that issue's updates from here on."
      )
    );
    const search = el("input", "app-input") as HTMLInputElement;
    search.placeholder = "Search open issues to merge into…";
    dlg.body.append(search);
    const hits = el("div", "app-issad-mergehits");
    dlg.body.appendChild(hits);
    const st = el("div", "app-docs-addstatus");
    dlg.body.appendChild(st);
    let timer = 0;
    search.addEventListener("input", () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void look(), 250);
    });
    const look = async () => {
      clear(hits);
      const q = search.value.trim().replace(/'/g, "''");
      if (q === "") return;
      const res = await Ben_ltkissuesService.getAll({
        filter:
          `contains(ben_name,'${q}') and ben_ltkissueid ne '${child.ben_ltkissueid}' and ` +
          `(${OPEN_STATUSES.map((s) => `ben_status eq '${s}'`).join(" or ")})`,
        select: ["ben_ltkissueid", "ben_name", "ben_status", "ben_reportername"],
        top: 8,
      });
      for (const r of res.success === false ? [] : (res.data ?? [])) {
        const b = el(
          "button",
          "app-issad-mergehit",
          `${r.ben_name ?? ""} — ${STATUS_WORDS[r.ben_status ?? ""] ?? ""}`
        ) as HTMLButtonElement;
        b.addEventListener("click", () => {
          picked = r as Issue;
          for (const x of Array.from(hits.children)) x.classList.remove("app-issad-mergehit-on");
          b.classList.add("app-issad-mergehit-on");
          goBtn.disabled = false;
        });
        hits.appendChild(b);
      }
      if (hits.childElementCount === 0) {
        hits.appendChild(el("div", "app-field-hint", "No open issues match."));
      }
    };
    const go = async () => {
      if (running || picked === null) return;
      running = true;
      st.textContent = "Merging…";
      try {
        const parent = picked;
        const r = await Ben_ltkissuesService.update(child.ben_ltkissueid, {
          ben_status: "merged",
          "ben_DuplicateOf@odata.bind": `/ben_ltkissues(${parent.ben_ltkissueid})`,
        } as Parameters<typeof Ben_ltkissuesService.update>[1]);
        if (r.success === false) throw new Error(r.error?.message ?? "refused");
        await ensureWatch(
          parent.ben_ltkissueid,
          (child.ben_reporteremail ?? "").toLowerCase(),
          child.ben_reportername ?? ""
        );
        await writeMessage(
          child.ben_ltkissueid,
          `Merged into "${parent.ben_name ?? ""}" — updates continue there.`,
          "reporter"
        );
        await writeMessage(
          parent.ben_ltkissueid,
          `Merged in: "${child.ben_name ?? ""}" (${child.ben_reportername || child.ben_reporteremail || "unknown"})`,
          "internal"
        );
        dlg.close();
        onDone();
      } catch (e) {
        st.textContent = `Could not merge: ${say(e)}`;
        st.classList.add("app-docs-addstatus-warn");
        running = false;
      }
    };
  };

  await paint();
}
