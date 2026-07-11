// The MeetingScheduler view: a selection list of generated meeting
// instances, newest first. Each row shows date · time · crew badge · record
// status (record exists / no record for a past instance / planned). Tapping
// a row selects it and hands it to the wrapper, which emits it on
// selectedMeetingJSON for the app's OnChange to open or create the record.

import { applyThemeVars, defaultTheme, textOn, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import { parsePrompts, Prompts, renderGhost, renderTitleBar } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { htmlToPng, saveSvg, SnapshotScheduler } from "../../shared/export/png";
import { todayIso } from "../../shared/schema/id";
import { MeetingInstance } from "./types";
import { MEETING_CSS } from "./styles";

export interface MeetingViewCallbacks {
  onSelect: (instance: MeetingInstance) => void;
  onPngReady?: (dataUri: string, svgMarkup?: string) => void;
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
  private readonly png: SnapshotScheduler;

  constructor(host: HTMLElement, private readonly cb: MeetingViewCallbacks) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-meeting-css", MEETING_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.png = new SnapshotScheduler(() => this.generatePng());
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
    this.png.schedule();
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
    this.png.cancel();
    this.root.remove();
  }

  // ---- helpers ----

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
    if (!this.readOnly) {
      renderKebab(this.root, [
        { label: "Download PNG", onClick: () => this.downloadPng() },
        { label: "Download SVG", onClick: () => this.downloadSvg() },
      ]);
    }

    const body = el("div", "ltk-ms-body");
    this.root.appendChild(body);

    if (this.instances.length === 0) {
      const lines = this.prompts.general.length
        ? this.prompts.general
        : ["No meeting instances in the window", "Check the cadence inputs and window."];
      renderGhost(body, lines.slice(0, 2));
      return;
    }

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

  private renderRow(inst: MeetingInstance, today: string): HTMLElement {
    const row = el("div", "ltk-ms-row");
    if (inst.date === today) row.classList.add("ltk-ms-today");
    if (inst.iso === this.selectedIso) row.classList.add("ltk-ms-selected");

    const date = el("span", "ltk-ms-row-date", this.prettyDate(inst));
    const time = el("span", "ltk-ms-row-time", inst.time);
    row.append(date, time);

    if (inst.shift !== "") {
      row.appendChild(
        el("span", "ltk-ms-row-shift", inst.shift === "day" ? "Day" : "Night ☾")
      );
    }

    if (inst.crew !== "") {
      const badge = el("span", "ltk-ms-crew", inst.crew);
      const c = this.crewColor(inst.crew);
      badge.style.background = c;
      badge.style.color = textOn(c);
      row.appendChild(badge);
    }

    if (inst.rescheduledTo !== "") {
      const move = el("span", "ltk-ms-resched", `→ ${inst.rescheduledTo}`);
      move.title = "Rescheduled";
      row.appendChild(move);
    }

    const status = el("span", "ltk-ms-status");
    if (inst.status === "existing") {
      status.classList.add("ltk-ms-status-existing");
      status.textContent = "● Recorded";
    } else if (inst.status === "missing") {
      status.classList.add("ltk-ms-status-missing");
      status.textContent = "⚠ No record";
      status.title = "This past meeting has no meeting instance.";
    } else {
      status.classList.add("ltk-ms-status-planned");
      status.textContent = "○ Planned";
    }
    row.appendChild(status);

    row.addEventListener("click", () => {
      this.selectedIso = inst.iso;
      this.render();
      this.cb.onSelect(inst);
    });
    return row;
  }

  // ---- PNG export ----

  private generatePng(): void {
    if (!this.cb.onPngReady) return;
    htmlToPng(this.root, LTK_BASE_CSS + MEETING_CSS, this.theme.background, (uri, svg) =>
      this.cb.onPngReady!(uri, svg)
    );
  }

    private downloadSvg(): void {
    htmlToPng(this.root, LTK_BASE_CSS + MEETING_CSS, this.theme.background, (_uri, svg) =>
      saveSvg(svg ?? "", "meetings.svg")
    );
  }

private downloadPng(): void {
    htmlToPng(this.root, LTK_BASE_CSS + MEETING_CSS, this.theme.background, (uri) => {
      const link = document.createElement("a");
      link.href = uri;
      link.download = "meetings.png";
      link.click();
    });
  }
}
