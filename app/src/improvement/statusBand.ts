// The initiative board's STATUS BAND (2026-09-29): above the cards, always
// in view — the current stage and its gate on the left (with the button
// that applies to the viewer), the latest commentary on the right. It
// collapses to one line, remembered per person. The full stage rail and
// the whole commentary trail stay in the details pane; the band is the
// part nobody should have to open a pane to see. Data in, callbacks out.

import { el } from "../../../shared/ui/dom";
import { dayLabel } from "../linkTitle";
import { renderUpdateBody, updateMeta } from "./commentary";
import { ageLabel, Update, UPDATE_LABELS } from "./commentaryModel";
import type { LastRevert } from "./stageRevert";

const btn = (label: string, cls = "app-btn"): HTMLButtonElement => {
  const b = el("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  return b;
};

export interface BandStage {
  name: string;
  /** 1-based position and the number of stages. */
  position: number;
  count: number;
  /** Every stage's PDCA colour, in order — the progress strip. */
  colours: string[];
  fg: string;
  bg: string;
  /** The current stage's target date (ISO) or "". */
  target: string;
  /** Days past the target, or null when on time / no target. */
  overdueDays: number | null;
}

export interface BandGate {
  /** How the line reads: neutral, waiting on someone, declined. */
  tone: "muted" | "wait" | "no";
  text: string;
  /** Who has decided and who has not (a requested gate). */
  approvals: { label: string; state: "ok" | "no" | "wait" }[];
  actions: { label: string; kind: "primary" | "danger" | "plain"; onClick: () => void }[];
}

export interface BandOpts {
  collapsed: boolean;
  onToggle: () => void;
  /** null = no stages to show (the initiative is complete). */
  stage: BandStage | null;
  /** Actions whose work is done and wait for an endorser. `mine`: the
   *  viewer may endorse — they get Review. */
  endorse?: { count: number; mine: boolean; onReview: () => void } | null;
  /** The revert the initiative still stands on (its latest stage move
   *  was one) — said until it moves forward again. */
  revert?: LastRevert | null;
  completed: boolean;
  gate: BandGate | null;
  /** Opens the details pane at the stage rail. */
  onOpenStages: () => void;
  latest: Update | null;
  updateCount: number;
  today: string;
  /** Days without an update once stale, else null. */
  stale: number | null;
  canComment: boolean;
  onAdd: () => void;
  onEdit: (u: Update) => void;
  /** Opens the details pane at the commentary trail. */
  onAllUpdates: () => void;
}

const stagePill = (o: BandOpts): HTMLElement => {
  if (o.completed || o.stage === null) return el("span", "app-im-stagechip app-sb-pill", "✓ Complete");
  const pill = el("span", "app-im-stagechip app-sb-pill", o.stage.name);
  pill.style.color = o.stage.fg;
  pill.style.background = o.stage.bg;
  return pill;
};

const staleNote = (o: BandOpts): HTMLElement | null => {
  if (o.stale === null || o.completed) return null;
  return el("span", "app-sb-stale", o.latest ? `⚠ No update for ${o.stale} days` : `⚠ No update in ${o.stale} days`);
};

const toggleBtn = (o: BandOpts): HTMLButtonElement => {
  const t = btn(o.collapsed ? "▼" : "▲", "app-btn app-sb-toggle");
  t.title = o.collapsed ? "Show the stage and the latest update" : "Collapse to one line";
  t.setAttribute("aria-label", t.title);
  t.setAttribute("aria-expanded", o.collapsed ? "false" : "true");
  t.addEventListener("click", o.onToggle);
  return t;
};

export function renderStatusBand(o: BandOpts): HTMLElement {
  const band = el("div", "app-sb" + (o.collapsed ? " app-sb-collapsed" : ""));

  if (o.collapsed) {
    // one line: the stage, the gate in words, the latest update's first line
    const line = el("div", "app-sb-oneline");
    line.appendChild(stagePill(o));
    if (o.gate) line.appendChild(el("span", "app-sb-gatetext app-sb-gate-" + o.gate.tone, o.gate.text));
    if (o.endorse && o.endorse.count > 0) line.appendChild(el("span", "app-sb-stale", `◐ ${o.endorse.count} to endorse`));
    line.appendChild(el("span", "app-sb-sep", "·"));
    if (o.latest) {
      const first = UPDATE_LABELS.map(([k, l]) => [l, o.latest![k]] as const).find(([, v]) => v !== "");
      const text = el("span", "app-sb-onetext");
      if (first) text.append(el("span", "app-cm-k", first[0]), el("span", undefined, ` ${first[1]}`));
      line.appendChild(text);
      line.appendChild(el("span", "app-cm-meta", updateMeta(o.latest, o.today)));
    } else {
      line.appendChild(el("span", "app-cp-muted", "No commentary yet"));
    }
    const stale = staleNote(o);
    if (stale) line.appendChild(stale);
    line.appendChild(el("span", "app-bar-gap"));
    line.appendChild(toggleBtn(o));
    band.appendChild(line);
    return band;
  }

  // ---- left: stage and gate ---------------------------------------------------
  const left = el("div", "app-sb-block app-sb-stage");
  const lhead = el("div", "app-sb-head");
  lhead.appendChild(el("span", "app-sb-h", "Stage and gate"));
  lhead.appendChild(el("span", "app-bar-gap"));
  const rail = btn("All stages", "app-cp-ov-link");
  rail.title = "Open the details pane at the stages";
  rail.addEventListener("click", o.onOpenStages);
  lhead.appendChild(rail);
  left.appendChild(lhead);
  const nameRow = el("div", "app-sb-stagerow");
  nameRow.appendChild(stagePill(o));
  if (o.stage && !o.completed) nameRow.appendChild(el("span", "app-sb-of", `Stage ${o.stage.position} of ${o.stage.count}`));
  left.appendChild(nameRow);
  if (o.stage) {
    const strip = el("div", "app-sb-strip");
    strip.setAttribute("role", "img");
    strip.setAttribute("aria-label", o.completed ? "All stages complete" : `Stage ${o.stage.position} of ${o.stage.count}`);
    o.stage.colours.forEach((c, idx) => {
      const seg = el("span", "app-sb-seg");
      const at = idx + 1;
      if (o.completed || at < o.stage!.position) seg.style.background = c;
      else if (at === o.stage!.position) {
        seg.style.background = c;
        seg.classList.add("app-sb-seg-on");
      }
      strip.appendChild(seg);
    });
    left.appendChild(strip);
    if (!o.completed && o.stage.target !== "") {
      const due = el("div", "app-sb-due", `Due ${dayLabel(o.stage.target)}`);
      if (o.stage.overdueDays !== null) {
        due.classList.add("app-sb-due-over");
        due.textContent = `Due ${dayLabel(o.stage.target)} · ${o.stage.overdueDays} day${o.stage.overdueDays === 1 ? "" : "s"} over`;
      }
      left.appendChild(due);
    }
  }
  if (o.revert) {
    const note = el("div", "app-sb-revert", `↩ Reverted from ${o.revert.from} by ${o.revert.who} · ${ageLabel(o.revert.at, o.today)}`);
    if (o.revert.reason !== "") note.title = o.revert.reason;
    left.appendChild(note);
    if (o.revert.reason !== "") left.appendChild(el("div", "app-sb-revertwhy", `“${o.revert.reason}”`));
  }
  if (o.gate) {
    const g = el("div", "app-sb-gate app-sb-gate-" + o.gate.tone);
    g.appendChild(el("div", "app-sb-gatetext", o.gate.text));
    if (o.gate.approvals.length > 0) {
      const row = el("div", "app-sb-apprs");
      for (const a of o.gate.approvals) {
        row.appendChild(el("span", `app-ib-appr app-ib-appr-${a.state}`, `${a.state === "ok" ? "✓" : a.state === "no" ? "✕" : "◐"} ${a.label}`));
      }
      g.appendChild(row);
    }
    if (o.gate.actions.length > 0) {
      const acts = el("div", "app-ib-gatebtns");
      for (const a of o.gate.actions) {
        const b = btn(a.label, "app-btn app-ib-gatebtn" + (a.kind === "primary" ? " app-btn-primary" : a.kind === "danger" ? " app-btn-danger" : ""));
        b.addEventListener("click", a.onClick);
        acts.appendChild(b);
      }
      g.appendChild(acts);
    }
    left.appendChild(g);
  }
  if (o.endorse && o.endorse.count > 0) {
    const e = el("div", "app-sb-endorse");
    e.appendChild(el("span", "app-sb-endorsetext", `◐ ${o.endorse.count} action${o.endorse.count === 1 ? "" : "s"} awaiting endorsement`));
    if (o.endorse.mine) {
      const review = btn("Review", "app-btn app-btn-primary app-ib-gatebtn");
      review.addEventListener("click", o.endorse.onReview);
      e.appendChild(review);
    }
    left.appendChild(e);
  }
  band.appendChild(left);

  // ---- right: the latest update -------------------------------------------------
  const right = el("div", "app-sb-block app-sb-update");
  const rhead = el("div", "app-sb-head");
  rhead.appendChild(el("span", "app-sb-h", "Latest update"));
  if (o.latest) rhead.appendChild(el("span", "app-cm-meta", updateMeta(o.latest, o.today)));
  const stale = staleNote(o);
  if (stale) rhead.appendChild(stale);
  rhead.appendChild(el("span", "app-bar-gap"));
  if (o.canComment) {
    if (o.latest && o.latest.id !== "") {
      const edit = btn("Edit", "app-btn app-sb-btn");
      edit.addEventListener("click", () => o.onEdit(o.latest!));
      rhead.appendChild(edit);
    }
    const add = btn("＋ Add update", "app-btn app-btn-primary app-sb-btn");
    add.addEventListener("click", o.onAdd);
    rhead.appendChild(add);
  }
  rhead.appendChild(toggleBtn(o));
  right.appendChild(rhead);
  if (o.latest) right.appendChild(renderUpdateBody(o.latest, true));
  else right.appendChild(el("div", "app-cp-muted app-sb-none", o.canComment ? "No commentary yet. Add the first update: what went well, what hurt, what happens next." : "No commentary yet."));
  if (o.updateCount > 1) {
    const all = btn(`All updates · ${o.updateCount}`, "app-cp-ov-link app-sb-all");
    all.title = "Open the details pane at the commentary";
    all.addEventListener("click", o.onAllUpdates);
    right.appendChild(all);
  }
  band.appendChild(right);
  return band;
}
