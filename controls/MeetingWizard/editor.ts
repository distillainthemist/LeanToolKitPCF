// The MeetingWizard view — a stepper that walks a maker through setting up
// a meeting: Basics → Organisation → Cadence → (Crews & roster) →
// Participants → Meeting records → Review. Every edit commits the draft to
// the wrapper (outputJSON follows live); the Review step's Create button
// fires onSubmit so the app knows the maker finished.
//
// Organisation is a cascading site → department → area picklist from the
// orgJSON tree; free-text fallbacks appear when no tree is supplied. The
// Crews & roster step exists only for rostered cadences (daily/shiftly).

import { applyThemeVars, defaultTheme, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import { parsePrompts, Prompts, renderTitleBar } from "../../shared/ui/chrome";
import { OrgSite } from "../../shared/schema/meeting";
import { Person } from "../../shared/schema/people";
import {
  CADENCES,
  csvItems,
  csvJoin,
  emptyDraft,
  hasWeekdays,
  isRostered,
  WizardDraft,
} from "./types";
import { WIZARD_CSS } from "./styles";

export interface MeetingWizardCallbacks {
  onChange: (draft: WizardDraft) => void;
  /** The Review step's Create button — the maker says the setup is done. */
  onSubmit: () => void;
}

interface Step {
  key: string;
  label: string;
  render: (body: HTMLElement) => void;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export class MeetingWizardView {
  private readonly root: HTMLElement;
  private draft: WizardDraft = emptyDraft();
  private orgTree: OrgSite[] = [];
  private people: Person[] = [];
  private theme: Theme = defaultTheme();
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  private readOnly = false;
  private stepKey = "basics";
  private ownerOther = false;
  /** Chips field to refocus after an add re-renders (typing flow). */
  private pendingFocus = "";

  constructor(
    host: HTMLElement,
    private readonly cb: MeetingWizardCallbacks
  ) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-meetingwizard-css", WIZARD_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.render();
  }

  // ---- host-facing API ----

  setDraft(draft: WizardDraft): void {
    this.draft = draft;
    this.ownerOther =
      draft.owner !== null &&
      !this.people.some((p) => p.whoId === draft.owner?.whoId);
    this.stepKey = "basics";
    this.render();
  }

  setOrgTree(tree: OrgSite[]): void {
    if (JSON.stringify(tree) === JSON.stringify(this.orgTree)) return;
    this.orgTree = tree;
    this.render();
  }

  setPeople(people: Person[]): void {
    if (JSON.stringify(people) === JSON.stringify(this.people)) return;
    this.people = people;
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

  destroy(): void {
    this.root.remove();
  }

  // ---- steps ----

  private steps(): Step[] {
    const list: Step[] = [
      { key: "basics", label: "Basics", render: (b) => this.renderBasics(b) },
      { key: "org", label: "Organisation", render: (b) => this.renderOrg(b) },
      { key: "cadence", label: "Cadence", render: (b) => this.renderCadence(b) },
    ];
    if (isRostered(this.draft.category)) {
      list.push({ key: "roster", label: "Crews & roster", render: (b) => this.renderRoster(b) });
    }
    list.push(
      { key: "people", label: "Participants", render: (b) => this.renderPeople(b) },
      { key: "records", label: "Meeting records", render: (b) => this.renderRecords(b) },
      { key: "review", label: "Review", render: (b) => this.renderReview(b) }
    );
    return list;
  }

  private commit(): void {
    this.cb.onChange(this.draft);
  }

  /** Basics is the only gate: a meeting needs a title. */
  private canLeaveBasics(): boolean {
    return this.draft.title.trim() !== "";
  }

  // ---- rendering ----

  private render(): void {
    clear(this.root);
    applyThemeVars(this.root, this.theme);
    renderTitleBar(this.root, this.cardTitle, this.prompts);

    const steps = this.steps();
    let idx = steps.findIndex((s) => s.key === this.stepKey);
    if (idx === -1) idx = 0; // e.g. roster step vanished with the cadence
    const step = steps[idx];

    // stepper header — visited steps are tappable
    const head = el("div", "ltk-mw-steps");
    steps.forEach((s, i) => {
      const dot = el("button", "ltk-mw-step") as HTMLButtonElement;
      dot.type = "button";
      dot.append(el("span", "ltk-mw-step-n", String(i + 1)), el("span", "ltk-mw-step-label", s.label));
      if (i === idx) dot.classList.add("ltk-mw-step-current");
      if (i < idx) dot.classList.add("ltk-mw-step-done");
      dot.disabled = i > idx && !this.canLeaveBasics();
      dot.addEventListener("click", () => {
        this.stepKey = s.key;
        this.render();
      });
      head.appendChild(dot);
    });
    this.root.appendChild(head);

    const body = el("div", "ltk-mw-body");
    this.root.appendChild(body);
    step.render(body);

    // footer: Back / Next, or Create on the review step
    const foot = el("div", "ltk-mw-foot");
    if (idx > 0) {
      const back = el("button", "ltk-mw-btn", "‹ Back") as HTMLButtonElement;
      back.type = "button";
      back.addEventListener("click", () => {
        this.stepKey = steps[idx - 1].key;
        this.render();
      });
      foot.appendChild(back);
    }
    foot.appendChild(el("span", "ltk-mw-foot-gap"));
    if (idx < steps.length - 1) {
      const next = el("button", "ltk-mw-btn ltk-mw-btn-primary", "Next ›") as HTMLButtonElement;
      next.type = "button";
      next.disabled = step.key === "basics" && !this.canLeaveBasics();
      next.title = next.disabled ? "Give the meeting a title first" : "";
      next.addEventListener("click", () => {
        this.stepKey = steps[idx + 1].key;
        this.render();
      });
      foot.appendChild(next);
    } else {
      const create = el("button", "ltk-mw-btn ltk-mw-btn-primary", "Create meeting") as HTMLButtonElement;
      create.type = "button";
      create.disabled = this.readOnly || !this.canLeaveBasics();
      create.addEventListener("click", () => this.cb.onSubmit());
      foot.appendChild(create);
    }
    this.root.appendChild(foot);
  }

  // ---- field helpers ----

  private row(label: string, input: HTMLElement, help?: string): HTMLElement {
    const row = el("div", "ltk-mw-row");
    row.appendChild(el("label", "ltk-mw-label", label));
    row.appendChild(input);
    if (help) row.appendChild(el("div", "ltk-mw-help", help));
    return row;
  }

  private textInput(
    value: string,
    onChange: (v: string) => void,
    placeholder = "",
    type = "text"
  ): HTMLInputElement {
    const input = el("input", "ltk-mw-input") as HTMLInputElement;
    input.type = type;
    input.value = value;
    input.placeholder = placeholder;
    input.disabled = this.readOnly;
    input.addEventListener("change", () => {
      onChange(input.value.trim());
      this.commit();
    });
    return input;
  }

  private selectInput(
    value: string,
    options: { value: string; label: string }[],
    onChange: (v: string) => void
  ): HTMLSelectElement {
    const select = el("select", "ltk-mw-input") as HTMLSelectElement;
    for (const opt of options) {
      const o = el("option", undefined, opt.label) as HTMLOptionElement;
      o.value = opt.value;
      select.appendChild(o);
    }
    select.value = value;
    if (select.value !== value) select.value = options[0]?.value ?? "";
    select.disabled = this.readOnly;
    select.addEventListener("change", () => {
      onChange(select.value);
      this.commit();
    });
    return select;
  }

  /** CSV editor as removable chips + an adder (Enter / comma / blur). */
  private chipsInput(
    csv: string,
    onChange: (csv: string) => void,
    placeholder: string,
    focusKey: string
  ): HTMLElement {
    const wrap = el("div", "ltk-mw-chips");
    const items = csvItems(csv);
    for (const item of items) {
      const chip = el("span", "ltk-mw-chip", item);
      if (!this.readOnly) {
        const x = el("button", "ltk-mw-chip-x", "×") as HTMLButtonElement;
        x.type = "button";
        x.addEventListener("click", () => {
          onChange(csvJoin(items.filter((v) => v !== item)));
          this.commit();
          this.render();
        });
        chip.appendChild(x);
      }
      wrap.appendChild(chip);
    }
    const adder = el("input", "ltk-mw-chip-add") as HTMLInputElement;
    adder.type = "text";
    adder.placeholder = items.length === 0 ? placeholder : "";
    adder.disabled = this.readOnly;
    const add = (refocus: boolean) => {
      const value = adder.value.replace(/,/g, " ").trim();
      if (value === "" || items.includes(value)) {
        adder.value = "";
        return;
      }
      onChange(csvJoin([...items, value]));
      adder.value = "";
      this.commit();
      if (refocus) this.pendingFocus = focusKey; // keep the typing flow going
      this.render();
    };
    adder.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        add(true);
      }
    });
    adder.addEventListener("blur", () => add(false));
    wrap.appendChild(adder);
    if (this.pendingFocus === focusKey) {
      this.pendingFocus = "";
      setTimeout(() => adder.focus(), 0);
    }
    return wrap;
  }

  // ---- step bodies ----

  private renderBasics(body: HTMLElement): void {
    body.appendChild(
      this.row(
        "Meeting title",
        this.textInput(this.draft.title, (v) => (this.draft.title = v), "e.g. Bottling line standup"),
        "Becomes the card title on the board."
      )
    );

    const purpose = el("textarea", "ltk-mw-input ltk-mw-textarea") as HTMLTextAreaElement;
    purpose.value = this.draft.purpose;
    purpose.placeholder = "Why does this meeting exist? What should it decide?";
    purpose.disabled = this.readOnly;
    purpose.addEventListener("change", () => {
      this.draft.purpose = purpose.value.trim();
      this.commit();
    });
    body.appendChild(this.row("Purpose", purpose));

    // owner: pick from the roster, or name someone outside it
    const OTHER = " other";
    const ownerOptions = [
      { value: "", label: "— No owner —" },
      ...this.people.map((p) => ({ value: p.whoId, label: p.who })),
      { value: OTHER, label: "Someone else…" },
    ];
    const current = this.ownerOther ? OTHER : (this.draft.owner?.whoId ?? "");
    const ownerSel = this.selectInput(current, ownerOptions, (v) => {
      if (v === OTHER) {
        this.ownerOther = true;
        this.draft.owner = null;
      } else {
        this.ownerOther = false;
        const p = this.people.find((x) => x.whoId === v);
        this.draft.owner = p ? { whoId: p.whoId, who: p.who, crew: "" } : null;
      }
      this.render();
    });
    body.appendChild(this.row("Owner", ownerSel));
    if (this.ownerOther) {
      body.appendChild(
        this.row(
          "Owner name",
          this.textInput(this.draft.owner?.who ?? "", (v) => {
            this.draft.owner =
              v === ""
                ? null
                : { whoId: v.toLowerCase().replace(/\s+/g, "-"), who: v, crew: "" };
          })
        )
      );
    }
  }

  private renderOrg(body: HTMLElement): void {
    const d = this.draft;
    if (this.orgTree.length === 0) {
      // no picklist supplied — free text keeps the wizard usable anywhere
      body.appendChild(this.row("Site", this.textInput(d.org.site, (v) => (d.org.site = v))));
      body.appendChild(
        this.row("Department", this.textInput(d.org.department, (v) => (d.org.department = v)))
      );
      body.appendChild(this.row("Area", this.textInput(d.org.area, (v) => (d.org.area = v))));
      body.appendChild(
        el("div", "ltk-mw-help", "Bind orgJSON to offer these as picklists instead.")
      );
      return;
    }

    const site = this.orgTree.find((s) => s.site === d.org.site);
    body.appendChild(
      this.row(
        "Site",
        this.selectInput(
          d.org.site,
          [{ value: "", label: "Choose a site…" }, ...this.orgTree.map((s) => ({ value: s.site, label: s.site }))],
          (v) => {
            d.org.site = v;
            d.org.department = "";
            d.org.area = "";
            this.render();
          }
        )
      )
    );

    const departments = site?.departments ?? [];
    const dept = departments.find((x) => x.department === d.org.department);
    body.appendChild(
      this.row(
        "Department",
        this.selectInput(
          d.org.department,
          [
            { value: "", label: site ? "Choose a department…" : "Choose a site first" },
            ...departments.map((x) => ({ value: x.department, label: x.department })),
          ],
          (v) => {
            d.org.department = v;
            d.org.area = "";
            this.render();
          }
        )
      )
    );

    if (dept && dept.areas.length > 0) {
      body.appendChild(
        this.row(
          "Area",
          this.selectInput(
            d.org.area,
            [
              { value: "", label: "Whole department" },
              ...dept.areas.map((a) => ({ value: a, label: a })),
            ],
            (v) => (d.org.area = v)
          ),
          "Optional — leave as whole department if the meeting is not area-specific."
        )
      );
    } else if (d.org.area !== "") {
      // stale area from a previous department choice
      d.org.area = "";
      this.commit();
    }
  }

  private renderCadence(body: HTMLElement): void {
    const d = this.draft;
    body.appendChild(
      this.row(
        "Cadence",
        this.selectInput(d.category, CADENCES, (v) => {
          d.category = v;
          this.render(); // weekday / roster visibility follows
        })
      )
    );
    if (hasWeekdays(d.category)) {
      // weekday toggles read better than a chips field for a fixed set
      const days = el("div", "ltk-mw-days");
      const active = csvItems(d.daysOfWeek);
      for (const day of WEEKDAYS) {
        const btn = el("button", "ltk-mw-day", day) as HTMLButtonElement;
        btn.type = "button";
        if (active.includes(day)) btn.classList.add("ltk-mw-day-on");
        btn.disabled = this.readOnly;
        btn.addEventListener("click", () => {
          const next = active.includes(day)
            ? active.filter((x) => x !== day)
            : [...active, day];
          d.daysOfWeek = csvJoin(WEEKDAYS.filter((x) => next.includes(x)));
          this.commit();
          this.render();
        });
        days.appendChild(btn);
      }
      body.appendChild(this.row("Days of week", days, "None selected = every day."));
    }
    body.appendChild(
      this.row(
        "Time",
        this.textInput(d.timeOfDay, (v) => (d.timeOfDay = v), "07:00", "time"),
        d.category === "shiftly"
          ? "The day-shift meeting; the night-shift meeting is 12 hours later."
          : undefined
      )
    );
    body.appendChild(
      this.row(
        "Days shown",
        this.textInput(d.daysPrior, (v) => (d.daysPrior = v), "14", "number"),
        "How many days of instances the scheduler lists. Empty = 14."
      )
    );
  }

  private renderRoster(body: HTMLElement): void {
    const d = this.draft;
    body.appendChild(
      this.row(
        "Crews",
        this.chipsInput(d.crewList, (v) => (d.crewList = v), "A, B, C, D", "crews"),
        "In roster order. Leave empty for no crew rotation."
      )
    );
    body.appendChild(
      this.row(
        "Roster pattern",
        this.textInput(d.rosterPattern, (v) => (d.rosterPattern = v), "2D-2N-5O"),
        "Blocks of Days / Nights / Off, cycled — e.g. 2D-2N-5O-2D-3N-4O."
      )
    );
    body.appendChild(
      this.row(
        "First day shift",
        this.textInput(d.baseStartDate, (v) => (d.baseStartDate = v), "", "date"),
        "The date the FIRST crew starts its first day shift — anchors the whole rotation."
      )
    );
  }

  private renderPeople(body: HTMLElement): void {
    const d = this.draft;
    const crews = csvItems(d.crewList);
    const isIn = (whoId: string) => d.participants.some((p) => p.whoId === whoId);
    const setCrew = (whoId: string, crew: string) => {
      const p = d.participants.find((x) => x.whoId === whoId);
      if (p) p.crew = crew;
    };

    if (this.people.length === 0 && d.participants.length === 0) {
      body.appendChild(
        el("div", "ltk-mw-help", "No roster bound (peopleJSON) — add participants by name below.")
      );
    }

    const list = el("div", "ltk-mw-people");
    // the supplied roster first, then wizard-added names not in it
    const extras = d.participants.filter((p) => !this.people.some((x) => x.whoId === p.whoId));
    const rows: { whoId: string; who: string; fromRoster: boolean; crew: string }[] = [
      ...this.people.map((p) => ({
        whoId: p.whoId,
        who: p.who,
        fromRoster: true,
        crew: d.participants.find((x) => x.whoId === p.whoId)?.crew ?? p.crew ?? "",
      })),
      ...extras.map((p) => ({ whoId: p.whoId, who: p.who, fromRoster: false, crew: p.crew })),
    ];
    for (const person of rows) {
      const row = el("div", "ltk-mw-person");
      const tick = el("input") as HTMLInputElement;
      tick.type = "checkbox";
      tick.checked = isIn(person.whoId);
      tick.disabled = this.readOnly;
      tick.addEventListener("change", () => {
        if (tick.checked) {
          d.participants.push({ whoId: person.whoId, who: person.who, crew: person.crew });
        } else {
          d.participants = d.participants.filter((x) => x.whoId !== person.whoId);
        }
        this.commit();
        this.render();
      });
      row.append(tick, el("span", "ltk-mw-person-name", person.who));
      if (crews.length > 0 && isIn(person.whoId)) {
        const crewSel = this.selectInput(
          person.crew,
          [{ value: "", label: "Every meeting" }, ...crews.map((c) => ({ value: c, label: `Crew ${c}` }))],
          (v) => setCrew(person.whoId, v)
        );
        crewSel.classList.add("ltk-mw-person-crew");
        row.appendChild(crewSel);
      }
      list.appendChild(row);
    }
    body.appendChild(list);

    if (!this.readOnly) {
      const adder = this.textInput(
        "",
        () => {
          /* handled on change below via value */
        },
        "Add someone by name…"
      );
      adder.addEventListener("change", () => {
        const name = adder.value.trim();
        if (name === "") return;
        const whoId = name.toLowerCase().replace(/\s+/g, "-");
        if (!isIn(whoId)) {
          d.participants.push({ whoId, who: name, crew: "" });
          this.commit();
        }
        adder.value = "";
        this.render();
      });
      body.appendChild(this.row("Add participant", adder));
    }
    if (crews.length > 0) {
      body.appendChild(
        el(
          "div",
          "ltk-mw-help",
          "Crew-linked participants attend when their crew is on; Every meeting = always attends."
        )
      );
    }
  }

  private renderRecords(body: HTMLElement): void {
    body.appendChild(
      this.row(
        "Row columns",
        this.chipsInput(
          this.draft.columns,
          (v) => (this.draft.columns = v),
          "Topic, Chair, Notetaker",
          "columns"
        ),
        "Text fields entered on each meeting row in the scheduler."
      )
    );
  }

  private renderReview(body: HTMLElement): void {
    const d = this.draft;
    const dl = el("div", "ltk-mw-review");
    const add = (label: string, value: string) => {
      if (value === "") return;
      const line = el("div", "ltk-mw-review-line");
      line.append(el("span", "ltk-mw-review-k", label), el("span", "ltk-mw-review-v", value));
      dl.appendChild(line);
    };
    add("Title", d.title);
    add("Purpose", d.purpose);
    add("Owner", d.owner?.who ?? "");
    add(
      "Organisation",
      [d.org.site, d.org.department, d.org.area].filter((v) => v !== "").join(" / ")
    );
    add("Cadence", CADENCES.find((c) => c.value === d.category)?.label ?? d.category);
    if (hasWeekdays(d.category)) add("Days", d.daysOfWeek || "Every day");
    add("Time", d.timeOfDay);
    if (isRostered(d.category)) {
      add("Crews", d.crewList);
      add("Roster", d.rosterPattern);
      add("First day shift", d.baseStartDate);
    }
    add("Row columns", d.columns);
    add(
      "Participants",
      d.participants
        .map((p) => (p.crew !== "" ? `${p.who} (${p.crew})` : p.who))
        .join(", ")
    );
    body.appendChild(dl);
    body.appendChild(
      el(
        "div",
        "ltk-mw-help",
        "Create meeting emits the finished settings — the app saves the board and its scheduler card."
      )
    );
  }
}
