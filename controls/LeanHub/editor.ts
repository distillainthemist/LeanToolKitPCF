// The LeanHub view — a person's home.
//
// My day: the viewer's rituals today (single-day grid) beside their
// actions bucketed late / due today / due this week.
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
import { copyText } from "../../shared/ui/clipboard";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import { parsePrompts, Prompts, renderGhost, renderTitleBar } from "../../shared/ui/chrome";
import { isOverdue, LtkAction, newAction } from "../../shared/schema/actions";
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
  meetingForPerson,
  meetingMatchesOrg,
  OrgScope,
  projectInstances,
  ProtectedTime,
  ScopeKind,
  sourceLabel,
  timeToMinutes,
} from "./types";
import { dueTone, relativeDue, statusChip } from "../../shared/ui/format";
import { LEANHUB_CSS } from "./styles";

export interface LeanHubCallbacks {
  onSelectMeeting: (inst: HubInstance) => void;
  onActions: (actions: LtkAction[]) => void;
  onPrefs: (prefs: HubPrefs) => void;
  onProtected: (times: ProtectedTime[]) => void;
}

type Tab = "myday" | "calendar" | "actions" | "settings";

const HOUR_PX = 44;
const CHIP_H = 38;
const DAY_MS = 24 * 60 * 60 * 1000;

export class LeanHubView {
  private readonly root: HTMLElement;
  private meetings: HubMeeting[] = [];
  private protectedTimes: ProtectedTime[] = [];
  private prefs: HubPrefs = defaultPrefs();
  /** Actions-tab filter chip (Phase 1.5) + Done disclosure (1.6). */
  private actionFilter: "all" | "overdue" | "today" | "done" = "all";
  private showDone = false;
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

  private tab: Tab | string = "myday";
  /** Host-supplied tabs (e.g. the LeanBoard Documents area). Each gets a
   *  PERSISTENT host element: render() re-parents it rather than
   *  rebuilding, so externally mounted content survives tab switches —
   *  plain DOM keeps its state across re-appends. onExtraTab fires once
   *  per key, on first activation (lazy mounting). */
  private extraTabs: { key: string; label: string; count?: number }[] = [];
  /** The main tabs in order; keys absent are hidden. null = built-ins
   *  then extras in registration order (the pre-layout behaviour). */
  private tabLayout: string[] | null = null;
  private onExtraTab: ((key: string, host: HTMLElement) => void) | null = null;
  private extraHosts = new Map<string, HTMLElement>();
  /** Board directory for the Rituals view; null = option hidden. */
  private boards: { boardId: string; name: string; meta: string }[] | null = null;
  private onOpenBoard: ((boardId: string) => void) | null = null;
  private boardLink: ((boardId: string) => string) | null = null;
  private boardsLabel = "Boards";
  /** boardId → accent colour (e.g. ritual-category colours). */
  private boardColors: Record<string, string> = {};
  private hideSettingsTab = false;
  private anchor: Date = startOfDay(new Date());
  private scopeKind: ScopeKind = "person";
  private scopePerson = "";
  private scopeOrg: OrgScope = { site: "", department: "", area: "" };
  private scopeTouched = false;
  /** Cadence view: day/week time grids, or the rituals directory. */
  private view: "day" | "week" | "boards" = "week";
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
      // an unset person pref means "me", whichever order inputs arrive in
      this.scopePerson =
        prefs.person !== "" ? prefs.person : this.viewerId;
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

  /** Supply the board directory (shows the tab; label defaults "Boards"). */
  setBoards(
    boards: { boardId: string; name: string; meta: string }[],
    onOpen: (boardId: string) => void,
    label = "Boards"
  ): void {
    this.onOpenBoard = onOpen;
    const changed =
      JSON.stringify(boards) !== JSON.stringify(this.boards) || label !== this.boardsLabel;
    this.boardsLabel = label;
    if (!changed) return;
    this.boards = boards;
    this.render();
  }

  /**
   * Shareable link per board — supplying it adds a copy-link control to
   * each directory row. Null hides the control.
   */
  setBoardLink(fn: ((boardId: string) => string) | null): void {
    const had = this.boardLink !== null;
    this.boardLink = fn;
    if (had !== (fn !== null)) this.render();
  }

  /** Per-board accent colours (calendar chips + directory rows). */
  setBoardColors(map: Record<string, string>): void {
    if (JSON.stringify(map) === JSON.stringify(this.boardColors)) return;
    this.boardColors = map;
    this.render();
  }

  /** Host-supplied tabs appended after Actions; content is mounted by
   *  the caller into the host element handed to onSelect. */
  setExtraTabs(
    tabs: { key: string; label: string; count?: number }[],
    onSelect: (key: string, host: HTMLElement) => void
  ): void {
    this.extraTabs = tabs;
    this.onExtraTab = onSelect;
    this.render();
  }

  /** The hub's main-tab layout (per-site enablement + order): keys in
   *  display order, built-in or extra; a key not listed is hidden. If the
   *  current tab disappears, the first visible one fronts. */
  setTabLayout(keys: string[] | null): void {
    this.tabLayout = keys;
    const visible = this.visibleTabs().map((t) => t.key);
    if (this.tab !== "settings" && !visible.includes(this.tab)) this.tab = visible[0] ?? "myday";
    this.render();
  }

  private visibleTabs(): { key: Tab | string; label: string; count?: number }[] {
    const builtIn: { key: Tab | string; label: string }[] = [
      { key: "myday", label: "My day" },
      { key: "calendar", label: "Cadence" },
      { key: "actions", label: "Actions" },
    ];
    if (this.tabLayout === null) return [...builtIn, ...this.extraTabs];
    const out: { key: Tab | string; label: string; count?: number }[] = [];
    for (const key of this.tabLayout) {
      const b = builtIn.find((t) => t.key === key);
      if (b) {
        out.push(b);
        continue;
      }
      const x = this.extraTabs.find((t) => t.key === key);
      if (x) out.push(x);
    }
    return out;
  }

  /** Front a tab programmatically — a deep link landing on an extra tab
   *  (e.g. a shared Documents view) selects it the way a click would. */
  selectTab(key: string): void {
    const known = this.visibleTabs().some((t) => t.key === key);
    if (!known || this.tab === key) return;
    this.tab = key;
    this.render();
  }

  /** Hide the in-hub Settings tab (the app hosts settings itself). */
  setHideSettingsTab(on: boolean): void {
    if (this.hideSettingsTab !== on) {
      this.hideSettingsTab = on;
      if (this.tab === "settings") this.tab = "calendar";
      this.render();
    }
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
    const defs: { key: Tab | string; label: string; count?: number }[] = this.visibleTabs();
    if (!this.hideSettingsTab) defs.push({ key: "settings", label: "Settings" });
    // the Actions tab wears its overdue count (design review Phase 1.3)
    const overdueCount = this.actions.filter(
      (a) =>
        isOverdue(a) &&
        (this.viewerId === "" || a.assignees.some((x) => x.whoId === this.viewerId)) &&
        !(this.myPart(a)?.done ?? false)
    ).length;
    for (const t of defs) {
      const btn = el("button", "ltk-lh-tab", t.label) as HTMLButtonElement;
      btn.type = "button";
      if (t.key === "actions" && overdueCount > 0) {
        const chip = el("span", "ltk-lh-tabcount", String(overdueCount));
        chip.title = `${overdueCount} overdue action${overdueCount === 1 ? "" : "s"}`;
        btn.appendChild(chip);
      }
      // a host-supplied tab's own count (the Documents tasks badge):
      // the same chip, quietly toned — waiting is not late
      if (typeof t.count === "number" && t.count > 0) {
        const chip = el("span", "ltk-lh-tabcount ltk-lh-tabcount-quiet", String(t.count));
        chip.title = `${t.count} item${t.count === 1 ? "" : "s"} waiting in ${t.label}`;
        btn.appendChild(chip);
      }
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
    const extra = this.extraTabs.find((t) => t.key === this.tab);
    if (extra) {
      let host = this.extraHosts.get(extra.key);
      const fresh = host === undefined;
      if (host === undefined) {
        host = el("div", "ltk-lh-ext");
        this.extraHosts.set(extra.key, host);
      }
      body.appendChild(host);
      if (fresh) this.onExtraTab?.(extra.key, host);
    } else if (this.tab === "myday") this.renderMyDay(body);
    else if (this.tab === "calendar") this.renderCalendar(body);
    else if (this.tab === "actions") this.renderActions(body);
    else this.renderSettings(body);
  }

  private renderBoards(body: HTMLElement): void {
    const wrap = el("div", "ltk-lh-boards");
    body.appendChild(wrap);
    // the active scope filters the directory; a board with no cadence
    // identity can't be judged, so it stays visible
    const byId = new Map(this.meetings.map((m) => [m.boardId, m]));
    const boards = (this.boards ?? []).filter((b) => {
      const meeting = byId.get(b.boardId);
      if (!meeting) return true;
      return this.scopeKind === "person"
        ? meetingForPerson(meeting, this.scopePerson)
        : meetingMatchesOrg(meeting, this.scopeOrg);
    });
    if (boards.length === 0) {
      wrap.appendChild(el("div", "ltk-lh-empty", "No rituals match this scope."));
      return;
    }
    for (const b of boards) {
      const row = el("div", "ltk-lh-boardrow");
      const open = el("button", "ltk-lh-boardopen") as HTMLButtonElement;
      open.type = "button";
      const color = this.boardColors[b.boardId] ?? "";
      if (color !== "") {
        const dot = el("span", "ltk-lh-boarddot");
        dot.style.background = color;
        open.appendChild(dot);
      }
      open.appendChild(el("span", "ltk-lh-boardname", b.name));
      if (b.meta !== "") open.appendChild(el("span", "ltk-lh-boardmeta", b.meta));
      open.addEventListener("click", () => this.onOpenBoard?.(b.boardId));
      row.appendChild(open);
      const link = this.boardLink?.(b.boardId) ?? "";
      if (link !== "") row.appendChild(this.copyLinkButton(link, row));
      wrap.appendChild(row);
    }
  }

  /** Copy this ritual's link — falls back to showing it when the host
   *  refuses the clipboard, so the URL is always obtainable. */
  private copyLinkButton(link: string, row: HTMLElement): HTMLElement {
    const btn = el("button", "ltk-lh-boardlink", "Copy link") as HTMLButtonElement;
    btn.type = "button";
    btn.title = "Copy a link that opens the latest meeting";
    btn.addEventListener("click", () => {
      void copyText(link).then((ok) => {
        if (!ok) {
          const box = el("input", "ltk-lh-boardlinkbox") as HTMLInputElement;
          box.value = link;
          box.readOnly = true;
          btn.replaceWith(box);
          box.select();
          box.addEventListener("blur", () => box.replaceWith(btn));
          return;
        }
        btn.textContent = "Copied";
        row.classList.add("ltk-lh-boardcopied");
        window.setTimeout(() => {
          btn.textContent = "Copy link";
          row.classList.remove("ltk-lh-boardcopied");
        }, 1600);
      });
    });
    return btn;
  }

  // ---- calendar ----

  private visibleDays(): Date[] {
    if (this.view === "day") return [new Date(this.anchor.getTime())];
    const dow = this.anchor.getDay();
    const offset = (dow - this.prefs.weekStart + 7) % 7;
    const start = new Date(this.anchor.getTime() - offset * DAY_MS);
    return Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * DAY_MS));
  }

  /** The Cadence view picker: day/week grids plus the rituals directory. */
  private viewSelect(): HTMLElement {
    const opts = [
      { value: "week", label: "Week view" },
      { value: "day", label: "Day view" },
    ];
    if (this.boards !== null) opts.push({ value: "boards", label: this.boardsLabel });
    return this.select(this.view, opts, (v) => {
      this.view = v as "day" | "week" | "boards";
      this.render();
    });
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
          // switching kind lands on the saved defaults: me / my org
          if (this.scopeKind === "person") {
            this.scopePerson = this.prefs.person !== "" ? this.prefs.person : this.viewerId;
          } else {
            this.scopeOrg = { ...this.prefs.org };
          }
          this.render();
        }
      )
    );

    if (this.scopeKind === "person") {
      bar.appendChild(this.personPicker());
    } else {
      for (const sel of this.orgCascade(this.scopeOrg, () => {
        this.scopeTouched = true;
        this.render();
      })) {
        bar.appendChild(sel);
      }
    }

    bar.appendChild(this.viewSelect());

    // rituals directory as a view format — same person/org scoping as the
    // time grids, just no date navigation
    if (this.view === "boards") {
      body.appendChild(bar);
      this.renderBoards(body);
      return;
    }

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

    // no meetings = an empty calendar, not a maker hint — the grid
    // below renders fine with zero instances

    // project + scope-filter the window's occurrences
    const byId = new Map(this.meetings.map((m) => [m.boardId, m]));
    const instances = projectInstances(this.meetings, from, to).filter((inst) => {
      const meeting = byId.get(inst.boardId);
      if (!meeting) return false;
      return this.scopeKind === "person"
        ? instanceForPerson(meeting, inst, this.scopePerson)
        : meetingMatchesOrg(meeting, this.scopeOrg);
    });

    body.appendChild(this.buildGrid(days, instances));
  }

  /** The day/week time grid (shared by Cadence and My day). */
  private buildGrid(days: Date[], instances: HubInstance[]): HTMLElement {
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
          // explicit meeting theme wins; ritual-category colour is the default
          const accent = inst.barColor !== "" ? inst.barColor : (this.boardColors[inst.boardId] ?? "");
          if (accent !== "") chip.style.borderLeftColor = accent;
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
    return scroll;
  }

  // ---- my day ----

  private renderMyDay(body: HTMLElement): void {
    const today = startOfDay(new Date());
    const wrap = el("div", "ltk-lh-myday");
    body.appendChild(wrap);

    // left: the signed-in viewer's rituals today on the day grid
    const left = el("div", "ltk-lh-myday-col ltk-lh-myday-cal");
    wrap.appendChild(left);
    left.appendChild(
      el(
        "div",
        "ltk-lh-myday-head",
        `Today · ${DAY_LABELS[today.getDay()]} ${today.getDate()} ${MONTH_LABELS[today.getMonth()]}`
      )
    );
    const byId = new Map(this.meetings.map((m) => [m.boardId, m]));
    const instances = projectInstances(this.meetings, today, today).filter((inst) => {
      const meeting = byId.get(inst.boardId);
      return meeting ? instanceForPerson(meeting, inst, this.viewerId) : false;
    });
    // an AGENDA, not an hour grid (design review Phase 1.1): today is a
    // short list of rows — the week grid stays on Cadence. Category
    // colour rides a border plus the meta TEXT, never colour alone.
    const agenda = el("div", "ltk-lh-agenda");
    const ordered = [...instances].sort((a, b) => (a.time < b.time ? -1 : 1));
    if (ordered.length === 0) {
      agenda.appendChild(el("div", "ltk-lh-agenda-empty", "Nothing else scheduled today."));
    }
    for (const inst of ordered) {
      const row = el("div", "ltk-lh-agendarow");
      const accent =
        inst.barColor !== "" ? inst.barColor : (this.boardColors[inst.boardId] ?? "");
      if (accent !== "") row.style.borderLeftColor = accent;
      const main = el("div", "ltk-lh-agenda-main");
      main.appendChild(el("div", "ltk-lh-agenda-name", inst.title));
      const meta: string[] = [];
      const dept = byId.get(inst.boardId)?.info?.org.department ?? "";
      if (dept !== "") meta.push(dept);
      if (inst.shift !== "") meta.push(inst.shift === "day" ? "Day" : "Night");
      if (inst.crew !== "") meta.push(`Crew ${inst.crew}`);
      if (inst.topic !== "") meta.push(inst.topic);
      if (meta.length > 0) main.appendChild(el("div", "ltk-lh-agenda-meta", meta.join(" · ")));
      const open = el("button", "ltk-lh-btn ltk-lh-agenda-open", "Open board") as HTMLButtonElement;
      open.type = "button";
      open.addEventListener("click", () => this.cb.onSelectMeeting(inst));
      row.append(el("span", "ltk-lh-agenda-time", inst.time), main, open);
      agenda.appendChild(row);
    }
    left.appendChild(agenda);

    // right: my open actions bucketed late / due today / due this week
    const right = el("div", "ltk-lh-myday-col");
    wrap.appendChild(right);
    right.appendChild(el("div", "ltk-lh-myday-head", "My actions"));
    const list = el("div", "ltk-lh-actions ltk-lh-myday-list");
    right.appendChild(list);

    // unlike the Actions tab (which keeps ticked rows struck through for
    // review), My day is a to-do view: a completed part disappears
    const mine = this.actions.filter(
      (a) =>
        a.status !== "done" &&
        a.status !== "cancelled" &&
        (this.viewerId === "" || a.assignees.some((x) => x.whoId === this.viewerId)) &&
        !(this.myPart(a)?.done ?? false)
    );
    const todayIso = isoLocal(today);
    const offset = (today.getDay() - this.prefs.weekStart + 7) % 7;
    const weekEndIso = isoLocal(new Date(today.getTime() + (6 - offset) * DAY_MS));
    const byDue = (a: LtkAction, b: LtkAction) =>
      (a.due || "9999") < (b.due || "9999") ? -1 : 1;
    const buckets = [
      {
        key: "late",
        label: "Late",
        items: mine.filter((a) => a.due !== "" && a.due < todayIso).sort(byDue),
      },
      {
        key: "today",
        label: "Due today",
        items: mine.filter((a) => a.due === todayIso).sort(byDue),
      },
      {
        key: "week",
        label: "Due this week",
        items: mine
          .filter((a) => a.due > todayIso && a.due <= weekEndIso)
          .sort(byDue),
      },
    ];
    if (buckets.every((b) => b.items.length === 0)) {
      renderGhost(list, [
        "Nothing pressing",
        "Actions due this week appear here.",
      ]);
    } else {
      // empty buckets stay hidden — only groups with work show
      for (const b of buckets.filter((x) => x.items.length > 0)) {
        const head = el("div", `ltk-lh-bucket ltk-lh-bucket-${b.key}`);
        head.append(
          el("span", "ltk-lh-bucket-label", b.label),
          el("span", "ltk-lh-bucket-count", String(b.items.length))
        );
        list.appendChild(head);
        for (const action of b.items) list.appendChild(this.renderActionRow(action));
      }
    }
    const shown = buckets.reduce((n, b) => n + b.items.length, 0);
    if (mine.length > shown) {
      const more = el(
        "div",
        "ltk-lh-bucket-none",
        `${mine.length - shown} more due later or without a due date — `
      );
      // a real destination, not a hint (design review Phase 1.7)
      const link = el("button", "ltk-lh-linklike", "see Actions") as HTMLButtonElement;
      link.type = "button";
      link.addEventListener("click", () => this.selectTab("actions"));
      more.appendChild(link);
      list.appendChild(more);
    }
  }

  // ---- actions ----

  private myPart(a: LtkAction): { idx: number; done: boolean } | null {
    if (this.viewerId === "") return null;
    const idx = a.assignees.findIndex((x) => x.whoId === this.viewerId);
    return idx >= 0 ? { idx, done: a.assignees[idx].done } : null;
  }

  private renderActions(body: HTMLElement): void {
    const wrap = el("div", "ltk-lh-actions");
    body.appendChild(wrap);
    if (!this.readOnly) wrap.appendChild(this.renderActionComposer());

    const mine =
      this.viewerId === ""
        ? this.actions
        : this.actions.filter((a) =>
            a.assignees.some((x) => x.whoId === this.viewerId)
          );
    const open = mine.filter((a) => a.status !== "done" && a.status !== "cancelled");
    // "done" here = the viewer's part is ticked (whole-action done rows
    // left the open set already) — these collapse under one disclosure
    // instead of littering the list struck-through (Phase 1.6)
    const active = open.filter((a) => !(this.myPart(a)?.done ?? false));
    const doneMine = open.filter((a) => this.myPart(a)?.done ?? false);

    // filter chips (Phase 1.5) — glyphless words; active chip is tinted
    const todayIso = isoLocal(startOfDay(new Date()));
    const chips: { key: "all" | "overdue" | "today" | "done"; label: string }[] = [
      { key: "all", label: "All" },
      { key: "overdue", label: "Overdue" },
      { key: "today", label: "Due today" },
      { key: "done", label: "Done" },
    ];
    const chipRow = el("div", "ltk-lh-fchips");
    for (const c of chips) {
      const b = el("button", "ltk-lh-fchip", c.label) as HTMLButtonElement;
      b.type = "button";
      if (c.key === this.actionFilter) b.classList.add("ltk-lh-fchip-on");
      b.setAttribute("aria-pressed", String(c.key === this.actionFilter));
      b.addEventListener("click", () => {
        this.actionFilter = c.key;
        this.render();
      });
      chipRow.appendChild(b);
    }
    wrap.appendChild(chipRow);

    const visible =
      this.actionFilter === "done"
        ? doneMine
        : this.actionFilter === "overdue"
          ? active.filter((a) => isOverdue(a))
          : this.actionFilter === "today"
            ? active.filter((a) => a.due === todayIso)
            : active;
    if (visible.length === 0 && (this.actionFilter !== "all" || doneMine.length === 0)) {
      renderGhost(wrap, [
        this.actionFilter === "all" ? "Nothing on your plate" : "Nothing here",
        this.actionFilter === "all"
          ? "Actions assigned to you appear here."
          : "No actions match this filter.",
      ]);
      return;
    }

    // group by source, overdue-then-due order inside each. The label
    // NEVER shows a raw id (Phase 1.4 — sourceLabel's fallback chain).
    const boardTitle = (boardId: string) =>
      this.meetings.find((m) => m.boardId === boardId)?.title;
    const groups = new Map<string, LtkAction[]>();
    for (const a of visible) {
      const label = sourceLabel(a.instanceId, a.context.source, this.sourceLabels, boardTitle);
      groups.set(label, [...(groups.get(label) ?? []), a]);
    }
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

    // ticked-off work waits behind one calm row (Phase 1.6)
    if (this.actionFilter === "all" && doneMine.length > 0) {
      const toggle = el(
        "button",
        "ltk-lh-donetoggle",
        `${this.showDone ? "▾" : "▸"} Done · ${doneMine.length}`
      ) as HTMLButtonElement;
      toggle.type = "button";
      toggle.setAttribute("aria-expanded", String(this.showDone));
      toggle.addEventListener("click", () => {
        this.showDone = !this.showDone;
        this.render();
      });
      wrap.appendChild(toggle);
      if (this.showDone) {
        for (const action of doneMine) wrap.appendChild(this.renderActionRow(action));
      }
    }
  }

  /**
   * Ad-hoc capture: a personal action minted right here — assigned to the
   * viewer, instanceId "hub-<viewerId>" (a stable personal bucket for the
   * central-table upsert), grouped under Personal.
   */
  private renderActionComposer(): HTMLElement {
    const row = el("div", "ltk-lh-compose");
    const issue = el("input", "ltk-lh-input ltk-lh-compose-issue") as HTMLInputElement;
    issue.type = "text";
    issue.placeholder = "Add an action…";
    const due = el("input", "ltk-lh-input ltk-lh-compose-due") as HTMLInputElement;
    due.type = "date";
    due.title = "Due date (optional)";
    const add = el("button", "ltk-lh-btn", "＋ Add") as HTMLButtonElement;
    add.type = "button";
    const submit = () => {
      const text = issue.value.trim();
      if (text === "") return;
      const me = this.people.find((p) => p.whoId === this.viewerId);
      const action = newAction({ source: "leanhub", sourceId: "" });
      action.instanceId = this.viewerId !== "" ? `hub-${this.viewerId}` : "hub";
      action.issue = text;
      action.due = due.value;
      action.assignees = [
        {
          whoId: this.viewerId !== "" ? this.viewerId : "me",
          who: me?.who ?? "Me",
          done: false,
        },
      ];
      this.actions.push(action);
      this.cb.onActions(this.actions);
      this.render();
    };
    issue.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    add.addEventListener("click", submit);
    row.append(issue, due, add);
    return row;
  }

  private renderActionRow(action: LtkAction): HTMLElement {
    const row = el("div", "ltk-lh-action");
    const my = this.myPart(action);
    if (my) {
      const tick = el("input", "ltk-lh-tick") as HTMLInputElement;
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
      // humanized pill, ISO in the tooltip (design review Phase 1.2);
      // "T00:00" parses the date-only string as LOCAL midnight — bare
      // yyyy-mm-dd would parse UTC and shift the day near midnight
      const rel = relativeDue(`${action.due}T00:00`);
      const pill = statusChip(
        `${rel.tone === "overdue" ? "⚑ " : ""}${rel.label}`,
        dueTone(rel.tone)
      );
      pill.classList.add("ltk-lh-action-due");
      pill.title = action.due;
      row.appendChild(pill);
    }
    if (action.escalated) row.appendChild(el("span", "ltk-lh-esc", "⚑ Escalated"));
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
    // the viewer's home location — set regardless of the default scope
    // kind, because the Organisation view always lands here on switch
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
        "Your home in the organisation — switching to the Organisation view starts here. Department and area are optional."
      )
    );
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
   * The person scope as a roster type-ahead (a select cannot scale to an
   * org-sized roster): exact name match scopes to that person, empty =
   * everyone, unmatched text snaps back to the current person. A Me button
   * jumps to the viewer.
   */
  private personPicker(): HTMLElement {
    const wrap = el("span", "ltk-lh-person-pick");
    const input = el("input", "ltk-lh-input ltk-lh-person-input") as HTMLInputElement;
    input.type = "search";
    input.placeholder = "Everyone — type a name…";
    input.setAttribute("list", "ltk-lh-people-list");
    const current = this.people.find((p) => p.whoId === this.scopePerson);
    input.value = current ? current.who : "";
    const suggestions = el("datalist") as HTMLDataListElement;
    suggestions.id = "ltk-lh-people-list";
    for (const p of this.people) {
      const option = el("option") as HTMLOptionElement;
      option.value = p.who;
      suggestions.appendChild(option);
    }
    input.addEventListener("change", () => {
      const name = input.value.trim();
      if (name === "") {
        this.scopePerson = "";
        this.scopeTouched = true;
        this.render();
        return;
      }
      const match = this.people.find(
        (p) => p.who.toLowerCase() === name.toLowerCase()
      );
      if (match) {
        this.scopePerson = match.whoId;
        this.scopeTouched = true;
      }
      this.render(); // unmatched: snap the field back to the current person
    });
    wrap.append(input, suggestions);
    if (this.viewerId !== "" && this.scopePerson !== this.viewerId) {
      const me = el("button", "ltk-lh-btn", "Me") as HTMLButtonElement;
      me.type = "button";
      me.title = "My cadence";
      me.addEventListener("click", () => {
        this.scopePerson = this.viewerId;
        this.scopeTouched = true;
        this.render();
      });
      wrap.appendChild(me);
    }
    return wrap;
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
