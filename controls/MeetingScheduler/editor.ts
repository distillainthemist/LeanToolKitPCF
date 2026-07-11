// The MeetingScheduler editor: cadence + roster editor on the left (meeting
// rows with day chips, a roster summary line), a rolling occurrence preview
// on the right grouped by day with crew badges. Everything edits through the
// shared dialogs; the generated occurrences are the control's real product
// (emitted on occurrencesJSON by the wrapper).

import { applyThemeVars, defaultTheme, textOn, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import {
  checkItem,
  fieldRow,
  openDialog,
  selectInput,
  textInput,
} from "../../shared/ui/dialog";
import { parsePrompts, Prompts, renderTitleBar } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { htmlToPng, SnapshotScheduler } from "../../shared/export/png";
import { newId, nowIso, todayIso } from "../../shared/schema/id";
import {
  DAY_LABELS,
  generateOccurrences,
  Meeting,
  MeetingEnvelope,
  Occurrence,
  PATTERN_LABELS,
  RosterPattern,
  SCHEMA_ID,
} from "./types";
import { MEETING_CSS } from "./styles";

export interface MeetingEditorCallbacks {
  onChange: (env: MeetingEnvelope) => void;
  onPngReady?: (dataUri: string) => void;
}

const CREW_FALLBACKS = ["#2b88d8", "#107c10", "#f2c811", "#8764b8"];

export class MeetingSchedulerEditor {
  private readonly root: HTMLElement;
  private env: MeetingEnvelope;
  private theme: Theme = defaultTheme();
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  private readOnly = false;
  private readonly png: SnapshotScheduler;

  constructor(host: HTMLElement, private readonly cb: MeetingEditorCallbacks) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-meeting-css", MEETING_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.env = {
      schema: SCHEMA_ID,
      meta: { title: "", updated: "" },
      data: {
        meetings: [],
        roster: { pattern: "none", anchor: "", crews: ["A", "B", "C", "D"], swingDays: 7 },
        horizonDays: 14,
      },
    };
    this.png = new SnapshotScheduler(() => this.generatePng());
    this.render();
  }

  setEnvelope(env: MeetingEnvelope): void {
    this.env = env;
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
    const i = Math.max(0, this.env.data.roster.crews.indexOf(crew));
    return this.theme.legend[i + 1] ?? CREW_FALLBACKS[i % CREW_FALLBACKS.length];
  }

  private daySummary(days: number[]): string {
    if (days.length === 7) return "Every day";
    if (days.length === 5 && !days.includes(0) && !days.includes(6)) return "Weekdays";
    return days.map((d) => DAY_LABELS[d]).join(" ");
  }

  // ---- rendering ----

  private render(): void {
    const overlays = Array.from(this.root.children).filter((c) =>
      c.classList.contains("ltk-dialog-overlay")
    );
    this.renderBody();
    for (const o of overlays) this.root.appendChild(o);
  }

  private renderBody(): void {
    clear(this.root);
    applyThemeVars(this.root, this.theme);
    renderTitleBar(this.root, this.cardTitle, this.prompts);
    if (!this.readOnly) {
      renderKebab(this.root, [
        { label: "Add meeting", onClick: () => this.editMeeting(null) },
        { label: "Roster & horizon", onClick: () => this.editRoster() },
        { label: "Download PNG", onClick: () => this.downloadPng() },
      ]);
    }

    const body = el("div", "ltk-ms-body");
    this.root.appendChild(body);

    body.appendChild(this.renderEditorColumn());
    body.appendChild(this.renderPreview());
  }

  /** Left: the meetings + roster configuration. */
  private renderEditorColumn(): HTMLElement {
    const col = el("div", "ltk-ms-editor");
    col.appendChild(el("div", "ltk-ms-seclabel", "Meetings"));

    for (const m of this.env.data.meetings) {
      const row = el("div", "ltk-ms-meeting");
      const main = el("div", "ltk-ms-meeting-main");
      main.appendChild(el("div", "ltk-ms-meeting-name", m.name));
      main.appendChild(
        el("div", "ltk-ms-meeting-detail", `${this.daySummary(m.days)} · ${m.time} · ${m.durationMin} min`)
      );
      row.appendChild(main);
      if (!this.readOnly) {
        row.classList.add("ltk-ms-edit");
        row.title = "Tap to edit this meeting";
        row.addEventListener("click", () => this.editMeeting(m));
      }
      col.appendChild(row);
    }

    if (!this.readOnly) {
      const add = el("button", "ltk-ms-add", "＋ Add meeting");
      add.type = "button";
      add.addEventListener("click", () => this.editMeeting(null));
      col.appendChild(add);
    }

    col.appendChild(el("div", "ltk-ms-seclabel", "Roster"));
    const roster = this.env.data.roster;
    const rosterRow = el("div", "ltk-ms-roster");
    rosterRow.appendChild(el("div", "ltk-ms-roster-name", PATTERN_LABELS[roster.pattern]));
    const bits: string[] = [];
    if (roster.pattern === "crew2") {
      bits.push(`${roster.crews.slice(0, 2).join(" / ")} · swing ${roster.swingDays}d`);
    }
    if (roster.pattern === "crew4") {
      bits.push(`${roster.crews.slice(0, 4).join(" / ")} · 4-on-4-off`);
    }
    if (roster.pattern !== "none" && roster.anchor !== "") {
      bits.push(`from ${roster.anchor}`);
    }
    bits.push(`${this.env.data.horizonDays}-day preview`);
    rosterRow.appendChild(el("div", "ltk-ms-roster-detail", bits.join(" · ")));
    if (!this.readOnly) {
      rosterRow.classList.add("ltk-ms-edit");
      rosterRow.title = "Tap to change the roster pattern, crews and horizon";
      rosterRow.addEventListener("click", () => this.editRoster());
    }
    col.appendChild(rosterRow);

    return col;
  }

  /** Right: the rolling occurrence preview, grouped by day. */
  private renderPreview(): HTMLElement {
    const wrap = el("div", "ltk-ms-preview");
    const occurrences = generateOccurrences(this.env.data);
    if (occurrences.length === 0) {
      wrap.appendChild(
        el("div", "ltk-ms-empty", "No occurrences in the window — add a meeting or pick its days.")
      );
      return wrap;
    }

    const today = todayIso();
    let currentDate = "";
    let dayBlock: HTMLElement | null = null;
    for (const occ of occurrences) {
      if (occ.date !== currentDate) {
        currentDate = occ.date;
        dayBlock = el("div", "ltk-ms-day");
        const head = el(
          "div",
          "ltk-ms-dayhead",
          occ.date === today ? `${occ.day} ${occ.date.slice(8)} — Today` : `${occ.day} ${occ.date.slice(8)}`
        );
        if (occ.date === today) head.classList.add("ltk-ms-today");
        dayBlock.appendChild(head);
        wrap.appendChild(dayBlock);
      }
      const row = el("div", "ltk-ms-occ");
      row.appendChild(el("span", "ltk-ms-occ-time", occ.time));
      row.appendChild(el("span", "ltk-ms-occ-name", occ.meeting));
      if (occ.crew !== "") {
        const badge = el("span", "ltk-ms-crew", occ.shift === "night" ? `${occ.crew} ☾` : occ.crew);
        const c = this.crewColor(occ.crew);
        badge.style.background = c;
        badge.style.color = textOn(c);
        badge.title = occ.shift !== "" ? `Crew ${occ.crew} · ${occ.shift} shift` : `Crew ${occ.crew}`;
        row.appendChild(badge);
      }
      dayBlock!.appendChild(row);
    }
    return wrap;
  }

  // ---- dialogs ----

  private editMeeting(meeting: Meeting | null): void {
    const nameInput = textInput(meeting?.name ?? "", { placeholder: "Meeting name" });
    const timeInput = textInput(meeting?.time ?? "07:00", { type: "time" });
    const durInput = textInput(String(meeting?.durationMin ?? 15), { type: "number" });
    durInput.min = "5";
    durInput.step = "5";

    // day-of-week chips, Monday first
    const dayWrap = el("div", "ltk-ms-daychips");
    const order = [1, 2, 3, 4, 5, 6, 0];
    const boxes: { day: number; box: HTMLInputElement; wrap: HTMLElement }[] = [];
    for (const d of order) {
      const item = checkItem(DAY_LABELS[d]);
      const selected = meeting ? meeting.days.includes(d) : d >= 1 && d <= 5;
      item.box.checked = selected;
      item.wrap.classList.toggle("ltk-check-on", selected);
      boxes.push({ day: d, box: item.box, wrap: item.wrap });
      dayWrap.appendChild(item.wrap);
    }

    const buttons = [];
    if (meeting) {
      buttons.push({
        label: "Delete",
        kind: "danger" as const,
        onClick: () => {
          this.env.data.meetings = this.env.data.meetings.filter((m) => m.id !== meeting.id);
          dlg.close();
          this.commit();
        },
      });
    }
    buttons.push({ label: "Cancel", kind: "secondary" as const, onClick: () => dlg.close() });
    buttons.push({
      label: meeting ? "Save" : "Add",
      kind: "primary" as const,
      onClick: () => {
        const name = nameInput.value.trim();
        if (name === "") return;
        const days = boxes.filter((b) => b.box.checked).map((b) => b.day).sort();
        if (days.length === 0) return;
        const dur = Math.max(5, Math.min(480, Math.round(Number(durInput.value) || 15)));
        if (meeting) {
          meeting.name = name;
          meeting.time = timeInput.value || "07:00";
          meeting.durationMin = dur;
          meeting.days = days;
        } else {
          this.env.data.meetings.push({
            id: newId("m"),
            name,
            time: timeInput.value || "07:00",
            durationMin: dur,
            days,
          });
        }
        dlg.close();
        this.commit();
      },
    });
    const dlg = openDialog({
      host: this.root,
      title: meeting ? "Edit meeting" : "Add meeting",
      buttons,
    });
    dlg.body.appendChild(fieldRow("Meeting", nameInput));
    const timeRow = fieldRow("Time", timeInput);
    timeRow.classList.add("ltk-field-half");
    dlg.body.appendChild(timeRow);
    const durRow = fieldRow("Minutes", durInput);
    durRow.classList.add("ltk-field-half");
    dlg.body.appendChild(durRow);
    dlg.body.appendChild(fieldRow("Days", dayWrap));
    nameInput.focus();
  }

  private editRoster(): void {
    const roster = this.env.data.roster;
    const patternSel = selectInput(roster.pattern, [
      { value: "none", label: PATTERN_LABELS.none },
      { value: "weekday", label: PATTERN_LABELS.weekday },
      { value: "crew2", label: PATTERN_LABELS.crew2 },
      { value: "crew4", label: PATTERN_LABELS.crew4 },
    ]);
    const anchorInput = textInput(roster.anchor !== "" ? roster.anchor : todayIso(), {
      type: "date",
    });
    const crewsInput = textInput(roster.crews.join(", "), {
      placeholder: "e.g. A, B, C, D",
    });
    const swingInput = textInput(String(roster.swingDays), { type: "number" });
    swingInput.min = "1";
    const horizonInput = textInput(String(this.env.data.horizonDays), { type: "number" });
    horizonInput.min = "1";
    horizonInput.max = "60";

    const anchorRow = fieldRow("Cycle start", anchorInput);
    const crewsRow = fieldRow("Crews", crewsInput);
    const swingRow = fieldRow("Swing days", swingInput);
    swingRow.classList.add("ltk-field-half");

    const syncVisibility = () => {
      const p = patternSel.value as RosterPattern;
      anchorRow.style.display = p === "crew2" || p === "crew4" ? "" : "none";
      crewsRow.style.display = p === "crew2" || p === "crew4" ? "" : "none";
      swingRow.style.display = p === "crew2" ? "" : "none";
    };
    patternSel.addEventListener("change", syncVisibility);

    const dlg = openDialog({
      host: this.root,
      title: "Roster & horizon",
      buttons: [
        { label: "Cancel", kind: "secondary", onClick: () => dlg.close() },
        {
          label: "Save",
          kind: "primary",
          onClick: () => {
            const p = patternSel.value as RosterPattern;
            const crews = crewsInput.value
              .split(",")
              .map((v) => v.trim())
              .filter((v) => v !== "");
            roster.pattern = p;
            roster.anchor = anchorInput.value || "";
            if (crews.length > 0) roster.crews = crews.slice(0, 8);
            roster.swingDays = Math.max(1, Math.min(28, Math.round(Number(swingInput.value) || 7)));
            this.env.data.horizonDays = Math.max(
              1,
              Math.min(60, Math.round(Number(horizonInput.value) || 14))
            );
            dlg.close();
            this.commit();
          },
        },
      ],
    });
    dlg.body.appendChild(fieldRow("Pattern", patternSel));
    dlg.body.appendChild(anchorRow);
    dlg.body.appendChild(crewsRow);
    dlg.body.appendChild(swingRow);
    const horizonRow = fieldRow("Preview days", horizonInput);
    horizonRow.classList.add("ltk-field-half");
    dlg.body.appendChild(horizonRow);
    syncVisibility();
  }

  // ---- mutations ----

  private commit(): void {
    this.env.meta.updated = nowIso();
    this.render();
    this.cb.onChange(this.env);
    this.png.schedule();
  }

  // ---- PNG export ----

  private generatePng(): void {
    if (!this.cb.onPngReady) return;
    htmlToPng(this.root, LTK_BASE_CSS + MEETING_CSS, this.theme.background, (uri) =>
      this.cb.onPngReady!(uri)
    );
  }

  private downloadPng(): void {
    htmlToPng(this.root, LTK_BASE_CSS + MEETING_CSS, this.theme.background, (uri) => {
      const link = document.createElement("a");
      link.href = uri;
      link.download = "meeting-schedule.png";
      link.click();
    });
  }
}
