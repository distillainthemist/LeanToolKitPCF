// Cascaded priorities — TV walk mode (design §15: displayed AND walked).
// One objective (sub-pillar column) per step; cascades to accept are one
// extra, final step when any are pending. Navigation uses the card-walk
// grammar: a full-height PREV / NEXT rail either side, the neighbours
// named in the footer, ✕ Exit presentation top right beside the step
// counter, ←/→, swipe, Esc. Every control ≥44px; no hover-only content.
//
// Mounts INTO a host: the Priorities screen gives it a fixed full-screen
// layer; the embedded ritual card's focused editor gives it the card body
// (§8: opens in walk mode at step 1).

import { el, clear } from "../../../shared/ui/dom";
import { initialsFor } from "../../../shared/schema/people";
import { LifecycleCtx, renderReviewList } from "./lifecycle";
import {
  OrgRef,
  orgName,
  parentClosed,
  pendingCascades,
  Pillar,
  Priority,
  ragPaletteKey,
  rollup,
  tally,
  tallyLine,
} from "./model";

export interface WalkOpts {
  host: HTMLElement;
  ctx: LifecycleCtx;
  org: OrgRef;
  period: string;
  /** The objective columns currently visible (filters carry in). */
  columns: Pillar[];
  pillars: Pillar[];
  /** Priorities per column id, in matrix order. */
  byColumn: Map<string, Priority[]>;
  adoptedIds: Set<string>;
  /** A priority's objectives, as the main view's Objectives row paints
   *  them — the same builder, so the two can never disagree. */
  objectiveLines: (p: Priority) => HTMLElement[];
  startStep?: number;
  /** ✕ Exit presentation / Esc — leave the walk. */
  onExit: () => void;
  onOpen: (p: Priority) => void;
  /** Step changed (the screen remembers it across repaints). */
  onStep?: (i: number) => void;
  /** Extra class on the walk root (e.g. "app-cp-walk-fixed"). */
  className?: string;
}

const btn = (label: string, cls = "app-btn"): HTMLButtonElement => {
  const b = el("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  return b;
};

/** Mount the walk; returns a teardown. */
export function mountWalk(o: WalkOpts): () => void {
  const root = el("div", "app-cp-walk" + (o.className ? ` ${o.className}` : ""));
  o.host.appendChild(root);
  const pending = () => pendingCascades(o.org, o.ctx.data().assignments).length;
  const stepCount = () => o.columns.length + (pending() > 0 ? 1 : 0);
  let step = Math.min(Math.max(0, o.startStep ?? 0), Math.max(0, stepCount() - 1));

  const stepTitle = (i: number): string => {
    if (i < o.columns.length) return o.columns[i].name;
    return `Cascades to accept · ${pending()}`;
  };

  const paint = () => {
    clear(root);
    const n = stepCount();
    if (n === 0) {
      root.appendChild(el("div", "app-cp-walk-empty", "Nothing to walk — no objectives are visible with the current filters."));
      const back = btn("✕ Exit presentation");
      back.addEventListener("click", o.onExit);
      root.appendChild(back);
      return;
    }
    if (step >= n) step = n - 1;
    const isReview = step >= o.columns.length;
    const col = isReview ? null : o.columns[step];
    const l1 = col ? o.pillars.find((p) => p.id === col.parentId) : undefined;

    // header strip
    const head = el("div", "app-cp-walk-head");
    const colour = col?.color || l1?.color || "";
    if (colour !== "") head.style.background = colour;
    const titleBox = el("div", "app-cp-walk-titlebox");
    titleBox.appendChild(el("div", "app-cp-walk-title", stepTitle(step)));
    titleBox.appendChild(
      el("div", "app-cp-walk-sub", [l1?.name ?? "", orgName(o.org), o.period].filter((s) => s !== "").join(" · "))
    );
    head.appendChild(titleBox);
    const prog = el("div", "app-cp-walk-progress");
    const dots = el("div", "app-cp-walk-dots");
    for (let i = 0; i < n; i++) {
      const d = btn("", "app-cp-walk-dot" + (i === step ? " app-cp-walk-dot-on" : "") + (i >= o.columns.length ? " app-cp-walk-dot-review" : ""));
      d.title = stepTitle(i);
      d.setAttribute("aria-label", stepTitle(i));
      d.addEventListener("click", () => go(i));
      dots.appendChild(d);
    }
    prog.appendChild(dots);
    prog.appendChild(el("div", "app-cp-walk-count", `${step + 1} / ${n}`));
    // the way out: top right, beside the counter, named for what it does
    // (Ben, 2026-09-29 — "⊞ All pillars" in the footer did not read as it)
    const exit = btn("✕ Exit presentation", "app-btn app-cp-walk-exit");
    exit.title = "Leave the presentation and return to all pillars (Esc)";
    exit.addEventListener("click", o.onExit);
    prog.appendChild(exit);
    head.appendChild(prog);
    root.appendChild(head);

    // the stage: a full-height rail either side of the body — the meeting
    // ritual's card walk grammar (glyph + caption, never a bare chevron)
    const rail = (dir: "prev" | "next"): HTMLButtonElement => {
      const to = dir === "prev" ? step - 1 : step + 1;
      const live = to >= 0 && to < n;
      const b = btn("", "app-cp-walk-rail" + (live ? "" : " app-cp-walk-rail-off"));
      b.appendChild(el("span", "app-cp-walk-rail-glyph", dir === "prev" ? "‹" : "›"));
      b.appendChild(el("span", "app-cp-walk-rail-cap", dir === "prev" ? "PREV" : "NEXT"));
      b.disabled = !live;
      if (live) {
        b.title = stepTitle(to);
        b.setAttribute("aria-label", `${dir === "prev" ? "Previous" : "Next"}: ${stepTitle(to)}`);
        b.addEventListener("click", () => go(to));
      } else {
        b.setAttribute("aria-hidden", "true");
      }
      return b;
    };
    const stage = el("div", "app-cp-walk-stage");

    // body
    const body = el("div", "app-cp-walk-body");
    if (isReview) {
      const list = el("div", "app-cp-review app-cp-walk-review");
      renderReviewList(o.ctx, o.org, list);
      body.appendChild(list);
    } else if (col) {
      const items = o.byColumn.get(col.id) ?? [];
      if (items.length === 0) body.appendChild(el("div", "app-cp-walk-empty", "No priorities in this objective."));
      for (const p of items) body.appendChild(row(p));
    }
    stage.append(rail("prev"), body, rail("next"));
    root.appendChild(stage);

    // footer: where each rail leads
    const foot = el("div", "app-cp-walk-foot");
    const name = (to: number, dir: "prev" | "next"): HTMLElement => {
      if (to < 0 || to >= n) return el("span", "app-cp-walk-nav");
      const b = btn(dir === "prev" ? `‹ ${stepTitle(to)}` : `${stepTitle(to)} ›`, "app-link app-cp-walk-nav app-cp-walk-nav-" + dir);
      b.addEventListener("click", () => go(to));
      return b;
    };
    foot.append(name(step - 1, "prev"), name(step + 1, "next"));
    root.appendChild(foot);
  };

  const row = (p: Priority): HTMLElement => {
    const data = o.ctx.data();
    const rags = o.ctx.ragsFor(p);
    const t = tally(rags);
    const rag = rollup(t, o.ctx.rule(), o.ctx.settings.ragRatioPct);
    const r = el("div", "app-cp-walk-row");
    r.style.borderLeftColor = o.ctx.palette[ragPaletteKey(rag)] ?? "#9a948a";
    const main = el("div", "app-cp-walk-main");
    main.appendChild(el("div", "app-cp-walk-statement", p.statement));
    const owner = el("div", "app-cp-walk-owner");
    owner.appendChild(el("span", "app-cp-dcard-initials app-cp-walk-initials", p.ownerName !== "" ? initialsFor(p.ownerName) : "—"));
    owner.appendChild(el("span", p.ownerName !== "" ? "" : "app-cp-muted", p.ownerName !== "" ? p.ownerName : "No owner"));
    main.appendChild(owner);
    // cascade lineage / sender flags stay in the detail overlay, not on
    // the walk row (Ben, 2026-08-19) — same rule as the matrix cards
    const flags = el("div", "app-cp-walk-flags");
    if (parentClosed(p, data.priorities)) flags.appendChild(el("span", "app-cp-flag app-cp-flag-amber", "▲ Parent completed — decide"));
    if (p.status !== "active") flags.appendChild(el("span", "app-cp-flag", p.status === "completed" ? "✓ Completed" : p.status === "archived" ? "▣ Archived" : "▣ Retired"));
    if (flags.childElementCount > 0) main.appendChild(flags);
    r.appendChild(main);
    // R/A/G as three large single-digit tallies
    const tl = el("div", "app-cp-walk-tallies");
    for (const part of tallyLine(t)) {
      const cell = el("div", "app-cp-walk-tally" + (part.count === 0 ? " app-cp-tally-zero" : ""));
      cell.appendChild(el("div", "app-cp-walk-tally-n", String(part.count)));
      cell.appendChild(el("div", "app-cp-walk-tally-g", part.glyph));
      if (part.count > 0) cell.style.color = o.ctx.palette[ragPaletteKey(part.rag)] ?? "";
      tl.appendChild(cell);
    }
    // the count the main view's card carries beside its tallies
    const tlBox = el("div", "app-cp-walk-tallybox");
    tlBox.appendChild(tl);
    tlBox.appendChild(el("div", "app-cp-walk-total", `${t.total} initiative${t.total === 1 ? "" : "s"}`));
    r.appendChild(tlBox);
    // objectives, divided by a rule: the SAME lines as the main view's
    // Objectives row — every starred metric, plan / actual, its light
    const metric = el("div", "app-cp-walk-metric");
    for (const line of o.objectiveLines(p)) metric.appendChild(line);
    r.appendChild(metric);
    r.addEventListener("click", () => o.onOpen(p));
    return r;
  };

  const go = (i: number) => {
    const n = stepCount();
    if (i < 0 || i >= n) return;
    step = i;
    o.onStep?.(i);
    paint();
  };

  // keyboard: ←/→ step, Esc = all objectives
  const onKey = (e: KeyboardEvent) => {
    if (document.querySelector(".app-modal-overlay, .app-cp-scrim")) return; // a dialog is up
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(step - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      go(step + 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      o.onExit();
    }
  };
  document.addEventListener("keydown", onKey);
  // swipe on touch
  let sx: number | null = null;
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse") return;
    sx = e.clientX;
  };
  const onUp = (e: PointerEvent) => {
    if (sx === null) return;
    const dx = e.clientX - sx;
    sx = null;
    if (Math.abs(dx) < 60) return;
    go(dx < 0 ? step + 1 : step - 1);
  };
  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointerup", onUp);

  paint();
  return () => {
    document.removeEventListener("keydown", onKey);
    root.remove();
  };
}
