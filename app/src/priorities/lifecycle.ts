// Cascaded priorities — the lifecycle UI (build item 2 / design §3, §6,
// §10, §11): the cascade review list behind the toolbar chip, the reason
// dialogs (hold / reject / close), the period carry-forward flow, and the
// priority detail overlay with its right rail. Pure decisions live in
// model.ts; writes go through store/priorities.ts.
//
// P2 stand-ins until initiatives exist (P5): the Initiatives, Charter and
// Actions tabs state that plainly; `Add initiative` is shown disabled so
// the overlay keeps its one solid primary in the right place.

import { el, clear } from "../../../shared/ui/dom";
import type { RosterPerson } from "../store/mappers";
import {
  appendEvent,
  CascadeData,
  decideAssignment,
  listEvents,
  saveAssignment,
  savePriority,
  newPriority,
} from "../store/priorities";
import { modal, field, OrgTree, childOrgs, priorityDialog } from "./dialogs";
import {
  carryForwardCopy,
  CLOSE_REASONS,
  CloseReason,
  lineageFor,
  nextPeriod,
  OrgRef,
  orgKey,
  orgName,
  orgParent,
  parentClosed,
  Priority,
  PriorityAssignment,
  PriorityEvent,
  PrioritySettings,
  Rag,
  ragPaletteKey,
  reviewQueue,
  rollup,
  RollupRule,
  rollupWords,
  sameOrg,
  senderFlags,
  tally,
  tallyLine,
} from "./model";

/** What the screen hands the lifecycle UI — its live state and callbacks. */
export interface LifecycleCtx {
  host: HTMLElement;
  data: () => CascadeData;
  tree: OrgTree;
  roster: RosterPerson[];
  settings: PrioritySettings;
  rule: () => RollupRule;
  palette: Record<string, string>;
  actor: () => { whoId: string; who: string };
  canManage: (org: OrgRef) => boolean;
  ownerNameFor: (org: OrgRef) => string;
  periodsOnOffer: () => string[];
  currentPeriod: string;
  ragsFor: (p: Priority) => Rag[];
  /** After any write: reload the cascade and repaint (scroll preserved). */
  changed: () => Promise<void>;
  /** Open the detail overlay for a priority (used by the review list). */
  open: (p: Priority) => void;
}

const btn = (label: string, cls = "app-btn"): HTMLButtonElement => {
  const b = el("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  return b;
};

// ---- reason dialogs (§10) ------------------------------------------------------

export function reasonDialog(host: HTMLElement, title: string, note: string, placeholder: string): Promise<string | null> {
  return new Promise((resolve) => {
    const m = modal(host, title, note);
    const ta = el("textarea", "app-input") as HTMLTextAreaElement;
    ta.rows = 3;
    ta.placeholder = placeholder;
    m.body.appendChild(ta);
    const err = el("div", "app-cp-err", "");
    m.body.appendChild(err);
    const done = (v: string | null) => {
      m.close();
      resolve(v);
    };
    const cancel = btn("Cancel", "app-link");
    cancel.addEventListener("click", () => done(null));
    const ok = btn("Send", "app-btn app-btn-primary");
    ok.addEventListener("click", () => {
      if (ta.value.trim() === "") {
        err.textContent = "A reason is needed — the sender sees it.";
        ta.focus();
        return;
      }
      done(ta.value.trim());
    });
    m.footer.append(cancel, ok);
    ta.focus();
  });
}

/** "Why is this closing?" — reason picklist + optional note. */
export function closeDialog(
  host: HTMLElement,
  p: Priority,
  mode: "complete" | "archive",
  nextPeriodName: string
): Promise<{ reason: CloseReason; note: string; carry: boolean } | null> {
  return new Promise((resolve) => {
    const m = modal(host, mode === "complete" ? "Complete priority" : "Archive priority", `“${p.statement.slice(0, 120)}”`);
    m.body.appendChild(el("div", "app-cp-q", "Why is this closing?"));
    const list = el("div", "app-cp-reasons");
    let chosen: CloseReason | null = null;
    const paint = () => {
      list.querySelectorAll(".app-cp-reason").forEach((b) => b.classList.toggle("app-cp-reason-on", b.textContent === chosen));
      carryRow.style.display = chosen === "Carried to next period" ? "" : "none";
    };
    for (const r of CLOSE_REASONS) {
      const b = btn(r, "app-cp-reason");
      b.addEventListener("click", () => {
        chosen = r;
        paint();
      });
      list.appendChild(b);
    }
    m.body.appendChild(list);
    const carryRow = el("div", "app-cp-muted");
    carryRow.textContent =
      nextPeriodName !== ""
        ? `A copy will be created in ${nextPeriodName} — same statement, pillar, owner and org. Cascades are re-sent from there.`
        : "No next period is defined (custom periods) — set the next period name in Settings → Priorities first; nothing will be copied.";
    carryRow.style.display = "none";
    m.body.appendChild(carryRow);
    const note = el("textarea", "app-input") as HTMLTextAreaElement;
    note.rows = 2;
    note.placeholder = "Optional note";
    m.body.appendChild(field("Note", note));
    const err = el("div", "app-cp-err", "");
    m.body.appendChild(err);
    const done = (v: { reason: CloseReason; note: string; carry: boolean } | null) => {
      m.close();
      resolve(v);
    };
    const cancel = btn("Cancel", "app-link");
    cancel.addEventListener("click", () => done(null));
    const ok = btn(mode === "complete" ? "Complete" : "Archive", "app-btn app-btn-primary");
    ok.addEventListener("click", () => {
      if (chosen === null) {
        err.textContent = "Pick a reason.";
        return;
      }
      done({ reason: chosen, note: note.value.trim(), carry: chosen === "Carried to next period" && nextPeriodName !== "" });
    });
    m.footer.append(cancel, ok);
  });
}

// ---- lifecycle writes -------------------------------------------------------------

export async function closePriority(
  ctx: LifecycleCtx,
  p: Priority,
  mode: "complete" | "archive",
  r: { reason: CloseReason; note: string; carry: boolean }
): Promise<void> {
  const data = ctx.data();
  p.status = mode === "complete" ? "completed" : "archived";
  p.statusReason = r.note !== "" ? `${r.reason} — ${r.note}` : r.reason;
  await savePriority(p, data);
  await appendEvent(p, mode === "complete" ? "completed" : "archived", { reason: r.reason, note: r.note }, ctx.actor());
  if (r.carry) {
    const next = nextPeriod(ctx.settings.period, p.period);
    if (next !== "") {
      const copy = carryForwardCopy(p, next, newPriority(p.org, next).id);
      copy.rowId = await savePriority(copy, data);
      data.priorities.push(copy);
      await appendEvent(copy, "carriedForward", { from: p.id, fromPeriod: p.period }, ctx.actor());
      await appendEvent(p, "carriedForward", { to: copy.id, toPeriod: next }, ctx.actor());
    }
  }
  await ctx.changed();
}

/** Bulk carry-forward at period end (toolbar ⋮): pick which active
 *  priorities of the current period roll into the next. */
export function carryForwardFlow(ctx: LifecycleCtx, org: OrgRef, period: string, candidates: Priority[]): void {
  const next = nextPeriod(ctx.settings.period, period);
  const m = modal(
    ctx.host,
    `Carry forward to ${next || "the next period"}`,
    next !== ""
      ? `Tick the ${orgName(org)} priorities from ${period} that continue. Each is completed as “Carried to next period” and copied into ${next}.`
      : "Custom periods have no automatic successor — set the next period name in Settings → Priorities first.",
    true
  );
  const picked = new Set<string>(candidates.map((p) => p.id));
  const list = el("div", "app-cp-cascade");
  for (const p of candidates) {
    const lab = el("label", "app-cp-cascade-row") as HTMLLabelElement;
    const cb = el("input") as HTMLInputElement;
    cb.type = "checkbox";
    cb.checked = true;
    cb.addEventListener("change", () => (cb.checked ? picked.add(p.id) : picked.delete(p.id)));
    lab.append(cb, el("span", "app-cp-cascade-org", p.statement));
    list.appendChild(lab);
  }
  if (candidates.length === 0) list.appendChild(el("div", "app-cp-muted", `No active priorities for ${period} in this org.`));
  m.body.appendChild(list);
  const cancel = btn("Cancel", "app-link");
  cancel.addEventListener("click", () => m.close());
  const ok = btn("Carry forward", "app-btn app-btn-primary");
  ok.disabled = next === "" || candidates.length === 0;
  ok.addEventListener("click", () => {
    ok.disabled = true;
    m.close();
    void (async () => {
      for (const p of candidates.filter((x) => picked.has(x.id))) {
        await closePriority({ ...ctx, changed: async () => undefined }, p, "complete", { reason: "Carried to next period", note: "", carry: true });
      }
      await ctx.changed();
    })();
  });
  m.footer.append(cancel, ok);
}

/** Cascade-only dialog (overlay rail): tick child/peer orgs. */
export function cascadeDialog(ctx: LifecycleCtx, p: Priority): void {
  const data = ctx.data();
  const kids = childOrgs(ctx.tree, p.org);
  const parent = orgParent(p.org);
  const peers = parent ? childOrgs(ctx.tree, parent).filter((o) => !sameOrg(o, p.org)) : [];
  const targets = [...kids, ...peers];
  const already = new Set(data.assignments.filter((a) => a.priorityId === p.id).map((a) => orgKey(a.org)));
  const m = modal(ctx.host, "Cascade to…", "Child orgs and peers. Each receives it as a request to accept.");
  const picked = new Set<string>();
  const list = el("div", "app-cp-cascade");
  for (const o of targets) {
    const key = orgKey(o);
    const lab = el("label", "app-cp-cascade-row") as HTMLLabelElement;
    const cb = el("input") as HTMLInputElement;
    cb.type = "checkbox";
    if (already.has(key)) {
      cb.checked = true;
      cb.disabled = true;
    }
    cb.addEventListener("change", () => {
      if (cb.checked) picked.add(key);
      else picked.delete(key);
      confirm.textContent = picked.size > 0 ? `This will send the priority to ${picked.size} org${picked.size === 1 ? "" : "s"} for acceptance.` : "";
    });
    const owner = ctx.ownerNameFor(o);
    lab.append(cb, el("span", "app-cp-cascade-org", orgName(o)), el("span", "app-cp-muted", owner !== "" ? ` · ${owner}` : " · no owner"));
    list.appendChild(lab);
  }
  if (targets.length === 0) list.appendChild(el("div", "app-cp-muted", "No child or peer orgs to cascade to from here."));
  m.body.appendChild(list);
  const confirm = el("div", "app-cp-confirm", "");
  m.body.appendChild(confirm);
  const cancel = btn("Cancel", "app-link");
  cancel.addEventListener("click", () => m.close());
  const ok = btn("Send", "app-btn app-btn-primary");
  ok.addEventListener("click", () => {
    const chosen = targets.filter((o) => picked.has(orgKey(o)));
    m.close();
    if (chosen.length === 0) return;
    void (async () => {
      for (const org of chosen) {
        await saveAssignment(
          { id: "", priorityId: p.id, org, status: "proposed", reason: "", decidedById: "", decidedByName: "", decidedAt: "", childPriorityId: "" },
          data
        );
      }
      await appendEvent(p, "cascaded", { to: chosen.map(orgName) }, ctx.actor());
      await ctx.changed();
    })();
  });
  m.footer.append(cancel, ok);
}

// ---- cascade review list (§3) -------------------------------------------------------

export function cascadeReview(ctx: LifecycleCtx, org: OrgRef): void {
  const m = modal(ctx.host, "Cascades to accept", `Sent to ${orgName(org)} from above or beside. Accept as-is, accept and customise the wording, hold, or reject — the sender sees your reason.`, true);
  const list = el("div", "app-cp-review");
  m.body.appendChild(list);

  const paint = () => {
    clear(list);
    const data = ctx.data();
    const queue = reviewQueue(org, data.assignments);
    if (queue.length === 0) {
      list.appendChild(el("div", "app-cp-muted", "Nothing waiting on this org."));
      return;
    }
    let lastStatus = "";
    for (const a of queue) {
      const p = data.priorities.find((x) => x.id === a.priorityId);
      if (!p) continue;
      if (a.status !== lastStatus) {
        list.appendChild(el("div", "app-cp-menu-h", a.status === "proposed" ? "Awaiting your decision" : "Parked (on hold)"));
        lastStatus = a.status;
      }
      const row = el("div", "app-cp-review-row");
      const main = el("div", "app-cp-review-main");
      main.appendChild(el("div", "app-cp-review-statement", p.statement));
      const pillar = data.pillars.find((x) => x.id === p.pillarId);
      const parentL1 = pillar ? data.pillars.find((x) => x.id === pillar.parentId) : undefined;
      const lin = lineageFor(p, data.priorities, data.assignments);
      const meta = [
        `Cascaded from ${orgName(p.org)}${p.ownerName !== "" ? ` · ${p.ownerName}` : ""}`,
        pillar ? `${parentL1 ? parentL1.name + " › " : ""}${pillar.name}` : "",
        lin.from ? `↑ ${orgName(lin.from)}` : "",
        p.period,
        a.status === "onhold" && a.reason !== "" ? `parked — “${a.reason}”` : "",
      ].filter((s) => s !== "");
      main.appendChild(el("div", "app-cp-review-meta", meta.join(" · ")));
      row.appendChild(main);
      const acts = el("div", "app-cp-review-acts");
      const can = ctx.canManage(org);
      const accept = btn("Accept", "app-btn app-btn-primary");
      const customise = btn("Accept & customise");
      const hold = btn(a.status === "onhold" ? "Update hold" : "Hold");
      const reject = btn("Reject", "app-btn app-btn-danger");
      for (const b of [accept, customise, hold, reject]) b.disabled = !can;
      accept.addEventListener("click", () => void decide(a, p, "accepted"));
      customise.addEventListener("click", () => void acceptCustomised(a, p));
      hold.addEventListener("click", () => void decide(a, p, "onhold"));
      reject.addEventListener("click", () => void decide(a, p, "rejected"));
      acts.append(accept, customise, hold, reject);
      row.appendChild(acts);
      list.appendChild(row);
    }
  };

  const decide = async (a: PriorityAssignment, p: Priority, status: "accepted" | "onhold" | "rejected") => {
    let reason = "";
    if (status !== "accepted") {
      const r = await reasonDialog(
        ctx.host,
        status === "onhold" ? "Hold this priority" : "Reject this priority",
        `Tell ${orgName(p.org)} why — they'll see this on their view.`,
        "e.g. no capacity until Q3"
      );
      if (r === null) return;
      reason = r;
    }
    await decideAssignment(a, status, reason, ctx.actor(), "", ctx.data());
    await appendEvent(p, status === "accepted" ? "accepted" : status === "onhold" ? "held" : "rejected", { org: orgName(org), reason }, ctx.actor());
    await ctx.changed();
    paint();
  };

  const acceptCustomised = async (a: PriorityAssignment, p: Priority) => {
    const data = ctx.data();
    const draft = newPriority(org, p.period);
    draft.statement = p.statement;
    draft.pillarId = p.pillarId;
    draft.parentId = p.id;
    draft.ownerId = ctx.actor().whoId;
    draft.ownerName = ctx.actor().who;
    draft.order = data.priorities.filter((x) => orgKey(x.org) === orgKey(org) && x.pillarId === p.pillarId).length + 1;
    const r = await priorityDialog({
      host: ctx.host,
      title: `Accept & customise — from ${orgName(p.org)}`,
      priority: draft,
      pillars: data.pillars,
      periods: ctx.periodsOnOffer(),
      roster: ctx.roster,
      cascadeTargets: childOrgs(ctx.tree, org).map((o) => ({ org: o, ownerName: ctx.ownerNameFor(o) })),
      alreadyCascaded: [],
      primaryInitiativeLabel: "",
    });
    if (!r) return;
    r.priority.rowId = await savePriority(r.priority, data);
    data.priorities.push(r.priority);
    await appendEvent(r.priority, "created", { statement: r.priority.statement, customisedFrom: p.id }, ctx.actor());
    await decideAssignment(a, "accepted", "", ctx.actor(), r.priority.id, data);
    await appendEvent(p, "customised", { org: orgName(org), child: r.priority.id, statement: r.priority.statement }, ctx.actor());
    for (const o of r.cascadeTo) {
      await saveAssignment(
        { id: "", priorityId: r.priority.id, org: o, status: "proposed", reason: "", decidedById: "", decidedByName: "", decidedAt: "", childPriorityId: "" },
        data
      );
    }
    if (r.cascadeTo.length > 0) await appendEvent(r.priority, "cascaded", { to: r.cascadeTo.map(orgName) }, ctx.actor());
    await ctx.changed();
    paint();
  };

  paint();
  const close = btn("Close", "app-link");
  close.addEventListener("click", () => m.close());
  m.footer.appendChild(close);
}

// ---- detail overlay (§6) -------------------------------------------------------------

export function openPriorityOverlay(ctx: LifecycleCtx, p: Priority, onEdit: (p: Priority) => void): () => void {
  const scrim = el("div", "app-cp-scrim");
  const box = el("div", "app-cp-overlay");
  scrim.appendChild(box);
  ctx.host.appendChild(scrim);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  const close = () => {
    scrim.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  document.addEventListener("keydown", onKey, true);
  scrim.addEventListener("pointerdown", (e) => {
    if (e.target === scrim) close();
  });

  let tab: "initiatives" | "charter" | "actions" | "history" = "initiatives";
  let events: PriorityEvent[] | null = null;

  const paint = () => {
    clear(box);
    const data = ctx.data();
    const live = data.priorities.find((x) => x.id === p.id) ?? p;
    const pillar = data.pillars.find((x) => x.id === live.pillarId);
    const parentL1 = pillar ? data.pillars.find((x) => x.id === pillar.parentId) : undefined;
    const can = ctx.canManage(live.org);

    // header
    const head = el("div", "app-cp-ov-head");
    const chip = el("span", "app-cp-ov-pillar", pillar ? `${parentL1 ? parentL1.name + " › " : ""}${pillar.name}` : "No sub-pillar");
    const colour = pillar?.color || parentL1?.color || "";
    if (colour !== "") {
      chip.style.background = colour;
      chip.style.color = "#fff";
    }
    head.appendChild(chip);
    head.appendChild(el("h2", "app-cp-ov-statement", live.statement));
    head.appendChild(
      el("div", "app-cp-ov-meta", [orgName(live.org), live.period, live.ownerName !== "" ? live.ownerName : "No owner", live.status !== "active" ? live.status : ""].filter((s) => s !== "").join(" · "))
    );
    const x = btn("✕", "app-btn app-cp-ov-close");
    x.title = "Close";
    x.addEventListener("click", close);
    head.appendChild(x);
    box.appendChild(head);

    // parent completed prompt (§10)
    const closedParent = parentClosed(live, data.priorities);
    if (closedParent) {
      const bar = el("div", "app-cp-ov-prompt");
      bar.appendChild(el("span", undefined, `${orgName(closedParent.org)} completed the parent of this priority. Complete yours, or keep it and note why.`));
      if (can) {
        const c = btn("Complete…", "app-btn");
        c.addEventListener("click", () => void doClose(live, "complete"));
        const k = btn("Keep", "app-btn");
        k.addEventListener("click", () => {
          void reasonDialog(ctx.host, "Keep this priority", "Note why it continues after its parent closed.", "e.g. still material for our site").then(async (r) => {
            if (r === null) return;
            live.notes = live.notes !== "" ? `${live.notes}\nKept after parent closed: ${r}` : `Kept after parent closed: ${r}`;
            await savePriority(live, data);
            await appendEvent(live, "edited", { keptAfterParentClosed: r }, ctx.actor());
            await ctx.changed();
            paint();
          });
        });
        bar.append(c, k);
      }
      box.appendChild(bar);
    }

    const desk = el("div", "app-cp-ov-desk");
    box.appendChild(desk);

    // left: tabs
    const left = el("div", "app-cp-ov-left");
    const tabs = el("div", "app-cp-ov-tabs");
    const rags = ctx.ragsFor(live);
    const tabDefs: [typeof tab, string][] = [
      ["initiatives", `Initiatives ${rags.length}`],
      ["charter", "Charter"],
      ["actions", "Actions"],
      ["history", "History"],
    ];
    for (const [key, label] of tabDefs) {
      const t = btn(label, "app-cp-ov-tab" + (tab === key ? " app-cp-ov-tab-on" : ""));
      t.addEventListener("click", () => {
        tab = key;
        paint();
      });
      tabs.appendChild(t);
    }
    left.appendChild(tabs);
    const body = el("div", "app-cp-ov-body");
    left.appendChild(body);
    if (tab === "initiatives") {
      body.appendChild(el("div", "app-cp-muted", "No initiatives yet. Initiatives — with PDCA stage, owner and open actions — arrive with the initiative board; this priority's R/A/G will roll up from them."));
    } else if (tab === "charter") {
      body.appendChild(el("div", "app-cp-muted", live.primaryInitiativeId !== "" ? "The primary initiative's charter shows here." : "No primary initiative linked. Its Canvas charter shows here, read-only, once one is."));
    } else if (tab === "actions") {
      body.appendChild(el("div", "app-cp-muted", "Open actions across this priority's initiatives show here, overdue first, once initiatives exist."));
    } else {
      if (events === null) {
        body.appendChild(el("div", "app-cp-muted", "Loading history…"));
        void listEvents(live).then((ev) => {
          events = ev;
          if (tab === "history" && scrim.isConnected) paint();
        });
      } else if (events.length === 0) {
        body.appendChild(el("div", "app-cp-muted", "No history yet."));
      } else {
        const ul = el("div", "app-cp-ov-events");
        for (const e of events) {
          const row = el("div", "app-cp-ov-event");
          row.appendChild(el("span", "app-cp-ov-event-when", e.at.slice(0, 10)));
          row.appendChild(el("span", "app-cp-ov-event-kind", e.kind));
          row.appendChild(el("span", "app-cp-ov-event-detail", eventWords(e)));
          row.appendChild(el("span", "app-cp-muted", e.actorName));
          ul.appendChild(row);
        }
        body.appendChild(ul);
      }
      if (live.notes !== "") body.appendChild(el("div", "app-cp-ov-notes", live.notes));
    }
    desk.appendChild(left);

    // rail
    const rail = el("div", "app-cp-ov-rail");
    const section = (title: string) => {
      const s = el("div", "app-cp-ov-section");
      s.appendChild(el("div", "app-cp-ov-section-h", title));
      rail.appendChild(s);
      return s;
    };
    const st = section("Status");
    const t = tally(rags);
    const rag = rollup(t, ctx.rule(), ctx.settings.ragRatioPct);
    const tl = el("div", "app-cp-tallies");
    for (const part of tallyLine(t)) {
      const s = el("span", "app-cp-tally" + (part.count === 0 ? " app-cp-tally-zero" : ""), `${part.glyph} ${part.count}`);
      if (part.count > 0) s.style.color = ctx.palette[ragPaletteKey(part.rag)] ?? "";
      tl.appendChild(s);
    }
    tl.appendChild(el("span", "app-cp-total", `· ${t.total} initiative${t.total === 1 ? "" : "s"}`));
    st.appendChild(tl);
    const words = el("div", "app-cp-ov-rollup", rollupWords(rag, ctx.rule(), ctx.settings.ragRatioPct));
    words.style.borderLeftColor = ctx.palette[ragPaletteKey(rag)] ?? "#9a948a";
    st.appendChild(words);
    if (live.status !== "active") st.appendChild(el("div", "app-cp-muted", `${live.status[0].toUpperCase()}${live.status.slice(1)}${live.statusReason !== "" ? " — " + live.statusReason : ""}`));

    const ln = section("Lineage");
    const parent = live.parentId !== "" ? data.priorities.find((x) => x.id === live.parentId) : undefined;
    if (parent) {
      const prow = btn(`↑ ${orgName(parent.org)} — ${parent.statement.slice(0, 80)}`, "app-cp-ov-link");
      prow.addEventListener("click", () => {
        close();
        ctx.open(parent);
      });
      ln.appendChild(prow);
    } else {
      ln.appendChild(el("div", "app-cp-muted", "Set here — not cascaded from above."));
    }
    const mine = data.assignments.filter((a) => a.priorityId === live.id);
    if (mine.length > 0) {
      const ul = el("div", "app-cp-ov-children");
      for (const a of mine) {
        const glyph = a.status === "accepted" || a.status === "completed" ? "✓" : a.status === "proposed" ? "⏳" : a.status === "onhold" ? "⏸" : "✕";
        const child = a.childPriorityId !== "" ? data.priorities.find((x) => x.id === a.childPriorityId) : undefined;
        const row = el("div", "app-cp-ov-child" + (a.status === "rejected" ? " app-cp-lineage-declined" : ""));
        let text = `${glyph} ${orgName(a.org)}`;
        if (a.status === "rejected") text = `✕ ${orgName(a.org)} declined this priority${a.reason !== "" ? ` — “${a.reason}”` : ""}`;
        else if (a.status === "onhold") text = `⏸ ${orgName(a.org)} parked${a.reason !== "" ? ` — “${a.reason}”` : ""}`;
        else if (child) text = `✓ ${orgName(a.org)} — customised: “${child.statement.slice(0, 60)}”`;
        else if (a.status === "proposed") text = `⏳ ${orgName(a.org)} — awaiting decision`;
        else text = `✓ ${orgName(a.org)} — accepted as-is`;
        row.textContent = text;
        if (child) {
          row.classList.add("app-cp-ov-link");
          row.addEventListener("click", () => {
            close();
            ctx.open(child);
          });
        }
        ul.appendChild(row);
      }
      ln.appendChild(ul);
    }

    const ac = section("Actions");
    ac.appendChild(el("div", "app-cp-muted", "0 open · 0 overdue — counts follow the initiatives."));

    // bottom-anchored buttons: one solid primary
    const foot = el("div", "app-cp-ov-foot");
    const add = btn("Add initiative", "app-btn app-btn-primary");
    add.disabled = true;
    add.title = "Initiatives arrive with the initiative board";
    foot.appendChild(add);
    if (can && live.status === "active") {
      const casc = btn("Cascade to…");
      casc.addEventListener("click", () => cascadeDialog(ctx, live));
      foot.appendChild(casc);
      const more = btn("⋮ More");
      more.addEventListener("click", () => {
        const menu = el("div", "app-cp-menu");
        const item = (label: string, run: () => void) => {
          const b = btn(label, "app-cp-menu-item");
          b.addEventListener("click", () => {
            menu.remove();
            run();
          });
          menu.appendChild(b);
        };
        item("Edit…", () => {
          close();
          onEdit(live);
        });
        item("Complete…", () => void doClose(live, "complete"));
        item("Archive…", () => void doClose(live, "archive"));
        const r = more.getBoundingClientRect();
        menu.style.top = `${r.top - 4}px`;
        menu.style.transform = "translateY(-100%)";
        menu.style.left = `${Math.min(r.left, window.innerWidth - 240)}px`;
        document.body.appendChild(menu);
        const off = (e: PointerEvent) => {
          if (!menu.contains(e.target as Node)) {
            menu.remove();
            document.removeEventListener("pointerdown", off, true);
          }
        };
        setTimeout(() => document.addEventListener("pointerdown", off, true), 0);
      });
      foot.appendChild(more);
    }
    rail.appendChild(foot);
    desk.appendChild(rail);
  };

  const doClose = async (live: Priority, mode: "complete" | "archive") => {
    const r = await closeDialog(ctx.host, live, mode, nextPeriod(ctx.settings.period, live.period));
    if (!r) return;
    await closePriority(ctx, live, mode, r);
    events = null;
    if (scrim.isConnected) paint();
  };

  paint();
  return close;
}

function eventWords(e: PriorityEvent): string {
  const d = e.detail;
  const str = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
  switch (e.kind) {
    case "created":
      return str("customisedFrom") !== "" ? "created as a customised copy" : "created";
    case "edited":
      return str("keptAfterParentClosed") !== "" ? `kept after parent closed — “${str("keptAfterParentClosed")}”` : str("to") !== "" ? `statement → “${str("to")}”` : "properties changed";
    case "cascaded":
      return Array.isArray(d.to) ? `sent to ${(d.to as string[]).join(", ")}` : "sent";
    case "accepted":
      return `${str("org")} accepted as-is`;
    case "customised":
      return `${str("org")} accepted and customised — “${str("statement")}”`;
    case "held":
      return `${str("org")} parked — “${str("reason")}”`;
    case "rejected":
      return `${str("org")} declined — “${str("reason")}”`;
    case "completed":
    case "archived":
      return `${str("reason")}${str("note") !== "" ? " — " + str("note") : ""}`;
    case "carriedForward":
      return str("toPeriod") !== "" ? `carried to ${str("toPeriod")}` : `carried from ${str("fromPeriod")}`;
    case "reordered":
      return `moved to position ${String(d.to ?? "")}`;
    default:
      return "";
  }
}
