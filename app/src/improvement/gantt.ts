// Actions Gantt (design spec §2, P8). ONE component, two scopes:
// "initiative" (stage bands behind the bars, no group rows) and "org"
// (group row per initiative — caret · status edge · name · stage chip ·
// count; collapsed shows one summary bar). Toolbar: scope · assignee ·
// status · window presets 2w/4w/8w/13w · ⋮ (show completed · export CSV).
// Bar states carry a SHAPE as well as a colour (§2.2): on-track solid
// accent · overdue solid red · awaiting-verification hatched amber ·
// completed flat grey; no start date = a diamond on the due date. Editing
// (§2.3): drag moves both dates, edges resize; any due-date move opens
// the reschedule dialog (the ActionBoard's four reasons) and Cancel snaps
// back; the start-only (left-edge) drag never prompts. Touch: tap to
// select, ±1d/±1w steppers + Set dates… — no drag. Dependencies are out
// of scope by design.

import { el, clear } from "../../../shared/ui/dom";
import { LtkAction, ActionHistoryEntry } from "../../../shared/schema/actions";
import { todayIso } from "../../../shared/schema/id";
import { dayLabel } from "../linkTitle";
import { upsertActions } from "../store/actions";
import { modal, field } from "../priorities/dialogs";
import { Initiative } from "./initiativeModel";
import { PDCA_TOKENS } from "./templateModel";

export const RESCHEDULE_REASONS = [
  "Waiting on parts",
  "Resource unavailable",
  "Scope changed",
  "Blocked by another action",
];

export interface GanttOpts {
  host: HTMLElement;
  /** Which scopes the segmented control offers; the first is initial. */
  scopes: { key: "initiative" | "org"; label: string }[];
  /** Initiative scope: the one initiative (stage bands come from it). */
  initiative?: Initiative;
  /** Org scope: every initiative in view (group rows). */
  initiatives: Initiative[];
  actions: LtkAction[];
  /** State palette (ragPaletteKey → colour). */
  palette: Record<string, string>;
  /** Per-initiative RAG for the group rows' status edge. */
  ragFor?: (i: Initiative) => "green" | "amber" | "red" | "grey";
  /** Who may edit (drag / steppers). False = read-only (ritual card). */
  canEdit: boolean;
  actor: { whoId: string; who: string };
  /** Called after a successful date write. */
  onChanged: () => void;
  /** Open an initiative's board (org scope group rows). */
  onOpenBoard?: (boardId: string) => void;
  /** Window centre (yyyy-mm-dd); default today. The ritual card centres
   *  on the meeting's week. */
  centerIso?: string;
  /** Initial window in weeks (2/4/8/13); default 4. */
  windowWeeks?: number;
  /** The host already offers a List/Gantt switch — hide the internal one. */
  hideViewSwitch?: boolean;
}

const PRESETS: { weeks: number; label: string; dayW: number }[] = [
  { weeks: 2, label: "2w", dayW: 44 },
  { weeks: 4, label: "4w", dayW: 24 },
  { weeks: 8, label: "8w", dayW: 13 },
  { weeks: 13, label: "13w", dayW: 9 },
];

const DAY = 86400000;

function parseDay(iso: string): number | null {
  const t = Date.parse(`${iso}T00:00:00`);
  return Number.isFinite(t) ? t : null;
}
function toIso(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function addDays(iso: string, n: number): string {
  const t = parseDay(iso);
  return t === null ? iso : toIso(t + n * DAY);
}

type BarState = "ontrack" | "overdue" | "verify" | "done";

function barState(a: LtkAction, today: string): BarState {
  if (a.status === "done" || a.status === "cancelled") return "done";
  if (a.status === "verify") return "verify";
  if (a.due !== "" && a.due < today) return "overdue";
  return "ontrack";
}

export function mountGantt(opts: GanttOpts): () => void {
  const wrap = el("div", "app-gx");
  opts.host.appendChild(wrap);
  const cleanups: (() => void)[] = [() => wrap.remove()];

  const today = todayIso();
  let scope = opts.scopes[0]?.key ?? "org";
  // Ben, 2026-08-25: every Gantt surface switches to a plain action list
  let view: "gantt" | "list" = "gantt";
  let weeks = PRESETS.some((p) => p.weeks === opts.windowWeeks) ? (opts.windowWeeks as number) : 4;
  let showCompleted = false;
  let assignee = "";
  let status = "";
  const expanded = new Set<string>(); // initiative ids (org scope)
  const uncapped = new Set<string>(); // groups past the 3-row cap
  let selected: string | null = null; // touch selection (action id)

  const accent = getComputedStyle(document.documentElement).getPropertyValue("--app-accent").trim() || "#2563eb";
  const colours = {
    ontrack: accent,
    overdue: opts.palette.issue ?? "#c0392b",
    verify: opts.palette.atrisk ?? "#d9a441",
    done: "#b8b1a5",
  };

  const owns = (i: Initiative, a: LtkAction): boolean =>
    a.initiativeId === i.id || (i.boardId !== "" && a.instanceId.startsWith(`${i.boardId}:`));
  const byInitiative = (i: Initiative): LtkAction[] => opts.actions.filter((a) => owns(i, a));
  const initOf = (a: LtkAction): Initiative | null => opts.initiatives.find((i) => owns(i, a)) ?? null;

  const visibleAction = (a: LtkAction): boolean => {
    if (!showCompleted && (a.status === "done" || a.status === "cancelled")) return false;
    if (status !== "" && barState(a, today) !== status) return false;
    if (assignee !== "" && !a.assignees.some((x) => x.whoId === assignee)) return false;
    return true;
  };

  // ---- date writes ----------------------------------------------------------

  const writeDates = async (a: LtkAction, start: string, due: string, reason: string, note: string) => {
    const next: LtkAction = { ...a, start, due };
    if (due !== a.due) {
      const entry: ActionHistoryEntry = {
        kind: "rescheduled",
        whoId: opts.actor.whoId,
        who: opts.actor.who,
        when: new Date().toISOString(),
        from: a.due,
        to: due,
        reason: note !== "" ? `${reason} — ${note}` : reason,
      };
      next.history = [...(a.history ?? []), entry];
    }
    await upsertActions([next]);
    const local = opts.actions.find((x) => x.id === a.id);
    if (local) {
      local.start = start;
      local.due = due;
      local.history = next.history;
    }
    opts.onChanged();
  };

  /** The §2.3 dialog. Resolves true = moved, false = cancelled. */
  const rescheduleDialog = (a: LtkAction, start: string, due: string): Promise<boolean> =>
    new Promise((resolve) => {
      const m = modal(opts.host, `Move due date to ${dayLabel(due)}?`, undefined);
      const prev = el("div", "app-gx-dlgprev");
      const wasOverdue = a.due !== "" && a.due < today;
      prev.textContent = a.due !== "" ? `Was ${dayLabel(a.due)}${wasOverdue ? " — overdue" : ""}` : "No due date was set";
      if (wasOverdue) prev.style.color = colours.overdue;
      m.body.appendChild(prev);
      const sel = el("select", "app-input") as HTMLSelectElement;
      for (const r of RESCHEDULE_REASONS) {
        const o = el("option", "", r) as HTMLOptionElement;
        o.value = r;
        sel.appendChild(o);
      }
      m.body.appendChild(field("Why is this moving?", sel));
      const note = el("input", "app-input") as HTMLInputElement;
      note.placeholder = "Optional note";
      m.body.appendChild(field("Note", note));
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        clearInterval(watch);
        m.close();
        resolve(ok);
      };
      // Escape / overlay-click close the modal without our buttons — watch
      // for removal so the promise still resolves (and the bar snaps back)
      const watch = setInterval(() => {
        if (!m.overlay.isConnected) finish(false);
      }, 300);
      const cancel = el("button", "app-btn", "Cancel") as HTMLButtonElement;
      cancel.type = "button";
      cancel.addEventListener("click", () => finish(false));
      const go = el("button", "app-btn app-btn-primary", "Move date") as HTMLButtonElement;
      go.type = "button";
      go.addEventListener("click", () => {
        void writeDates(a, start, due, sel.value, note.value.trim()).then(() => finish(true));
      });
      m.footer.append(cancel, go);
    });

  /** A move settles: start-only writes silently, a due change prompts. */
  const settle = async (a: LtkAction, start: string, due: string): Promise<boolean> => {
    if (due === a.due) {
      if (start !== a.start) await writeDates(a, start, due, "", "");
      return true;
    }
    return rescheduleDialog(a, start, due);
  };

  const setDatesDialog = (a: LtkAction) => {
    const m = modal(opts.host, "Set dates", undefined);
    const s = el("input", "app-input") as HTMLInputElement;
    s.type = "date";
    s.value = a.start;
    const d = el("input", "app-input") as HTMLInputElement;
    d.type = "date";
    d.value = a.due;
    m.body.appendChild(field("Start", s));
    m.body.appendChild(field("Due", d));
    const cancel = el("button", "app-btn", "Cancel") as HTMLButtonElement;
    cancel.type = "button";
    cancel.addEventListener("click", () => m.close());
    const go = el("button", "app-btn app-btn-primary", "Save") as HTMLButtonElement;
    go.type = "button";
    go.addEventListener("click", () => {
      m.close();
      void settle(a, s.value, d.value).then(() => render());
    });
    m.footer.append(cancel, go);
  };

  // ---- rendering ------------------------------------------------------------

  const render = () => {
    clear(wrap);
    const preset = PRESETS.find((p) => p.weeks === weeks) ?? PRESETS[1];
    const days = weeks * 7;
    const centre = parseDay(opts.centerIso ?? today) ?? (parseDay(today) as number);
    const t0 = centre - Math.floor(days / 2) * DAY;
    const startIso = toIso(t0);
    const dayW = preset.dayW;
    const width = days * dayW;
    const xOf = (iso: string): number | null => {
      const t = parseDay(iso);
      return t === null ? null : Math.round(((t - t0) / DAY) * dayW);
    };

    // toolbar
    const bar = el("div", "app-gx-bar");
    if (!opts.hideViewSwitch) {
      const viewSeg = el("div", "app-docs-seg");
      for (const [v, l] of [["list", "List"], ["gantt", "Gantt"]] as const) {
        const b = el("button", "app-docs-segbtn" + (view === v ? " app-docs-segbtn-on" : ""), l) as HTMLButtonElement;
        b.type = "button";
        b.addEventListener("click", () => {
          view = v;
          render();
        });
        viewSeg.appendChild(b);
      }
      bar.appendChild(viewSeg);
    }
    if (opts.scopes.length > 1) {
      const seg = el("div", "app-docs-seg");
      for (const sc of opts.scopes) {
        const b = el("button", "app-docs-segbtn" + (scope === sc.key ? " app-docs-segbtn-on" : ""), sc.label) as HTMLButtonElement;
        b.type = "button";
        b.addEventListener("click", () => {
          scope = sc.key;
          render();
        });
        seg.appendChild(b);
      }
      bar.appendChild(seg);
    }
    if (scope === "org") {
      const people = new Map<string, string>();
      for (const a of opts.actions) for (const x of a.assignees) if (x.whoId !== "") people.set(x.whoId, x.who);
      if (people.size > 0) {
        const sel = el("select", "app-input app-gx-sel") as HTMLSelectElement;
        const all = el("option", "", "All assignees") as HTMLOptionElement;
        all.value = "";
        sel.appendChild(all);
        for (const [id, name] of [...people.entries()].sort((a, b) => a[1].localeCompare(b[1]))) {
          const o = el("option", "", name) as HTMLOptionElement;
          o.value = id;
          if (id === assignee) o.selected = true;
          sel.appendChild(o);
        }
        sel.addEventListener("change", () => {
          assignee = sel.value;
          render();
        });
        bar.appendChild(sel);
      }
      const st = el("select", "app-input app-gx-sel") as HTMLSelectElement;
      for (const [v, l] of [["", "All states"], ["ontrack", "On track"], ["overdue", "Overdue"], ["verify", "Awaiting verification"]] as const) {
        const o = el("option", "", l) as HTMLOptionElement;
        o.value = v;
        if (v === status) o.selected = true;
        st.appendChild(o);
      }
      st.addEventListener("change", () => {
        status = st.value;
        render();
      });
      bar.appendChild(st);
    }
    bar.appendChild(el("span", "app-bar-gap"));
    if (view === "gantt") {
      const win = el("div", "app-docs-seg");
      for (const p of PRESETS) {
        const b = el("button", "app-docs-segbtn" + (weeks === p.weeks ? " app-docs-segbtn-on" : ""), p.label) as HTMLButtonElement;
        b.type = "button";
        b.addEventListener("click", () => {
          weeks = p.weeks;
          render();
        });
        win.appendChild(b);
      }
      bar.appendChild(win);
    }
    const more = el("button", "app-btn app-gx-more", "⋮") as HTMLButtonElement;
    more.type = "button";
    more.title = "Show completed · export";
    more.addEventListener("click", () => {
      const menu = el("div", "app-cp-menu");
      const item = (label: string, run: () => void) => {
        const b = el("button", "app-cp-menu-item", label) as HTMLButtonElement;
        b.type = "button";
        b.addEventListener("click", () => {
          menu.remove();
          run();
        });
        menu.appendChild(b);
      };
      item(showCompleted ? "● Show completed" : "○ Show completed", () => {
        showCompleted = !showCompleted;
        render();
      });
      item("Export CSV", () => exportCsv());
      const r = more.getBoundingClientRect();
      menu.style.top = `${r.bottom + 4}px`;
      menu.style.left = `${Math.min(r.left, window.innerWidth - 240)}px`;
      document.body.appendChild(menu);
      const off = (e: PointerEvent) => {
        if (!menu.contains(e.target as Node)) {
          menu.remove();
          document.removeEventListener("pointerdown", off, true);
        }
      };
      setTimeout(() => document.addEventListener("pointerdown", off, true), 0);
      cleanups.push(() => menu.remove());
    });
    bar.appendChild(more);
    wrap.appendChild(bar);

    if (view === "list") {
      const listBox = el("div", "app-gx-list");
      const stateChip = (a: LtkAction): HTMLElement => {
        const st = barState(a, today);
        const chip = el("span", "app-gx-statechip", st === "ontrack" ? "On track" : st === "overdue" ? "Overdue" : st === "verify" ? "Awaiting verification" : "Done");
        const c = colours[st];
        chip.style.color = c;
        chip.style.background = `color-mix(in srgb, ${c} 14%, white)`;
        return chip;
      };
      const listRow = (a: LtkAction): HTMLElement => {
        const r = el("div", "app-gx-listrow");
        const main = el("div", "app-gx-listmain");
        main.appendChild(el("div", "app-gx-label-title", a.issue || a.description.slice(0, 80) || "(untitled)"));
        const who = a.assignees.map((x) => x.who).filter((x) => x !== "").join(", ");
        main.appendChild(el("div", "app-gx-label-meta", [who].filter((x) => x !== "").join(" · ")));
        r.appendChild(main);
        const dates = el("div", "app-gx-listdates");
        const dueTxt = a.due !== "" ? dayLabel(a.due) : "no due date";
        dates.textContent = a.start !== "" ? `${dayLabel(a.start)} → ${dueTxt}` : dueTxt;
        if (barState(a, today) === "overdue") {
          dates.style.color = colours.overdue;
          dates.style.fontWeight = "600";
        }
        r.appendChild(dates);
        r.appendChild(stateChip(a));
        if (opts.canEdit && a.status !== "done" && a.status !== "cancelled") {
          r.classList.add("app-gx-listrow-edit");
          r.title = "Set dates";
          r.addEventListener("click", () => setDatesDialog(a));
        }
        return r;
      };
      const sortRows = (rows: LtkAction[]) => rows.sort((a, b) => ((a.due || "9999") < (b.due || "9999") ? -1 : 1));
      if (scope === "initiative" && opts.initiative) {
        const rows = sortRows(byInitiative(opts.initiative).filter(visibleAction));
        if (rows.length === 0) listBox.appendChild(el("div", "app-gx-empty", "No actions on this initiative yet. Add one from the Action plan card."));
        for (const a of rows) listBox.appendChild(listRow(a));
      } else {
        const groups = opts.initiatives
          .map((i) => ({ i, rows: sortRows(byInitiative(i).filter(visibleAction)) }))
          .filter((g) => g.rows.length > 0);
        if (groups.length === 0) listBox.appendChild(el("div", "app-gx-empty", "No open actions."));
        for (const g of groups) {
          listBox.appendChild(el("div", "app-gx-listgroup", `${g.i.title} · ${g.rows.length}`));
          for (const a of g.rows) listBox.appendChild(listRow(a));
        }
      }
      wrap.appendChild(listBox);
      return;
    }

    // the scrolling stage: fixed 300px label column, timeline under it
    const stage = el("div", "app-gx-stage");
    wrap.appendChild(stage);
    const grid = el("div", "app-gx-grid");
    stage.appendChild(grid);

    const headRow = () => {
      const r = el("div", "app-gx-row app-gx-headrow");
      r.appendChild(el("div", "app-gx-label app-gx-headlabel", ""));
      const tl = el("div", "app-gx-tl");
      tl.style.width = `${width}px`;
      for (let d = 0; d < days; d++) {
        const t = t0 + d * DAY;
        const dt = new Date(t);
        if (dt.getDay() === 1) {
          const wk = el("div", "app-gx-week", dayLabel(toIso(t)));
          wk.style.left = `${d * dayW}px`;
          tl.appendChild(wk);
        }
        if (dt.getDay() === 6 || dt.getDay() === 0) {
          const we = el("div", "app-gx-weekend");
          we.style.left = `${d * dayW}px`;
          we.style.width = `${dayW}px`;
          tl.appendChild(we);
        }
      }
      r.appendChild(tl);
      return r;
    };
    grid.appendChild(headRow());

    /** Shared per-row timeline scaffold: weekend tint + today line. */
    const timelineCell = (): HTMLElement => {
      const tl = el("div", "app-gx-tl");
      tl.style.width = `${width}px`;
      for (let d = 0; d < days; d++) {
        const dt = new Date(t0 + d * DAY);
        if (dt.getDay() === 6 || dt.getDay() === 0) {
          const we = el("div", "app-gx-weekend");
          we.style.left = `${d * dayW}px`;
          we.style.width = `${dayW}px`;
          tl.appendChild(we);
        }
      }
      const tx = xOf(today);
      if (tx !== null && tx >= 0 && tx <= width) {
        const line = el("div", "app-gx-today");
        line.style.left = `${tx}px`;
        tl.appendChild(line);
      }
      return tl;
    };

    // stage bands (initiative scope): translucent PDCA rails from the
    // previous stage's target to this stage's, labelled with the target
    const stageBands = (tl: HTMLElement, i: Initiative) => {
      let prev = "";
      for (const st of i.snapshot.stages) {
        const target = i.stageTargets[st.id] ?? "";
        if (target === "") continue;
        const x1 = prev !== "" ? (xOf(addDays(prev, 1)) ?? 0) : 0;
        const x2 = xOf(target);
        prev = target;
        if (x2 === null || x2 < 0 || x1 > width) continue;
        const band = el("div", "app-gx-band");
        band.style.left = `${Math.max(0, x1)}px`;
        band.style.width = `${Math.min(width, x2 + dayW) - Math.max(0, x1)}px`;
        band.style.background = `color-mix(in srgb, ${PDCA_TOKENS[st.pdca].fg} 9%, transparent)`;
        const lab = el("span", "app-gx-band-label", `${st.name} · ${dayLabel(target)}`);
        lab.style.color = PDCA_TOKENS[st.pdca].fg;
        band.appendChild(lab);
        tl.appendChild(band);
      }
    };

    const actionRow = (a: LtkAction): HTMLElement => {
      const r = el("div", "app-gx-row");
      const label = el("div", "app-gx-label");
      const t = el("div", "app-gx-label-title", a.issue || a.description.slice(0, 60) || "(untitled)");
      t.title = a.issue;
      label.appendChild(t);
      const who = a.assignees.map((x) => x.who).filter((x) => x !== "").join(", ");
      label.appendChild(el("div", "app-gx-label-meta", [who, a.due !== "" ? `due ${dayLabel(a.due)}` : "no due date"].filter((x) => x !== "").join(" · ")));
      r.appendChild(label);
      const tl = timelineCell();
      r.appendChild(tl);

      const state = barState(a, today);
      const col = colours[state];
      if (a.due === "") return r; // nothing to place
      if (a.start === "") {
        // §2.2: no start date → a diamond on the due date
        const x = xOf(a.due);
        if (x !== null && x >= -dayW && x <= width) {
          const dia = el("div", "app-gx-diamond");
          dia.style.left = `${x + dayW / 2}px`;
          dia.style.background = col;
          dia.title = `${a.issue} — no start date. Set one to show this as a bar.`;
          if (opts.canEdit) {
            dia.style.cursor = "pointer";
            dia.addEventListener("click", () => setDatesDialog(a));
          }
          tl.appendChild(dia);
        }
        return r;
      }
      const x1 = xOf(a.start);
      const x2 = xOf(a.due);
      if (x1 === null || x2 === null) return r;
      if (x2 < 0 || x1 > width) return r;
      const barEl = el("div", "app-gx-actionbar" + (selected === a.id ? " app-gx-bar-sel" : ""));
      const left = Math.max(-4, x1);
      barEl.style.left = `${left}px`;
      barEl.style.width = `${Math.max(dayW, Math.min(width + 4, x2 + dayW) - left)}px`;
      if (state === "verify") {
        barEl.style.background = `repeating-linear-gradient(45deg, ${col}, ${col} 5px, color-mix(in srgb, ${col} 45%, white) 5px, color-mix(in srgb, ${col} 45%, white) 10px)`;
      } else barEl.style.background = col;
      if (state === "done") barEl.style.opacity = "0.55";
      barEl.title = `${a.issue}\n${dayLabel(a.start)} → ${dayLabel(a.due)}`;
      tl.appendChild(barEl);

      if (opts.canEdit && state !== "done") wireDrag(barEl, a, dayW);
      if (selected === a.id && opts.canEdit) {
        const tools = el("div", "app-gx-steppers");
        const step = (label2: string, n: number) => {
          const b = el("button", "app-btn app-gx-step", label2) as HTMLButtonElement;
          b.type = "button";
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            void settle(a, a.start !== "" ? addDays(a.start, n) : a.start, addDays(a.due, n)).then(() => render());
          });
          tools.appendChild(b);
        };
        step("−1w", -7);
        step("−1d", -1);
        step("+1d", 1);
        step("+1w", 7);
        const set = el("button", "app-btn app-gx-step", "Set dates…") as HTMLButtonElement;
        set.type = "button";
        set.addEventListener("click", (e) => {
          e.stopPropagation();
          setDatesDialog(a);
        });
        tools.appendChild(set);
        tools.style.left = `${Math.max(0, left)}px`;
        tl.appendChild(tools);
      }
      return r;
    };

    // ---- drag (desktop pointers only; touch selects) ----
    function wireDrag(barEl: HTMLElement, a: LtkAction, dw: number) {
      barEl.addEventListener("pointerdown", (e: PointerEvent) => {
        if (e.pointerType === "touch") {
          selected = selected === a.id ? null : a.id;
          render();
          return;
        }
        e.preventDefault();
        const rect = barEl.getBoundingClientRect();
        const edge = e.clientX - rect.left < 8 ? "start" : rect.right - e.clientX < 8 ? "due" : "both";
        const fromX = e.clientX;
        let dDays = 0;
        const origLeft = parseFloat(barEl.style.left);
        const origW = parseFloat(barEl.style.width);
        const move = (ev: PointerEvent) => {
          dDays = Math.round((ev.clientX - fromX) / dw);
          if (edge === "both") barEl.style.left = `${origLeft + dDays * dw}px`;
          else if (edge === "due") barEl.style.width = `${Math.max(dw, origW + dDays * dw)}px`;
          else {
            barEl.style.left = `${origLeft + dDays * dw}px`;
            barEl.style.width = `${Math.max(dw, origW - dDays * dw)}px`;
          }
        };
        const up = () => {
          document.removeEventListener("pointermove", move);
          document.removeEventListener("pointerup", up);
          if (dDays === 0) return;
          const start = edge === "due" ? a.start : addDays(a.start, dDays);
          const due = edge === "start" ? a.due : addDays(a.due, dDays);
          if (edge === "start" && start > a.due) {
            render(); // snap back — a start can't pass the due date
            return;
          }
          void settle(a, start, due).then(() => render());
        };
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", up);
      });
      barEl.addEventListener("mousemove", (e: MouseEvent) => {
        const rect = barEl.getBoundingClientRect();
        barEl.style.cursor = e.clientX - rect.left < 8 || rect.right - e.clientX < 8 ? "ew-resize" : "grab";
      });
    }

    // ---- body ----
    if (scope === "initiative" && opts.initiative) {
      const i = opts.initiative;
      const rows = byInitiative(i).filter(visibleAction).sort((a, b) => (a.due || "9999") < (b.due || "9999") ? -1 : 1);
      const bandsRow = el("div", "app-gx-row app-gx-bandsrow");
      bandsRow.appendChild(el("div", "app-gx-label app-gx-label-quiet", "Stages"));
      const btl = timelineCell();
      stageBands(btl, i);
      bandsRow.appendChild(btl);
      if (Object.keys(i.stageTargets).length > 0) grid.appendChild(bandsRow);
      if (rows.length === 0) {
        grid.appendChild(el("div", "app-gx-empty", "No actions on this initiative yet. Add one from the Action plan card."));
      }
      for (const a of rows) grid.appendChild(actionRow(a));
    } else {
      // org scope: a group per initiative
      const groups = opts.initiatives
        .map((i) => ({ i, rows: byInitiative(i).filter(visibleAction).sort((a, b) => ((a.due || "9999") < (b.due || "9999") ? -1 : 1)) }))
        .filter((g) => g.rows.length > 0);
      if (groups.length === 0) {
        grid.appendChild(el("div", "app-gx-empty", "No open actions in this window. Try 8 or 13 weeks."));
      }
      for (const g of groups) {
        const open = expanded.has(g.i.id);
        const gr = el("div", "app-gx-row app-gx-grouprow");
        const label = el("div", "app-gx-label app-gx-grouplabel");
        const rag = opts.ragFor?.(g.i) ?? "grey";
        label.style.borderLeft = `3px solid ${opts.palette[rag === "green" ? "good" : rag === "amber" ? "atrisk" : rag === "red" ? "issue" : "neutral"] ?? "#9a948a"}`;
        const caret = el("span", "app-gx-caret", open ? "▾" : "▸");
        label.append(caret, el("span", "app-gx-group-name", g.i.title));
        const st = g.i.snapshot.stages.find((s) => s.id === g.i.stageId);
        if (st) {
          const chip = el("span", "app-im-stagechip", st.name);
          chip.style.color = PDCA_TOKENS[st.pdca].fg;
          chip.style.background = PDCA_TOKENS[st.pdca].bg;
          label.appendChild(chip);
        }
        label.appendChild(el("span", "app-gx-group-count", `· ${g.rows.length}`));
        label.style.cursor = "pointer";
        label.addEventListener("click", () => {
          if (open) expanded.delete(g.i.id);
          else expanded.add(g.i.id);
          render();
        });
        gr.appendChild(label);
        const tl = timelineCell();
        if (!open) {
          // collapsed: one summary bar spanning the group's actions
          const starts = g.rows.map((a) => a.start || a.due).filter((d) => d !== "");
          const dues = g.rows.map((a) => a.due).filter((d) => d !== "");
          if (starts.length > 0 && dues.length > 0) {
            const x1 = xOf(starts.reduce((m, d) => (d < m ? d : m)));
            const x2 = xOf(dues.reduce((m, d) => (d > m ? d : m)));
            if (x1 !== null && x2 !== null && x2 >= 0 && x1 <= width) {
              const sum = el("div", "app-gx-summary");
              const left = Math.max(-4, x1);
              sum.style.left = `${left}px`;
              sum.style.width = `${Math.max(dayW, Math.min(width + 4, x2 + dayW) - left)}px`;
              const worst = g.rows.map((a) => barState(a, today));
              sum.style.background = worst.includes("overdue") ? colours.overdue : worst.includes("verify") ? colours.verify : colours.ontrack;
              tl.appendChild(sum);
            }
          }
        }
        gr.appendChild(tl);
        grid.appendChild(gr);
        if (open) {
          const cap = uncapped.has(g.i.id) ? g.rows.length : 3;
          for (const a of g.rows.slice(0, cap)) grid.appendChild(actionRow(a));
          if (g.rows.length > cap) {
            const moreRow = el("div", "app-gx-row");
            const l = el("div", "app-gx-label");
            const b = el("button", "app-link app-gx-more-link", `${g.rows.length - cap} more ›`) as HTMLButtonElement;
            b.type = "button";
            b.title = g.i.boardId !== "" ? "Show all — or open the initiative board" : "Show all";
            b.addEventListener("click", () => {
              uncapped.add(g.i.id);
              render();
            });
            l.appendChild(b);
            if (opts.onOpenBoard && g.i.boardId !== "") {
              const ob = el("button", "app-link app-gx-more-link", "Open board ›") as HTMLButtonElement;
              ob.type = "button";
              ob.addEventListener("click", () => opts.onOpenBoard?.(g.i.boardId));
              l.appendChild(ob);
            }
            moreRow.appendChild(l);
            moreRow.appendChild(timelineCell());
            grid.appendChild(moreRow);
          }
        }
      }
    }

    // legend (§2.2)
    const legend = el("div", "app-gx-legend");
    const key = (label: string, paint: (sw: HTMLElement) => void) => {
      const k = el("span", "app-gx-key");
      const sw = el("span", "app-gx-swatch");
      paint(sw);
      k.append(sw, el("span", undefined, label));
      legend.appendChild(k);
    };
    key("On track", (sw) => (sw.style.background = colours.ontrack));
    key("Overdue", (sw) => (sw.style.background = colours.overdue));
    key("Awaiting verification", (sw) => {
      sw.style.background = `repeating-linear-gradient(45deg, ${colours.verify}, ${colours.verify} 3px, color-mix(in srgb, ${colours.verify} 45%, white) 3px, color-mix(in srgb, ${colours.verify} 45%, white) 6px)`;
    });
    key("Completed", (sw) => {
      sw.style.background = colours.done;
      sw.style.opacity = "0.55";
    });
    key("No start date", (sw) => {
      sw.classList.add("app-gx-swatch-diamond");
      sw.style.background = colours.ontrack;
    });
    legend.appendChild(el("span", "app-gx-window", `${dayLabel(startIso)} – ${dayLabel(toIso(t0 + (days - 1) * DAY))}`));
    wrap.appendChild(legend);
  };

  const exportCsv = () => {
    const rows: string[][] = [["Initiative", "Action", "Assignees", "Start", "Due", "State"]];
    for (const a of opts.actions.filter(visibleAction)) {
      const i = initOf(a);
      rows.push([i?.title ?? "", a.issue, a.assignees.map((x) => x.who).join("; "), a.start, a.due, barState(a, today)]);
    }
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "actions-gantt.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  render();
  return () => {
    for (const fn of cleanups) fn();
  };
}
