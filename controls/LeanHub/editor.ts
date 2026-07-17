// The LeanHub view — a person's home in three tabs.
//
// Calendar: day/week grid, meetings projected by the shared recurrence
// engine and scoped to a person (crew-aware), area, department or site;
// protected time zones render as coloured background bands behind the
// chips. Tapping an occurrence hands it (with boardId) to the wrapper.
// Actions: the viewer's actions from every source, grouped and due-ordered,
// with a my-part-done toggle riding the standard actions channel.
// Settings: view preferences, plus the protected-time editor for site
// admins (canEditSite).

import { applyThemeVars, defaultTheme, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import { parsePrompts, Prompts, renderGhost, renderTitleBar } from "../../shared/ui/chrome";
import { isOverdue, LtkAction } from "../../shared/schema/actions";
import { Person } from "../../shared/schema/people";
import { DAY_LABELS, MONTH_LABELS, isoLocal, startOfDay } from "../../shared/schema/recurrence";
import { OrgSite } from "../../shared/schema/meeting";
import {
  defaultPrefs,
  deriveOrgTree,
  HubInstance,
  HubMeeting,
  HubPrefs,
  instanceForPerson,
  meetingMatchesOrg,
  OrgScope,
  projectInstances,
  ProtectedTime,
  ScopeKind,
  timeToMinutes,
} from "./types";
import { LEANHUB_CSS } from "./styles";

export interface LeanHubCallbacks {
  onSelectMeeting: (inst: HubInstance) => void;
  onActions: (actions: LtkAction[]) => void;
  onPrefs: (prefs: HubPrefs) => void;
  onProtected: (times: ProtectedTime[]) => void;
}

type Tab = "calendar" | "actions" | "settings";

const HOUR_PX = 44;
const CHIP_H = 38;
const DAY_MS = 24 * 60 * 60 * 1000;

export class LeanHubView {
  private readonly root: HTMLElement;
  private meetings: HubMeeting[] = [];
  private protectedTimes: ProtectedTime[] = [];
  private prefs: HubPrefs = defaultPrefs();
  private people: Person[] = [];
  private viewerId = "";
  private actions: LtkAction[] = [];
  private sourceLabels: Record<string, string> = {};
  private canEditSite = false;
  private theme: Theme = defaultTheme();
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  private readOnly = false;

  private tab: Tab = "calendar";
  private anchor: Date = startOfDay(new Date());
  private scopeKind: ScopeKind = "person";
  private scopePerson = "";
  private scopeOrg: OrgScope = { site: "", department: "", area: "" };
  private scopeTouched = false;
  private view: "day" | "week" = "week";
  /** Supplied org tree; empty = derive from the meetings at render. */
  private orgTree: OrgSite[] = [];

  constructor(
    host: HTMLElement,
    private readonly cb: LeanHubCallbacks
  ) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-leanhub-css", LEANHUB_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.render();
  }

  // ---- host-facing API ----

  setMeetings(meetings: HubMeeting[]): void {
    if (JSON.stringify(meetings) === JSON.stringify(this.meetings)) return;
    this.meetings = meetings;
    this.render();
  }

  setProtectedTimes(times: ProtectedTime[]): void {
    if (JSON.stringify(times) === JSON.stringify(this.protectedTimes)) return;
    this.protectedTimes = times;
    this.render();
  }

  setPrefs(prefs: HubPrefs): void {
    if (JSON.stringify(prefs) === JSON.stringify(this.prefs)) return;
    this.prefs = prefs;
    if (!this.scopeTouched) {
      this.scopeKind = prefs.scopeKind;
      this.scopePerson = prefs.person;
      this.scopeOrg = { ...prefs.org };
      this.view = prefs.view;
    }
    this.render();
  }

  setOrgTree(tree: OrgSite[]): void {
    if (JSON.stringify(tree) === JSON.stringify(this.orgTree)) return;
    this.orgTree = tree;
    this.render();
  }

  setPeople(people: Person[], viewerId: string): void {
    if (
      JSON.stringify(people) === JSON.stringify(this.people) &&
      viewerId === this.viewerId
    ) {
      return;
    }
    this.people = people;
    this.viewerId = viewerId;
    // person scope defaults to the signed-in viewer until the user picks
    if (
      !this.scopeTouched &&
      this.scopeKind === "person" &&
      this.scopePerson === "" &&
      viewerId !== ""
    ) {
      this.scopePerson = viewerId;
    }
    this.render();
  }

  setActions(actions: LtkAction[]): void {
    if (JSON.stringify(actions) === JSON.stringify(this.actions)) return;
    this.actions = actions;
    this.render();
  }

  setSourceLabels(labels: Record<string, string>): void {
    if (JSON.stringify(labels) === JSON.stringify(this.sourceLabels)) return;
    this.sourceLabels = labels;
    this.render();
  }

  setCanEditSite(on: boolean): void {
    if (this.canEditSite !== on) {
      this.canEditSite = on;
      this.render();
    }
  }

  setTheme(theme: Theme): void {
    if (JSON.stringify(theme) === JSON.stringify(this.theme)) return;
    this.theme = theme;
    this.render();
  }

  setChrome(cardTitle: string, promptsRaw: string): void {
    if (cardTitle === this.cardTitle && promptsRaw === this.lastPromptsRaw) return;
    this.cardTitle = cardTitle;
    this.lastPromptsRaw = promptsRaw;
    this.prompts = parsePrompts(promptsRaw);
    this.render();
  }

  setReadOnly(ro: boolean): void {
    if (this.readOnly !== ro) {
      this.readOnly = ro;
      this.render();
    }
  }

  destroy(): void {
    this.root.remove();
  }

  // ---- shell ----

  private render(): void {
    clear(this.root);
    applyThemeVars(this.root, this.theme);
    renderTitleBar(this.root, this.cardTitle, this.prompts);

    const tabs = el("div", "ltk-lh-tabs");
    const defs: { key: Tab; label: string }[] = [
      { key: "calendar", label: "Cadence" },
      { key: "actions", label: "Actions" },
      { key: "settings", label: "Settings" },
    ];
    for (const t of defs) {
      const btn = el("button", "ltk-lh-tab", t.label) as HTMLButtonElement;
      btn.type = "button";
      if (t.key === this.tab) btn.classList.add("ltk-lh-tab-on");
      btn.addEventListener("click", () => {
        this.tab = t.key;
        this.render();
      });
      tabs.appendChild(btn);
    }
    this.root.appendChild(tabs);

    const body = el("div", "ltk-lh-body");
    this.root.appendChild(body);
    if (this.tab === "calendar") this.renderCalendar(body);
    else if (this.tab === "actions") this.renderActions(body);
    else this.renderSettings(body);
  }

  // ---- calendar ----

  private visibleDays(): Date[] {
    if (this.view === "day") return [new Date(this.anchor.getTime())];
    const dow = this.anchor.getDay();
    const offset = (dow - this.prefs.weekStart + 7) % 7;
    const start = new Date(this.anchor.getTime() - offset * DAY_MS);
    return Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * DAY_MS));
  }

  private renderCalendar(body: HTMLElement): void {
    const days = this.visibleDays();
    const from = days[0];
    const to = days[days.length - 1];

    // toolbar: scope + view + navigation
    const bar = el("div", "ltk-lh-bar");
    bar.appendChild(
      this.select(
        this.scopeKind,
        [
          { value: "person", label: "Person" },
          { value: "org", label: "Organisation" },
        ],
        (v) => {
          this.scopeKind = v as ScopeKind;
          this.scopeTouched = true;
          if (this.scopeKind === "person" && this.scopePerson === "") {
            this.scopePerson = this.viewerId;
          }
          if (this.scopeKind === "org" && this.scopeOrg.site === "") {
            this.scopeOrg = { ...this.prefs.org };
          }
          this.render();
        }
      )
    );

    if (this.scopeKind === "person") {
      bar.appendChild(
        this.select(
          this.scopePerson,
          [
            { value: "", label: "Everyone" },
            ...this.people.map((p) => ({
              value: p.whoId,
              label: p.whoId === this.viewerId ? `${p.who} (me)` : p.who,
            })),
          ],
          (v) => {
            this.scopePerson = v;
            this.scopeTouched = true;
            this.render();
          }
        )
      );
    } else {
      for (const sel of this.orgCascade(this.scopeOrg, () => {
        this.scopeTouched = true;
        this.render();
      })) {
        bar.appendChild(sel);
      }
    }

    const viewBtn = el(
      "button",
      "ltk-lh-btn",
      this.view === "week" ? "Day view" : "Week view"
    ) as HTMLButtonElement;
    viewBtn.type = "button";
    viewBtn.addEventListener("click", () => {
      this.view = this.view === "week" ? "day" : "week";
      this.render();
    });
    bar.appendChild(viewBtn);

    bar.appendChild(el("span", "ltk-lh-bar-gap"));
    const nav = (label: string, deltaDays: number | null) => {
      const b = el("button", "ltk-lh-btn", label) as HTMLButtonElement;
      b.type = "button";
      b.addEventListener("click", () => {
        this.anchor =
          deltaDays === null
            ? startOfDay(new Date())
            : new Date(this.anchor.getTime() + deltaDays * DAY_MS);
        this.render();
      });
      return b;
    };
    const step = this.view === "week" ? 7 : 1;
    bar.append(nav("‹", -step), nav("Today", null), nav("›", step));
    const range =
      this.view === "week"
        ? `${from.getDate()} ${MONTH_LABELS[from.getMonth()]} – ${to.getDate()} ${MONTH_LABELS[to.getMonth()]}`
        : `${DAY_LABELS[from.getDay()]} ${from.getDate()} ${MONTH_LABELS[from.getMonth()]}`;
    bar.appendChild(el("span", "ltk-lh-range", range));
    body.appendChild(bar);

    if (this.meetings.length === 0) {
      renderGhost(body, [
        "No meetings supplied",
        "Bind meetingsJSON to the boards' scheduler settings.",
      ]);
      return;
    }

    // project + scope-filter the window's occurrences
    const byId = new Map(this.meetings.map((m) => [m.boardId, m]));
    const instances = projectInstances(this.meetings, from, to).filter((inst) => {
      const meeting = byId.get(inst.boardId);
      if (!meeting) return false;
      return this.scopeKind === "person"
        ? instanceForPerson(meeting, inst, this.scopePerson)
        : meetingMatchesOrg(meeting, this.scopeOrg);
    });

    const { dayStart, dayEnd } = this.prefs;
    const gridH = (dayEnd - dayStart) * HOUR_PX;
    const grid = el("div", "ltk-lh-grid");
    grid.style.gridTemplateColumns = `56px repeat(${days.length}, 1fr)`;

    // header row
    grid.appendChild(el("div", "ltk-lh-corner"));
    const todayIso = isoLocal(startOfDay(new Date()));
    for (const day of days) {
      const head = el(
        "div",
        "ltk-lh-dayhead",
        `${DAY_LABELS[day.getDay()]} ${day.getDate()}`
      );
      if (isoLocal(day) === todayIso) head.classList.add("ltk-lh-today");
      grid.appendChild(head);
    }

    // time axis
    const axis = el("div", "ltk-lh-axis");
    axis.style.height = `${gridH}px`;
    for (let h = dayStart; h < dayEnd; h++) {
      const label = el("div", "ltk-lh-hour", `${String(h).padStart(2, "0")}:00`);
      label.style.top = `${(h - dayStart) * HOUR_PX}px`;
      axis.appendChild(label);
    }
    grid.appendChild(axis);

    // day columns
    for (const day of days) {
      const col = el("div", "ltk-lh-daycol");
      col.style.height = `${gridH}px`;
      if (isoLocal(day) === todayIso) col.classList.add("ltk-lh-today");

      for (let h = dayStart + 1; h < dayEnd; h++) {
        const line = el("div", "ltk-lh-gridline");
        line.style.top = `${(h - dayStart) * HOUR_PX}px`;
        col.appendChild(line);
      }

      // protected-time bands behind everything
      for (const zone of this.protectedTimes) {
        if (!zone.days.includes(day.getDay())) continue;
        const startMin = Math.max(timeToMinutes(zone.start), dayStart * 60);
        const endMin = Math.min(timeToMinutes(zone.end), dayEnd * 60);
        if (endMin <= startMin) continue;
        const band = el("div", "ltk-lh-band");
        band.style.top = `${((startMin - dayStart * 60) / 60) * HOUR_PX}px`;
        band.style.height = `${((endMin - startMin) / 60) * HOUR_PX}px`;
        band.style.background = zone.color;
        band.title = `${zone.label} ${zone.start}–${zone.end}`;
        if (zone.label !== "") {
          band.appendChild(el("span", "ltk-lh-band-label", zone.label));
        }
        col.appendChild(band);
      }

      // occurrence chips, lane-split when they share a start time
      const dayIso = isoLocal(day);
      const todays = instances
        .filter((i) => i.date === dayIso)
        .sort((a, b) => (a.time < b.time ? -1 : 1));
      const lanes = new Map<string, HubInstance[]>();
      for (const inst of todays) {
        const key = inst.time;
        lanes.set(key, [...(lanes.get(key) ?? []), inst]);
      }
      for (const [time, group] of lanes) {
        const min = timeToMinutes(time);
        if (min < dayStart * 60 || min >= dayEnd * 60) continue;
        group.forEach((inst, lane) => {
          const chip = el("button", "ltk-lh-chip") as HTMLButtonElement;
          chip.type = "button";
          chip.style.top = `${((min - dayStart * 60) / 60) * HOUR_PX}px`;
          chip.style.height = `${CHIP_H}px`;
          chip.style.left = `${(100 / group.length) * lane}%`;
          chip.style.width = `calc(${100 / group.length}% - 4px)`;
          if (inst.barColor !== "") chip.style.borderLeftColor = inst.barColor;
          const line1 = el("div", "ltk-lh-chip-title", inst.title);
          const meta: string[] = [inst.time];
          if (inst.shift !== "") meta.push(inst.shift === "day" ? "Day" : "Night");
          if (inst.crew !== "") meta.push(`Crew ${inst.crew}`);
          if (inst.topic !== "") meta.push(inst.topic);
          chip.append(line1, el("div", "ltk-lh-chip-meta", meta.join(" · ")));
          chip.title = `${inst.title} — ${meta.join(" · ")}`;
          chip.addEventListener("click", () => this.cb.onSelectMeeting(inst));
          col.appendChild(chip);
        });
      }
      grid.appendChild(col);
    }

    const scroll = el("div", "ltk-lh-scroll");
    scroll.appendChild(grid);
    body.appendChild(scroll);
  }

  // ---- actions ----

  private myPart(a: LtkAction): { idx: number; done: boolean } | null {
    if (this.viewerId === "") return null;
    const idx = a.assignees.findIndex((x) => x.whoId === this.viewerId);
    return idx >= 0 ? { idx, done: a.assignees[idx].done } : null;
  }

  private renderActions(body: HTMLElement): void {
    const mine =
      this.viewerId === ""
        ? this.actions
        : this.actions.filter((a) =>
            a.assignees.some((x) => x.whoId === this.viewerId)
          );
    const open = mine.filter((a) => a.status !== "done" && a.status !== "cancelled");
    if (open.length === 0) {
      renderGhost(body, ["Nothing on your plate", "Actions assigned to you appear here."]);
      return;
    }

    // group by source, overdue-then-due order inside each
    const groups = new Map<string, LtkAction[]>();
    for (const a of open) {
      const label =
        this.sourceLabels[a.instanceId] ??
        (a.instanceId !== "" ? a.instanceId : "Other");
      groups.set(label, [...(groups.get(label) ?? []), a]);
    }
    const wrap = el("div", "ltk-lh-actions");
    for (const [label, group] of groups) {
      wrap.appendChild(el("div", "ltk-lh-group", label));
      group.sort((a, b) => {
        const ao = isOverdue(a) ? 0 : 1;
        const bo = isOverdue(b) ? 0 : 1;
        if (ao !== bo) return ao - bo;
        return (a.due || "9999") < (b.due || "9999") ? -1 : 1;
      });
      for (const action of group) {
        wrap.appendChild(this.renderActionRow(action));
      }
    }
    body.appendChild(wrap);
  }

  private renderActionRow(action: LtkAction): HTMLElement {
    const row = el("div", "ltk-lh-action");
    const my = this.myPart(action);
    if (my) {
      const tick = el("input") as HTMLInputElement;
      tick.type = "checkbox";
      tick.checked = my.done;
      tick.title = "My part is done";
      tick.disabled = this.readOnly;
      tick.addEventListener("change", () => {
        action.assignees[my.idx].done = tick.checked;
        this.cb.onActions(this.actions);
        this.render();
      });
      row.appendChild(tick);
    }
    const main = el("div", "ltk-lh-action-main");
    const title = el("div", "ltk-lh-action-issue", action.issue || action.description);
    if (my?.done) title.classList.add("ltk-lh-done");
    main.appendChild(title);
    if (action.issue !== "" && action.description !== "") {
      main.appendChild(el("div", "ltk-lh-action-desc", action.description));
    }
    row.appendChild(main);
    const others = action.assignees.filter((x) => x.whoId !== this.viewerId);
    if (others.length > 0) {
      row.appendChild(
        el("span", "ltk-lh-action-with", `with ${others.map((o) => o.who).join(", ")}`)
      );
    }
    if (action.due !== "") {
      const due = el("span", "ltk-lh-action-due", action.due);
      if (isOverdue(action)) due.classList.add("ltk-lh-overdue");
      row.appendChild(due);
    }
    if (action.escalated) row.appendChild(el("span", "ltk-lh-esc", "⚑"));
    return row;
  }

  // ---- settings ----

  private renderSettings(body: HTMLElement): void {
    const form = el("div", "ltk-lh-form");
    body.appendChild(form);
    const commit = () => this.cb.onPrefs(this.prefs);

    form.appendChild(el("div", "ltk-lh-section", "Cadence preferences"));
    form.appendChild(
      this.field(
        "Default scope",
        this.select(
          this.prefs.scopeKind,
          [
            { value: "person", label: "Person (me)" },
            { value: "org", label: "Organisation" },
          ],
          (v) => {
            this.prefs.scopeKind = v as ScopeKind;
            commit();
            this.render(); // the default-org cascade appears/disappears
          }
        )
      )
    );
    if (this.prefs.scopeKind === "org") {
      const cascade = el("div", "ltk-lh-cascade");
      for (const sel of this.orgCascade(this.prefs.org, () => {
        commit();
        this.render(); // re-cascade the dependent selects
      })) {
        cascade.appendChild(sel);
      }
      form.appendChild(this.field("My site / department / area", cascade));
      form.appendChild(
        el(
          "div",
          "ltk-lh-help",
          "Your home in the organisation — the cadence view opens here. Department and area are optional."
        )
      );
    }
    form.appendChild(
      this.field(
        "Default view",
        this.select(
          this.prefs.view,
          [
            { value: "week", label: "Week" },
            { value: "day", label: "Day" },
          ],
          (v) => {
            this.prefs.view = v as "day" | "week";
            commit();
          }
        )
      )
    );
    form.appendChild(
      this.field(
        "Week starts on",
        this.select(
          String(this.prefs.weekStart),
          [
            { value: "1", label: "Monday" },
            { value: "0", label: "Sunday" },
          ],
          (v) => {
            this.prefs.weekStart = v === "0" ? 0 : 1;
            commit();
            this.render();
          }
        )
      )
    );
    const hourOptions = (fromH: number, toH: number) =>
      Array.from({ length: toH - fromH + 1 }, (_, i) => ({
        value: String(fromH + i),
        label: `${String(fromH + i).padStart(2, "0")}:00`,
      }));
    form.appendChild(
      this.field(
        "Day starts",
        this.select(String(this.prefs.dayStart), hourOptions(0, 12), (v) => {
          this.prefs.dayStart = Number(v);
          if (this.prefs.dayEnd <= this.prefs.dayStart) {
            this.prefs.dayEnd = this.prefs.dayStart + 8;
          }
          commit();
          this.render();
        })
      )
    );
    form.appendChild(
      this.field(
        "Day ends",
        this.select(String(this.prefs.dayEnd), hourOptions(12, 24), (v) => {
          this.prefs.dayEnd = Number(v);
          commit();
          this.render();
        })
      )
    );

    if (!this.canEditSite) return;
    form.appendChild(el("div", "ltk-lh-section", "Protected time (site)"));
    form.appendChild(
      el(
        "div",
        "ltk-lh-help",
        "Recurring blocks highlighted behind the calendar — field leadership time, 1:1s, problem solving. Applies to everyone at the site."
      )
    );
    const commitZones = () => this.cb.onProtected(this.protectedTimes);
    this.protectedTimes.forEach((zone, zi) => {
      form.appendChild(this.renderZoneRow(zone, zi, commitZones));
    });
    if (!this.readOnly) {
      const add = el("button", "ltk-lh-btn", "＋ Add protected time") as HTMLButtonElement;
      add.type = "button";
      add.addEventListener("click", () => {
        this.protectedTimes.push({
          label: "",
          color: "#f2c811",
          days: [1, 2, 3, 4, 5],
          start: "13:00",
          end: "14:00",
        });
        commitZones();
        this.render();
      });
      form.appendChild(add);
    }
  }

  private renderZoneRow(
    zone: ProtectedTime,
    _zi: number,
    commit: () => void
  ): HTMLElement {
    const row = el("div", "ltk-lh-zone");
    const swatchWrap = el("span", "ltk-lh-zone-color");
    const swatch = el("input") as HTMLInputElement;
    swatch.type = "color";
    swatch.value = /^#[0-9a-f]{6}$/i.test(zone.color) ? zone.color : "#f2c811";
    swatch.disabled = this.readOnly;
    swatch.addEventListener("change", () => {
      zone.color = swatch.value;
      commit();
      this.render();
    });
    swatchWrap.appendChild(swatch);
    row.appendChild(swatchWrap);

    const label = el("input", "ltk-lh-input ltk-lh-zone-label") as HTMLInputElement;
    label.type = "text";
    label.placeholder = "e.g. Field leadership time";
    label.value = zone.label;
    label.disabled = this.readOnly;
    label.addEventListener("change", () => {
      zone.label = label.value.trim();
      commit();
    });
    row.appendChild(label);

    const days = el("div", "ltk-lh-zone-days");
    // Mon-first ordering for the toggles
    for (const d of [1, 2, 3, 4, 5, 6, 0]) {
      const btn = el("button", "ltk-lh-zoneday", DAY_LABELS[d][0]) as HTMLButtonElement;
      btn.type = "button";
      btn.title = DAY_LABELS[d];
      if (zone.days.includes(d)) btn.classList.add("ltk-lh-zoneday-on");
      btn.disabled = this.readOnly;
      btn.addEventListener("click", () => {
        zone.days = zone.days.includes(d)
          ? zone.days.filter((x) => x !== d)
          : [...zone.days, d].sort();
        commit();
        this.render();
      });
      days.appendChild(btn);
    }
    row.appendChild(days);

    const time = (value: string, apply: (v: string) => void) => {
      const input = el("input", "ltk-lh-input ltk-lh-zone-time") as HTMLInputElement;
      input.type = "time";
      input.value = value;
      input.disabled = this.readOnly;
      input.addEventListener("change", () => {
        if (timeToMinutes(input.value) >= 0) {
          apply(input.value);
          commit();
          this.render();
        }
      });
      return input;
    };
    row.appendChild(time(zone.start, (v) => (zone.start = v)));
    row.appendChild(el("span", "ltk-lh-zone-dash", "–"));
    row.appendChild(time(zone.end, (v) => (zone.end = v)));

    if (!this.readOnly) {
      const remove = el("button", "ltk-lh-zone-x", "×") as HTMLButtonElement;
      remove.type = "button";
      remove.title = "Remove";
      remove.addEventListener("click", () => {
        this.protectedTimes = this.protectedTimes.filter((z) => z !== zone);
        commit();
        this.render();
      });
      row.appendChild(remove);
    }
    return row;
  }

  /**
   * The cascading site → department → area selects for an OrgScope,
   * mutating `scope` in place and calling `changed` after each pick.
   * Department and area appear only when applicable (parent chosen and
   * options exist) — a meeting can be site- or department-level only.
   */
  private orgCascade(scope: OrgScope, changed: () => void): HTMLSelectElement[] {
    const tree = this.orgTree.length > 0 ? this.orgTree : deriveOrgTree(this.meetings);
    const out: HTMLSelectElement[] = [];
    out.push(
      this.select(
        scope.site,
        [
          { value: "", label: "All sites" },
          ...tree.map((s) => ({ value: s.site, label: s.site })),
        ],
        (v) => {
          scope.site = v;
          scope.department = "";
          scope.area = "";
          changed();
        }
      )
    );
    const site = tree.find((s) => s.site === scope.site);
    if (site && site.departments.length > 0) {
      out.push(
        this.select(
          scope.department,
          [
            { value: "", label: "Whole site" },
            ...site.departments.map((d) => ({ value: d.department, label: d.department })),
          ],
          (v) => {
            scope.department = v;
            scope.area = "";
            changed();
          }
        )
      );
      const dept = site.departments.find((d) => d.department === scope.department);
      if (dept && dept.areas.length > 0) {
        out.push(
          this.select(
            scope.area,
            [
              { value: "", label: "Whole department" },
              ...dept.areas.map((a) => ({ value: a, label: a })),
            ],
            (v) => {
              scope.area = v;
              changed();
            }
          )
        );
      }
    }
    return out;
  }

  // ---- small helpers ----

  private field(label: string, input: HTMLElement): HTMLElement {
    const row = el("div", "ltk-lh-field");
    row.appendChild(el("label", "ltk-lh-label", label));
    row.appendChild(input);
    return row;
  }

  private select(
    value: string,
    options: { value: string; label: string }[],
    onChange: (v: string) => void
  ): HTMLSelectElement {
    const select = el("select", "ltk-lh-input") as HTMLSelectElement;
    for (const opt of options) {
      const o = el("option", undefined, opt.label) as HTMLOptionElement;
      o.value = opt.value;
      select.appendChild(o);
    }
    select.value = value;
    if (select.value !== value) select.value = options[0]?.value ?? "";
    select.disabled = this.readOnly && this.tab === "settings";
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }
}
