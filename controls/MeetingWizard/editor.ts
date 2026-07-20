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
  isAnchored,
  isRostered,
  isSingleDay,
  WEEKDAYS,
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
  private submitLabel = "Create meeting";
  private submitHostDisabled = false;
  private submitBtn: HTMLButtonElement | null = null;
  /** Chips field to refocus after an add re-renders (typing flow). */
  private pendingFocus = "";
  /** The participants step's roster search, kept across renders. */
  private peopleQuery = "";
  /** Re-applies the basics gate to forward nav without a full re-render. */
  private refreshGates: () => void = () => undefined;
  /** Named roster patterns per site (site settings library). */
  private rosterPatterns: Record<string, { name: string; pattern: string }[]> = {};
  /** Admin-managed meeting categories ([] = field hidden). */
  private meetingCategories: string[] = [];

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
    this.stepKey = "basics";
    this.peopleQuery = "";
    this.render();
  }

  /** Submit button label ("Create meeting" / "Save changes"). */
  setSubmitLabel(label: string): void {
    if (label !== this.submitLabel) {
      this.submitLabel = label;
      this.render();
    }
  }

  /**
   * Enable/disable submit (edit mode keeps it off until a change).
   * Updates the live button in place — no re-render, so focus survives.
   */
  setSubmitEnabled(on: boolean): void {
    this.submitHostDisabled = !on;
    if (this.submitBtn) {
      this.submitBtn.disabled =
        this.submitHostDisabled || this.readOnly || !this.canLeaveBasics();
    }
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

  /** Admin-managed meeting categories (empty = the field stays hidden). */
  setMeetingCategories(categories: string[]): void {
    if (JSON.stringify(categories) === JSON.stringify(this.meetingCategories)) return;
    this.meetingCategories = categories;
    this.render();
  }

  /** The site-settings roster-pattern library ({site: [{name, pattern}]}). */
  setRosterPatterns(lib: Record<string, { name: string; pattern: string }[]>): void {
    if (JSON.stringify(lib) === JSON.stringify(this.rosterPatterns)) return;
    this.rosterPatterns = lib;
    this.render();
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

    // stepper header — visited steps are tappable; forward steps open once
    // the basics gate passes (kept live by refreshGates, not the render)
    const gated: HTMLButtonElement[] = [];
    const head = el("div", "ltk-mw-steps");
    steps.forEach((s, i) => {
      const dot = el("button", "ltk-mw-step") as HTMLButtonElement;
      dot.type = "button";
      dot.append(el("span", "ltk-mw-step-n", String(i + 1)), el("span", "ltk-mw-step-label", s.label));
      if (i === idx) dot.classList.add("ltk-mw-step-current");
      if (i < idx) dot.classList.add("ltk-mw-step-done");
      if (i > idx) gated.push(dot);
      dot.addEventListener("click", () => {
        this.stepKey = s.key;
        this.render();
      });
      head.appendChild(dot);
    });
    this.root.appendChild(head);

    const body = el("div", "ltk-mw-body");
    this.root.appendChild(body);
    // the centred form column — fields compose the same at any host width
    const form = el("div", "ltk-mw-form");
    body.appendChild(form);
    step.render(form);

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
      if (step.key === "basics") gated.push(next);
      next.addEventListener("click", () => {
        this.stepKey = steps[idx + 1].key;
        this.render();
      });
      foot.appendChild(next);
    } else {
      const create = el("button", "ltk-mw-btn ltk-mw-btn-primary", this.submitLabel) as HTMLButtonElement;
      create.type = "button";
      create.disabled = this.readOnly || !this.canLeaveBasics() || this.submitHostDisabled;
      create.addEventListener("click", () => this.cb.onSubmit());
      this.submitBtn = create;
      foot.appendChild(create);
    }
    this.root.appendChild(foot);

    this.refreshGates = () => {
      const block = !this.canLeaveBasics();
      for (const b of gated) {
        b.disabled = block;
        b.title = block ? "Give the meeting a title first" : "";
      }
    };
    this.refreshGates();
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
    const title = this.textInput(
      this.draft.title,
      (v) => (this.draft.title = v),
      "e.g. Bottling line standup"
    );
    // keep the draft (and the forward-nav gate) live per keystroke — the
    // change event only fires on blur, which left Next stuck disabled
    title.addEventListener("input", () => {
      this.draft.title = title.value.trim();
      this.refreshGates();
    });
    body.appendChild(this.row("Meeting title", title, "Becomes the card title on the board."));

    if (this.meetingCategories.length > 0) {
      const cat = this.selectInput(
        this.draft.meetingCategory,
        [
          { value: "", label: "\u2014" },
          ...this.meetingCategories.map((c) => ({ value: c, label: c })),
        ],
        (v) => {
          this.draft.meetingCategory = v;
          this.commit();
        }
      );
      body.appendChild(this.row("Category", cat, "How this meeting is classified."));
    }

    const purpose = el("textarea", "ltk-mw-input ltk-mw-textarea") as HTMLTextAreaElement;
    purpose.value = this.draft.purpose;
    purpose.placeholder = "Why does this meeting exist? What should it decide?";
    purpose.disabled = this.readOnly;
    purpose.addEventListener("change", () => {
      this.draft.purpose = purpose.value.trim();
      this.commit();
    });
    body.appendChild(this.row("Purpose", purpose));

    // owner: type-ahead over the whole roster (works at org scale); an
    // unmatched name becomes a free-text owner
    const owner = el("input", "ltk-mw-input") as HTMLInputElement;
    owner.type = "text";
    owner.value = this.draft.owner?.who ?? "";
    owner.placeholder = "Start typing a name…";
    owner.disabled = this.readOnly;
    owner.setAttribute("list", "ltk-mw-owner-list");
    const suggestions = el("datalist") as HTMLDataListElement;
    suggestions.id = "ltk-mw-owner-list";
    for (const p of this.people) {
      const option = el("option") as HTMLOptionElement;
      option.value = p.who;
      suggestions.appendChild(option);
    }
    owner.addEventListener("change", () => {
      const name = owner.value.trim();
      if (name === "") {
        this.draft.owner = null;
      } else {
        const match = this.people.find(
          (p) => p.who.toLowerCase() === name.toLowerCase()
        );
        this.draft.owner = match
          ? { whoId: match.whoId, who: match.who, crew: "" }
          : { whoId: name.toLowerCase().replace(/\s+/g, "-"), who: name, crew: "" };
      }
      this.commit();
    });
    const ownerWrap = el("div");
    ownerWrap.append(owner, suggestions);
    body.appendChild(
      this.row("Owner", ownerWrap, "Pick from the roster, or type any name.")
    );
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
            { value: "", label: site ? "Whole site" : "Choose a site first" },
            ...departments.map((x) => ({ value: x.department, label: x.department })),
          ],
          (v) => {
            d.org.department = v;
            d.org.area = "";
            this.render();
          }
        ),
        "Optional — leave as whole site for a site-level meeting."
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
      // weekday toggles read better than a chips field for a fixed set;
      // weekly/fortnightly meetings run on exactly ONE day
      const single = isSingleDay(d.category);
      const days = el("div", "ltk-mw-days");
      const active = csvItems(d.daysOfWeek);
      for (const day of WEEKDAYS) {
        const btn = el("button", "ltk-mw-day", day) as HTMLButtonElement;
        btn.type = "button";
        if (active.includes(day)) btn.classList.add("ltk-mw-day-on");
        btn.disabled = this.readOnly;
        btn.addEventListener("click", () => {
          const next = single
            ? [day]
            : active.includes(day)
              ? active.filter((x) => x !== day)
              : [...active, day];
          d.daysOfWeek = csvJoin(WEEKDAYS.filter((x) => next.includes(x)));
          this.commit();
          this.render();
        });
        days.appendChild(btn);
      }
      body.appendChild(
        single
          ? this.row("Day of week", days, "The one day this meeting runs on.")
          : this.row("Days of week", days, "None selected = every day.")
      );
    }
    if (isAnchored(d.category)) {
      body.appendChild(
        this.row(
          "First occurrence",
          this.textInput(d.baseStartDate, (v) => (d.baseStartDate = v), "", "date"),
          d.category === "fortnightly"
            ? "Anchors which alternating week — occurrences fall in the same week as this date, every second week."
            : "The recurrence projects forward from this date — e.g. its 2nd Tuesday repeats every " +
                (d.category === "monthly" ? "month." : d.category === "quarterly" ? "quarter." : "year.")
        )
      );
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

    // topic rotation: weekly rotates through the month, daily/shiftly by day
    if (d.category === "weekly") {
      const box = el("div", "ltk-mw-people");
      const ORDINALS = ["1st week", "2nd week", "3rd week", "4th week", "5th week"];
      ORDINALS.forEach((label, i) => {
        const row = el("div", "ltk-mw-person");
        row.appendChild(el("span", "ltk-mw-topic-ordinal", label));
        const input = el("input", "ltk-mw-input") as HTMLInputElement;
        input.type = "text";
        input.value = this.draft.weekTopics[i] ?? "";
        input.placeholder = i === 4 ? "Only when the month has a 5th" : "e.g. Safety focus";
        input.disabled = this.readOnly;
        input.addEventListener("change", () => {
          while (this.draft.weekTopics.length <= i) this.draft.weekTopics.push("");
          this.draft.weekTopics[i] = input.value.trim();
          this.commit();
        });
        row.appendChild(input);
        box.appendChild(row);
      });
      body.appendChild(
        this.row(
          "Topic rotation",
          box,
          "Optional — the meeting topic for the 1st to 5th occurrence each month; shown on every scheduler row."
        )
      );
    }
    if (isRostered(d.category)) {
      const active = csvItems(d.daysOfWeek);
      const scope = active.length > 0 ? active : WEEKDAYS;
      const box = el("div", "ltk-mw-people");
      for (const day of scope) {
        const row = el("div", "ltk-mw-person");
        row.appendChild(el("span", "ltk-mw-topic-ordinal", day));
        const input = el("input", "ltk-mw-input") as HTMLInputElement;
        input.type = "text";
        input.value = this.draft.dayTopics[day] ?? "";
        input.placeholder = "e.g. Quality focus";
        input.disabled = this.readOnly;
        input.addEventListener("change", () => {
          const v = input.value.trim();
          if (v === "") delete this.draft.dayTopics[day];
          else this.draft.dayTopics[day] = v;
          this.commit();
        });
        row.appendChild(input);
        box.appendChild(row);
      }
      body.appendChild(
        this.row(
          "Topics by day",
          box,
          "Optional — the meeting topic for each day it runs; shown on every scheduler row."
        )
      );
    }
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
    // standard patterns from the site's library, custom as the fallback
    const sitePatterns = this.rosterPatterns[d.org.site] ?? [];
    if (sitePatterns.length > 0 && !this.readOnly) {
      const pick = el("select", "ltk-mw-input") as HTMLSelectElement;
      const mk = (value: string, label: string) => {
        const o = el("option", "", label) as HTMLOptionElement;
        o.value = value;
        pick.appendChild(o);
      };
      mk("", "Custom\u2026");
      for (const sp of sitePatterns) mk(sp.pattern, `${sp.name} (${sp.pattern})`);
      const match = sitePatterns.find((sp) => sp.pattern === d.rosterPattern);
      pick.value = match ? match.pattern : "";
      pick.addEventListener("change", () => {
        if (pick.value !== "") {
          d.rosterPattern = pick.value;
          this.commit();
          this.render();
        }
      });
      body.appendChild(this.row("Standard pattern", pick, "From this site's settings."));
    }
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

  /**
   * Participants: the chosen people pinned on top (crew select + remove),
   * a search over the roster below — built for org-scale rosters, so
   * results are capped and refreshed IN PLACE (the search input is never
   * rebuilt, keeping focus while typing).
   */
  private renderPeople(body: HTMLElement): void {
    const d = this.draft;
    const crews = csvItems(d.crewList);
    const MAX_RESULTS = 25;

    const selectedBox = el("div", "ltk-mw-people");
    const resultsBox = el("div", "ltk-mw-people");
    const countNote = el("div", "ltk-mw-people-count");

    const refreshSelected = () => {
      clear(selectedBox);
      if (d.participants.length === 0) {
        selectedBox.appendChild(
          el("div", "ltk-mw-help", "No one selected yet — search the roster below.")
        );
        return;
      }
      for (const p of d.participants) {
        const row = el("div", "ltk-mw-person");
        row.appendChild(el("span", "ltk-mw-person-name", p.who));
        if (crews.length > 0) {
          const crewSel = this.selectInput(
            p.crew,
            [
              { value: "", label: "Every meeting" },
              ...crews.map((c) => ({ value: c, label: `Crew ${c}` })),
            ],
            (v) => (p.crew = v)
          );
          crewSel.classList.add("ltk-mw-person-crew");
          row.appendChild(crewSel);
        }
        if (!this.readOnly) {
          const remove = el("button", "ltk-mw-person-x", "×") as HTMLButtonElement;
          remove.type = "button";
          remove.title = "Remove";
          remove.addEventListener("click", () => {
            d.participants = d.participants.filter((x) => x.whoId !== p.whoId);
            this.commit();
            refreshSelected();
            refreshResults();
          });
          row.appendChild(remove);
        }
        selectedBox.appendChild(row);
      }
    };

    const refreshResults = () => {
      clear(resultsBox);
      countNote.textContent = "";
      if (this.readOnly) return;
      const q = this.peopleQuery.trim().toLowerCase();
      const pool = this.people.filter(
        (p) =>
          !d.participants.some((x) => x.whoId === p.whoId) &&
          (q === "" || p.who.toLowerCase().includes(q))
      );
      for (const p of pool.slice(0, MAX_RESULTS)) {
        const row = el("div", "ltk-mw-result");
        row.appendChild(el("span", "ltk-mw-result-add", "＋"));
        row.appendChild(el("span", "ltk-mw-person-name", p.who));
        if (p.crew) row.appendChild(el("span", "ltk-mw-result-crew", `Crew ${p.crew}`));
        row.addEventListener("click", () => {
          d.participants.push({ whoId: p.whoId, who: p.who, crew: p.crew ?? "" });
          this.commit();
          refreshSelected();
          refreshResults();
        });
        resultsBox.appendChild(row);
      }
      if (pool.length > MAX_RESULTS) {
        countNote.textContent = `Showing ${MAX_RESULTS} of ${pool.length} — keep typing to narrow.`;
      } else if (pool.length === 0 && q !== "") {
        countNote.textContent = "No roster match — add them by name below.";
      }
    };

    body.appendChild(this.row("Participants", selectedBox));

    if (this.people.length > 0 && !this.readOnly) {
      const search = el("input", "ltk-mw-input") as HTMLInputElement;
      search.type = "search";
      search.placeholder = `Search ${this.people.length} people…`;
      search.value = this.peopleQuery;
      search.addEventListener("input", () => {
        this.peopleQuery = search.value;
        refreshResults();
      });
      const searchWrap = el("div", "ltk-mw-row");
      searchWrap.appendChild(el("label", "ltk-mw-label", "Add from the roster"));
      searchWrap.append(search, resultsBox, countNote);
      body.appendChild(searchWrap);
    }

    if (!this.readOnly) {
      const adder = el("input", "ltk-mw-input") as HTMLInputElement;
      adder.type = "text";
      adder.placeholder = "Someone outside the roster…";
      adder.addEventListener("change", () => {
        const name = adder.value.trim();
        if (name === "") return;
        const whoId = name.toLowerCase().replace(/\s+/g, "-");
        if (!d.participants.some((x) => x.whoId === whoId)) {
          d.participants.push({ whoId, who: name, crew: "" });
          this.commit();
          refreshSelected();
          refreshResults();
        }
        adder.value = "";
      });
      body.appendChild(this.row("Add by name", adder));
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

    refreshSelected();
    refreshResults();
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

    const adj = el("input", "") as HTMLInputElement;
    adj.type = "checkbox";
    adj.checked = this.draft.instancesAdjustable;
    adj.disabled = this.readOnly;
    adj.addEventListener("change", () => {
      this.draft.instancesAdjustable = adj.checked;
      this.commit();
    });
    const wrap = el("label", "ltk-mw-help");
    wrap.append(adj, " Participants can adjust individual meeting instances (add ad-hoc cards)");
    body.appendChild(wrap);
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
    if (hasWeekdays(d.category)) {
      add(
        isSingleDay(d.category) ? "Day" : "Days",
        d.daysOfWeek || (isSingleDay(d.category) ? "" : "Every day")
      );
    }
    if (isAnchored(d.category)) add("First occurrence", d.baseStartDate);
    add("Time", d.timeOfDay);
    if (isRostered(d.category)) {
      add("Crews", d.crewList);
      add("Roster", d.rosterPattern);
      add("First day shift", d.baseStartDate);
    }
    if (d.category === "weekly" && d.weekTopics.some((t) => t.trim() !== "")) {
      const ords = ["1st", "2nd", "3rd", "4th", "5th"];
      add(
        "Topic rotation",
        d.weekTopics
          .map((t, i) => (t.trim() !== "" ? `${ords[i]}: ${t.trim()}` : ""))
          .filter((v) => v !== "")
          .join(" · ")
      );
    }
    if (isRostered(d.category) && Object.keys(d.dayTopics).length > 0) {
      add(
        "Topics by day",
        WEEKDAYS.filter((day) => d.dayTopics[day])
          .map((day) => `${day}: ${d.dayTopics[day]}`)
          .join(" · ")
      );
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
