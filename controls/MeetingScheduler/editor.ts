// The MeetingScheduler view: a selection list of generated meeting
// instances, newest first. Each row shows date · time · crew badge · record
// status (record exists / no record for a past instance / planned). Tapping
// a row selects it and hands it to the wrapper, which emits it on
// selectedMeetingJSON for the app's OnChange to open or create the record.

import { applyThemeVars, defaultTheme, textOn, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import { parsePrompts, Prompts, renderGhost, renderTitleBar } from "../../shared/ui/chrome";
import { todayIso } from "../../shared/schema/id";
import { MeetingInfo } from "../../shared/schema/meeting";
import { MeetingColumn, MeetingInstance } from "./types";
import { MEETING_CSS } from "./styles";

export interface MeetingViewCallbacks {
  /** A row was selected (tapped) or its column values edited. `values` merges
   *  the record's stored values with the in-card edits. */
  onSelect: (instance: MeetingInstance, values: Record<string, string>) => void;
  /** The maker added an ad-hoc meeting at `iso` (yyyy-mm-ddTHH:MM). */
  onAddAdhoc?: (iso: string) => void;
}

const CREW_FALLBACKS = ["#2b88d8", "#107c10", "#f2c811", "#8764b8"];

export class MeetingSchedulerView {
  private readonly root: HTMLElement;
  private instances: MeetingInstance[] = [];
  private crews: string[] = [];
  private theme: Theme = defaultTheme();
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  private readOnly = false;
  private selectedIso = "";
  private columns: MeetingColumn[] = [];
  // in-card edits to column values, by instance iso then column key
  private edits: Record<string, Record<string, string>> = {};
  /** The settings blob's meeting section (owner, purpose, org, people). */
  private meetingInfo: MeetingInfo | null = null;
  private aboutOpen = false;
  private adhocOpen = false;

  constructor(host: HTMLElement, private readonly cb: MeetingViewCallbacks) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-meeting-css", MEETING_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.render();
  }

  setInstances(instances: MeetingInstance[], crews: string[]): void {
    if (
      JSON.stringify(instances) === JSON.stringify(this.instances) &&
      JSON.stringify(crews) === JSON.stringify(this.crews)
    ) {
      return;
    }
    this.instances = instances;
    this.crews = crews;
    if (this.selectedIso !== "" && !instances.some((i) => i.iso === this.selectedIso)) {
      this.selectedIso = "";
    }
    this.render();
  }

  setColumns(columns: MeetingColumn[]): void {
    if (JSON.stringify(columns) === JSON.stringify(this.columns)) return;
    this.columns = columns;
    this.render();
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

  setMeetingInfo(info: MeetingInfo | null): void {
    if (JSON.stringify(info) === JSON.stringify(this.meetingInfo)) return;
    this.meetingInfo = info;
    this.render();
  }

  /**
   * Programmatic selection (the selectIso deep-link): behaves exactly like
   * tapping the row — selects, renders, and emits through onSelect. Accepts
   * a full iso ("yyyy-mm-ddTHH:MM") or a bare date (first instance that
   * day). Unknown values no-op.
   */
  selectByIso(iso: string): void {
    const target =
      this.instances.find((i) => i.iso === iso) ??
      this.instances.find((i) => i.date === iso);
    if (!target) return;
    this.selectedIso = target.iso;
    this.render();
    this.cb.onSelect(target, this.mergedValues(target));
  }

  destroy(): void {
    this.root.remove();
  }

  private renderAdhocAdder(body: HTMLElement): void {
    const wrap = el("div", "ltk-ms-adhocadd");
    body.appendChild(wrap);
    if (!this.adhocOpen) {
      const open = el("button", "ltk-ms-adhocbtn", "\uFF0B Ad-hoc meeting") as HTMLButtonElement;
      open.type = "button";
      open.addEventListener("click", () => {
        this.adhocOpen = true;
        this.render();
      });
      wrap.appendChild(open);
      return;
    }
    const date = el("input", "ltk-ms-adhocfield") as HTMLInputElement;
    date.type = "date";
    date.value = todayIso();
    const time = el("input", "ltk-ms-adhocfield") as HTMLInputElement;
    time.type = "time";
    time.value = "09:00";
    const add = el("button", "ltk-ms-adhocbtn", "Create") as HTMLButtonElement;
    add.type = "button";
    add.addEventListener("click", () => {
      if (date.value === "" || time.value === "") return;
      this.adhocOpen = false;
      this.cb.onAddAdhoc?.(`${date.value}T${time.value}`);
    });
    const cancel = el("button", "ltk-ms-adhocbtn", "Cancel") as HTMLButtonElement;
    cancel.type = "button";
    cancel.addEventListener("click", () => {
      this.adhocOpen = false;
      this.render();
    });
    wrap.append(date, time, add, cancel);
  }

  // ---- helpers ----

  /** The value to show for a column cell: an in-card edit over the record's. */
  private valueFor(inst: MeetingInstance, key: string): string {
    return this.edits[inst.iso]?.[key] ?? inst.values[key] ?? "";
  }

  /** Record values overlaid with in-card edits, for emitting on select. */
  private mergedValues(inst: MeetingInstance): Record<string, string> {
    return { ...inst.values, ...(this.edits[inst.iso] ?? {}) };
  }

  private crewColor(crew: string): string {
    const i = Math.max(0, this.crews.indexOf(crew));
    return this.theme.legend[i + 1] ?? CREW_FALLBACKS[i % CREW_FALLBACKS.length];
  }

  private prettyDate(instance: MeetingInstance): string {
    // "Sat 11 Jul"
    const [, m, d] = instance.date.split("-").map(Number);
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${instance.day} ${d} ${months[m - 1]}`;
  }

  // ---- rendering ----

  private render(): void {
    clear(this.root);
    applyThemeVars(this.root, this.theme);
    renderTitleBar(this.root, this.cardTitle, this.prompts);
    this.renderMeetingInfo();

    const body = el("div", "ltk-ms-body");
    this.root.appendChild(body);

    if (this.instances.length === 0) {
      const lines = this.prompts.general.length
        ? this.prompts.general
        : ["No meeting instances in the window", "Check the cadence inputs and window."];
      renderGhost(body, lines.slice(0, 2));
      return;
    }

    if (this.cb.onAddAdhoc && !this.readOnly) this.renderAdhocAdder(body);

    const today = todayIso();
    const list = el("div", "ltk-ms-list");
    for (const inst of this.instances) {
      list.appendChild(this.renderRow(inst, today));
    }
    body.appendChild(list);

    body.appendChild(
      el("div", "ltk-ms-hint", "Tap a meeting to open it — rows without a record create one.")
    );
  }

  /**
   * The meeting's identity, under the title bar: a quiet one-line strip
   * (owner · site / department / area) with a disclosure toggle revealing
   * the purpose and the participant list with crew badges.
   */
  private renderMeetingInfo(): void {
    const info = this.meetingInfo;
    if (!info) return;

    const strip = el("div", "ltk-ms-meta");
    const bits: string[] = [];
    if (info.owner) bits.push(`Owner ${info.owner.who}`);
    const org = [info.org.site, info.org.department, info.org.area]
      .filter((v) => v !== "")
      .join(" / ");
    if (org !== "") bits.push(org);
    strip.appendChild(el("span", "ltk-ms-meta-line", bits.join(" · ")));

    const hasMore = info.purpose !== "" || info.participants.length > 0;
    if (hasMore) {
      const toggle = el("button", "ltk-ms-meta-toggle") as HTMLButtonElement;
      toggle.type = "button";
      toggle.textContent = this.aboutOpen ? "Hide ▴" : "About ▾";
      toggle.addEventListener("click", () => {
        this.aboutOpen = !this.aboutOpen;
        this.render();
      });
      strip.appendChild(toggle);
    }
    this.root.appendChild(strip);

    if (!this.aboutOpen || !hasMore) return;
    const about = el("div", "ltk-ms-about");
    if (info.purpose !== "") {
      about.appendChild(el("div", "ltk-ms-about-purpose", info.purpose));
    }
    if (info.participants.length > 0) {
      const people = el("div", "ltk-ms-about-people");
      for (const p of info.participants) {
        const chip = el("span", "ltk-ms-person", p.who);
        if (p.crew !== "") {
          const badge = el("span", "ltk-ms-person-crew", p.crew);
          const c = this.crewColor(p.crew);
          badge.style.background = c;
          badge.style.color = textOn(c);
          chip.appendChild(badge);
        }
        people.appendChild(chip);
      }
      about.appendChild(people);
    }
    this.root.appendChild(about);
  }

  private renderRow(inst: MeetingInstance, today: string): HTMLElement {
    const row = el("div", "ltk-ms-row");
    if (inst.date === today) row.classList.add("ltk-ms-today");
    if (inst.iso === this.selectedIso) row.classList.add("ltk-ms-selected");

    // identity line: tapping it selects/opens the meeting
    const main = el("div", "ltk-ms-row-main");
    main.append(
      el("span", "ltk-ms-row-date", this.prettyDate(inst)),
      el("span", "ltk-ms-row-time", inst.time)
    );
    if (inst.adhoc) main.appendChild(el("span", "ltk-ms-adhoc", "ad-hoc"));

    if (inst.shift !== "") {
      main.appendChild(
        el("span", "ltk-ms-row-shift", inst.shift === "day" ? "Day" : "Night ☾")
      );
    }

    if (inst.crew !== "") {
      const badge = el("span", "ltk-ms-crew", inst.crew);
      const c = this.crewColor(inst.crew);
      badge.style.background = c;
      badge.style.color = textOn(c);
      main.appendChild(badge);
    }

    if (inst.topic !== "") {
      const topic = el("span", "ltk-ms-topic", inst.topic);
      topic.title = "This occurrence's rotation topic";
      main.appendChild(topic);
    }

    if (inst.rescheduledTo !== "") {
      const move = el("span", "ltk-ms-resched", `→ ${inst.rescheduledTo}`);
      move.title = "Rescheduled";
      main.appendChild(move);
    }

    const status = el("span", "ltk-ms-status");
    if (inst.status === "existing") {
      status.classList.add("ltk-ms-status-existing");
      status.textContent = "● Recorded";
    } else if (inst.status === "missing") {
      status.classList.add("ltk-ms-status-missing");
      status.textContent = "⚠ No record";
      status.title = "This past meeting has no record.";
    } else {
      status.classList.add("ltk-ms-status-planned");
      status.textContent = "○ Planned";
    }
    main.appendChild(status);
    main.addEventListener("click", () => {
      this.selectedIso = inst.iso;
      this.render();
      this.cb.onSelect(inst, this.mergedValues(inst));
    });
    row.appendChild(main);

    // custom-column entry cells (topic, chair, notetaker…) — editing a value
    // emits the row so the app can persist it; it does not re-select/re-render
    if (this.columns.length > 0) {
      const cols = el("div", "ltk-ms-row-cols");
      for (const col of this.columns) {
        const cell = el("div", "ltk-ms-col");
        cell.appendChild(el("span", "ltk-ms-col-label", col.label));
        const input = el("input", "ltk-ms-col-input") as HTMLInputElement;
        input.type = "text";
        input.value = this.valueFor(inst, col.key);
        input.placeholder = col.label;
        input.disabled = this.readOnly;
        // don't let a field interaction fall through to the row's select
        input.addEventListener("click", (e) => e.stopPropagation());
        input.addEventListener("pointerdown", (e) => e.stopPropagation());
        input.addEventListener("input", () => {
          (this.edits[inst.iso] ??= {})[col.key] = input.value;
        });
        input.addEventListener("change", () => {
          this.cb.onSelect(inst, this.mergedValues(inst));
        });
        cell.appendChild(input);
        cols.appendChild(cell);
      }
      row.appendChild(cols);
    }

    return row;
  }
}
