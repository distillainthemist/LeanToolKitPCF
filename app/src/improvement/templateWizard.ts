// Improvement — the initiative template wizard (design review 11a): the
// meeting wizard's shell, seven steps — Basics · Stages & gates · Roles ·
// Fields · Metrics · Initiative board · Review. Gates are boundaries
// between stages (indented rows in the gaps), the Complete gate is always
// shown last, the live stepper at the top of step 2 is the same chevron
// row the initiative board renders, and the amber note states the
// propagation rule. The Initiative board step opens the composer as an
// overlay on the template's board and tags each slot with stage +
// mandatory. Route: #/template/<id|new>; cancel → Settings → Improvement.

import { el, clear } from "../../../shared/ui/dom";
import { newId } from "../../../shared/schema/id";
import { appTheme, editorHost } from "../cardHost";
import { showLoading } from "../loading";
import { currentViewer, detectHost } from "../runtime";
import { promptConfirm } from "../prompts";
import { viewerPerson } from "../store/people";
import { companies, improvementSettingsJson, saveImprovementSettingsJson } from "../store/config";
import { getBoard, saveManifest } from "../store/boards";
import { parseManifest } from "../store/mappers";
import { deleteTemplate, ensureTemplateBoard, getTemplate, listTemplates, saveTemplate } from "../store/templates";
import { cardLabel } from "../../../controls/CardSettings/registry";
import { createWizardShell } from "./wizardShell";
import {
  FieldKind,
  Gate,
  GoodDirection,
  InitiativeTemplate,
  ImprovementSettings,
  keyFor,
  newTemplate,
  parseImprovementSettings,
  presetStages,
  serializeImprovementSettings,
  Pdca,
  PDCA_ORDER,
  PDCA_TOKENS,
  propagationNote,
  slotFlags,
  stepperChips,
  TemplateStage,
  Tracking,
  validateTemplate,
  withSlotFlags,
} from "./templateModel";

const btn = (label: string, cls = "ltk-mw-btn"): HTMLButtonElement => {
  const b = el("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  return b;
};

function row(label: string, input: HTMLElement, help?: string): HTMLElement {
  const r = el("div", "ltk-mw-row");
  r.appendChild(el("label", "ltk-mw-label", label));
  r.appendChild(input);
  if (help) r.appendChild(el("div", "ltk-mw-help", help));
  return r;
}

function textInput(value: string, onChange: (v: string) => void, placeholder = "", type = "text"): HTMLInputElement {
  const input = el("input", "ltk-mw-input") as HTMLInputElement;
  input.type = type;
  input.value = value;
  input.placeholder = placeholder;
  input.addEventListener("change", () => onChange(input.value.trim()));
  return input;
}

function selectInput(value: string, options: { value: string; label: string }[], onChange: (v: string) => void, cls = "ltk-mw-input"): HTMLSelectElement {
  const select = el("select", cls) as HTMLSelectElement;
  for (const opt of options) {
    const o = el("option", undefined, opt.label) as HTMLOptionElement;
    o.value = opt.value;
    select.appendChild(o);
  }
  select.value = value;
  if (select.value !== value) select.value = options[0]?.value ?? "";
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

function toggle(on: boolean, onChange: (v: boolean) => void, title = ""): HTMLButtonElement {
  const b = btn("", "app-tw-toggle" + (on ? " app-tw-toggle-on" : ""));
  b.setAttribute("role", "switch");
  b.setAttribute("aria-checked", String(on));
  b.title = title;
  b.appendChild(el("span", "app-tw-toggle-knob"));
  b.addEventListener("click", () => onChange(!on));
  return b;
}

/** A PDCA chip (read-only) or select (editable). */
function pdcaChip(p: Pdca): HTMLElement {
  const c = el("span", "app-tw-pdca", PDCA_TOKENS[p].label);
  c.style.color = PDCA_TOKENS[p].fg;
  c.style.background = PDCA_TOKENS[p].bg;
  return c;
}

export function mountTemplateWizard(parent: HTMLElement, templateId: string): () => void {
  const host = editorHost(parent);
  host.style.position = "relative";
  const cancel = el("a", "app-wizard-cancel", "✕") as HTMLAnchorElement;
  cancel.href = "#/settings/improvement";
  cancel.title = "Cancel and return to Improvement settings";
  host.appendChild(cancel);
  const stopLoading = showLoading(host);
  let dead = false;
  const cleanups: (() => void)[] = [];

  void (async () => {
    const hosted = await detectHost();
    const viewer = currentViewer();
    const me = hosted && viewer ? await viewerPerson(viewer.objectId) : null;
    if (dead) return;
    stopLoading();
    if (!hosted || me?.role !== "superadmin") {
      host.appendChild(el("div", "app-board-note", "Only super admins author initiative templates."));
      return;
    }
    const isNew = templateId === "" || templateId === "new";
    const existing = isNew ? null : await getTemplate(templateId);
    if (!isNew && !existing) {
      host.appendChild(el("p", "app-missing", `Unknown template: ${templateId}`));
      return;
    }
    const all = await listTemplates();
    const t: InitiativeTemplate = existing ?? newTemplate(newId("tpl"));
    if (isNew) t.order = all.length + 1;
    const companyList = await companies();
    const imp = parseImprovementSettings(await improvementSettingsJson());
    // app-level standard roles ride every template (addable; label edits stay template-local)
    const usage = 0; // initiatives arrive with P5; the note reads "No initiatives…" until then
    let dirty = false;
    const mark = () => {
      dirty = true;
    };

    // ---- step 1: Basics ------------------------------------------------------------
    const basics = (form: HTMLElement) => {
      form.appendChild(row("Name", textInput(t.name, (v) => (t.name = v), "e.g. A3 problem solving"), "How it reads in the template picker."));
      // the method list is app configuration (Settings → Improvement → Methods)
      const methodOpts = [...imp.methods, ...(imp.methods.includes(t.method) || t.method === "" ? [] : [t.method])].map((m) => ({ value: m, label: m }));
      const methodSel = selectInput(t.method || methodOpts[0]?.value || "", methodOpts, (v) => {
        {
          t.method = v;
          if (v === "Single action") {
            t.singleAction = true;
            shell.refresh();
          } else {
            const preset = presetStages(v);
            // offer the method's standard stages as a starting point (1.1b);
            // declining leaves the stages as they are
            if (preset.length > 0) {
              void promptConfirm({
                title: `Start from ${v}'s ${preset.length} stages?`,
                note: preset.map((p) => p.name).join(" › ") + (t.stages.length > 0 ? " — replaces the stages set so far (gates reset)." : ""),
                confirmLabel: "Use these stages",
              }).then((yes) => {
                if (!yes) return;
                t.stages = preset;
                mark();
                shell.refresh();
              });
            }
          }
        }
        mark();
      });
      form.appendChild(row("Method", methodSel, "The problem-solving or project method this template encodes. The list is managed in Settings → Improvement."));
      const desc = el("textarea", "ltk-mw-input") as HTMLTextAreaElement;
      desc.rows = 3;
      desc.value = t.description;
      desc.placeholder = "When to use this template, in a sentence or two.";
      desc.addEventListener("change", () => {
        t.description = desc.value.trim();
        mark();
      });
      form.appendChild(row("Description", desc));
      const single = el("div", "app-tw-inline");
      single.append(
        toggle(t.singleAction, (v) => {
          t.singleAction = v;
          mark();
          shell.refresh();
        }),
        el("span", undefined, "Single action — header + actions only, no board or stages")
      );
      form.appendChild(row("Kind", single, "A lightweight initiative: one owner, one action list. Stages, metrics and the board steps are skipped."));
      if (companyList.length > 1) {
        form.appendChild(
          row(
            "Company",
            selectInput(t.company, [{ value: "", label: "All companies" }, ...companyList.map((c) => ({ value: c, label: c }))], (v) => {
              t.company = v;
              mark();
            }),
            "Offer this template everywhere, or to one company only."
          )
        );
      }
      const active = el("div", "app-tw-inline");
      active.append(
        toggle(t.active, (v) => {
          t.active = v;
          mark();
        }),
        el("span", undefined, "Active — offered when creating an initiative (off = retired: hidden from the picker, live boards untouched)")
      );
      form.appendChild(row("Availability", active));
    };

    // ---- step 2: Stages & gates ------------------------------------------------------
    const gateRow = (gate: Gate, label: string, note?: string): HTMLElement => {
      const r = el("div", "app-tw-gate");
      r.appendChild(el("span", "app-tw-gate-label", "Gate"));
      r.appendChild(
        toggle(gate.enabled, (v) => {
          gate.enabled = v;
          if (v && gate.approverRoles.length === 0) gate.approverRoles = ["sponsor"];
          mark();
          shell.refresh();
        }, label)
      );
      r.appendChild(el("span", "app-tw-gate-label", "Approvers"));
      if (gate.enabled) {
        for (const key of gate.approverRoles) {
          const role = t.roles.find((x) => x.key === key);
          const chip = el("span", "ltk-mw-chip", role?.label ?? key);
          const x = btn("×", "ltk-mw-chip-x");
          x.addEventListener("click", () => {
            gate.approverRoles = gate.approverRoles.filter((k) => k !== key);
            mark();
            shell.refresh();
          });
          chip.appendChild(x);
          r.appendChild(chip);
        }
        const addable = t.roles.filter((x) => !gate.approverRoles.includes(x.key));
        if (addable.length > 0) {
          const add = selectInput("", [{ value: "", label: "Add…" }, ...addable.map((x) => ({ value: x.key, label: x.label }))], (v) => {
            if (v === "") return;
            gate.approverRoles.push(v);
            mark();
            shell.refresh();
          }, "ltk-mw-input app-tw-gate-add");
          r.appendChild(add);
        }
      } else {
        r.appendChild(el("span", "ltk-mw-help", "off — moves through without approval"));
      }
      if (note) r.appendChild(el("span", "ltk-mw-help app-tw-gate-note", note));
      return r;
    };

    const stageRow = (s: TemplateStage, i: number, cardCount: number): HTMLElement => {
      const r = el("div", "app-tw-stage");
      const arrows = el("span", "app-tw-arrows");
      const up = btn("▲", "app-pr-arrow");
      up.disabled = i === 0;
      up.addEventListener("click", () => {
        const [m] = t.stages.splice(i, 1);
        t.stages.splice(i - 1, 0, m);
        mark();
        shell.refresh();
      });
      const down = btn("▼", "app-pr-arrow");
      down.disabled = i === t.stages.length - 1;
      down.addEventListener("click", () => {
        const [m] = t.stages.splice(i, 1);
        t.stages.splice(i + 1, 0, m);
        mark();
        shell.refresh();
      });
      arrows.append(up, down);
      r.appendChild(arrows);
      const name = textInput(s.name, (v) => {
        s.name = v;
        mark();
        shell.refresh();
      }, "Stage name");
      name.classList.add("app-tw-stage-name");
      r.appendChild(name);
      const pd = selectInput(s.pdca, PDCA_ORDER.map((p) => ({ value: p, label: PDCA_TOKENS[p].label })), (v) => {
        s.pdca = v as Pdca;
        mark();
        shell.refresh();
      }, "ltk-mw-input app-tw-pdca-sel");
      pd.style.color = PDCA_TOKENS[s.pdca].fg;
      pd.style.background = PDCA_TOKENS[s.pdca].bg;
      r.appendChild(pd);
      const tgt = el("span", "app-tw-target");
      tgt.appendChild(el("span", "ltk-mw-help", "target"));
      const weeks = textInput(s.targetWeeks === null ? "" : String(s.targetWeeks), (v) => {
        const n = Number(v);
        s.targetWeeks = v === "" || !Number.isFinite(n) || n <= 0 ? null : Math.round(n);
        mark();
      }, "—", "number");
      weeks.classList.add("app-tw-weeks");
      weeks.min = "1";
      tgt.append(weeks, el("span", "ltk-mw-help", "weeks"));
      r.appendChild(tgt);
      r.appendChild(el("span", "app-tw-cards", `${cardCount} card${cardCount === 1 ? "" : "s"}`));
      const del = btn("×", "ltk-mw-chip-x app-tw-stage-x");
      const tagged = slotCountByStage[s.id] ?? 0;
      del.title = tagged > 0 ? `${tagged} card${tagged === 1 ? " is" : "s are"} tagged to this stage — retag them (step 6) before removing it` : "Remove stage";
      del.disabled = tagged > 0;
      del.addEventListener("click", () => {
        t.stages.splice(i, 1);
        mark();
        shell.refresh();
      });
      r.appendChild(del);
      return r;
    };

    let slotCountByStage: Record<string, number> = {};
    const refreshSlotCounts = async () => {
      slotCountByStage = {};
      if (t.boardId === "") return;
      const b = await getBoard(t.boardId);
      if (!b) return;
      for (const slot of parseManifest(b.manifestRaw).slots) {
        const f = slotFlags(slot.settings);
        slotCountByStage[f.stage] = (slotCountByStage[f.stage] ?? 0) + 1;
      }
    };

    const stages = (form: HTMLElement) => {
      if (t.singleAction) {
        form.appendChild(el("div", "app-board-note", "Single-action templates have no stages — an initiative is just its header and action list."));
        return;
      }
      // the live stepper: the same chevron row the initiative board renders
      const prev = el("div", "app-tw-preview");
      prev.appendChild(el("div", "app-tw-preview-h", "The stepper owners will see"));
      const strip = el("div", "app-tw-stepper");
      for (const c of stepperChips(t)) {
        const chip = el("span", "app-tw-step" + (c.pdca === null ? " app-tw-step-complete" : ""), `${c.gated ? "⚑ " : ""}${c.label || "—"}`);
        if (c.pdca !== null) {
          chip.style.color = PDCA_TOKENS[c.pdca].fg;
          chip.style.background = PDCA_TOKENS[c.pdca].bg;
        }
        strip.appendChild(chip);
      }
      prev.appendChild(strip);
      prev.appendChild(el("div", "ltk-mw-help", "Updates as you edit below. ⚑ marks a boundary that needs approval."));
      form.appendChild(prev);

      const list = el("div", "app-tw-stages");
      t.stages.forEach((s, i) => {
        list.appendChild(stageRow(s, i, (slotCountByStage[s.id] ?? 0) + (i === 0 ? (slotCountByStage[""] ?? 0) : 0)));
        // the gate AFTER this stage, indented in the gap; the last stage's
        // boundary IS the complete gate, rendered below "Add stage"
        if (i < t.stages.length - 1) list.appendChild(gateRow(s.gate, `Gate between ${s.name} and ${t.stages[i + 1].name}`));
      });
      const add = btn("＋ Add stage", "app-tw-addstage");
      add.addEventListener("click", () => {
        const taken = t.stages.map((x) => x.id);
        const above = t.stages[t.stages.length - 1];
        t.stages.push({ id: keyFor("st_" + (t.stages.length + 1), taken), name: "", pdca: above?.pdca ?? "plan", targetWeeks: null, gate: { enabled: false, approverRoles: [] } });
        mark();
        shell.refresh();
        setTimeout(() => form.querySelectorAll<HTMLInputElement>(".app-tw-stage-name")[t.stages.length - 1]?.focus(), 0);
      });
      list.appendChild(add);
      list.appendChild(gateRow(t.completeGate, "Complete gate", "the last boundary is always shown, gated or not"));
      form.appendChild(list);

      form.appendChild(amberNote());
    };
    const amberNote = (): HTMLElement => {
      const p = propagationNote(usage);
      const note = el("div", "app-tw-propagation");
      note.appendChild(el("strong", undefined, p.headline + " "));
      note.appendChild(el("span", undefined, `${p.reach} ${p.newOnly}`));
      return note;
    };

    // ---- step 3: Roles ----------------------------------------------------------------
    const roles = (form: HTMLElement) => {
      const list = el("div", "app-tw-table");
      const head = el("div", "app-tw-tr app-tw-th");
      head.append(el("span", undefined, "Role"), el("span", undefined, "People"), el("span", undefined, "Time commitment"), el("span", undefined, ""));
      list.appendChild(head);
      t.roles.forEach((r, i) => {
        const tr = el("div", "app-tw-tr");
        const label = textInput(r.label, (v) => {
          r.label = v || r.label;
          mark();
        });
        label.title = r.standard ? `Standard role (${r.key}) — the label is yours, the key is fixed` : r.key;
        tr.appendChild(label);
        tr.appendChild(
          selectInput(r.multi ? "multi" : "single", [{ value: "single", label: "One person" }, { value: "multi", label: "Several" }], (v) => {
            r.multi = v === "multi";
            mark();
          })
        );
        const tc = el("div", "app-tw-inline");
        tc.append(
          toggle(r.timeCommitment, (v) => {
            r.timeCommitment = v;
            mark();
          }),
          el("span", "ltk-mw-help", r.timeCommitment ? "asked" : "not asked")
        );
        tr.appendChild(tc);
        const x = btn("×", "ltk-mw-chip-x");
        const referenced = [...t.stages.map((s) => s.gate), t.completeGate].some((g) => g.approverRoles.includes(r.key));
        x.disabled = r.standard || referenced;
        x.title = r.standard ? "Standard roles stay" : referenced ? "A gate names this role — remove it from the gate first (step 2)" : "Remove role";
        x.addEventListener("click", () => {
          t.roles.splice(i, 1);
          mark();
          shell.refresh();
        });
        tr.appendChild(x);
        list.appendChild(tr);
      });
      form.appendChild(list);
      // app-level standard roles (Settings → Improvement) not yet on the template
      const missing = imp.standardRoles.filter((r) => !t.roles.some((x) => x.key === r.key));
      if (missing.length > 0) {
        const stdRow = el("div", "app-tw-inline");
        stdRow.appendChild(el("span", "ltk-mw-help", "Standard roles:"));
        for (const r of missing) {
          const chip = btn(`＋ ${r.label}`, "app-cp-l1chip app-tw-stdrole");
          chip.addEventListener("click", () => {
            t.roles.push({ ...r });
            mark();
            shell.refresh();
          });
          stdRow.appendChild(chip);
        }
        form.appendChild(row("Add a standard role", stdRow, "Company-wide roles from Settings → Improvement — e.g. a Finance lead who does financial approvals. Adding one makes it available to this template's gates."));
      }
      const adder = el("div", "app-tw-inline");
      const input = textInput("", () => undefined, "e.g. Union rep");
      const add = btn("＋ Add role", "ltk-mw-btn");
      add.addEventListener("click", () => {
        const v = input.value.trim();
        if (v === "") return;
        t.roles.push({ key: keyFor(v, t.roles.map((x) => x.key)), label: v, standard: false, multi: true, timeCommitment: false });
        input.value = "";
        mark();
        shell.refresh();
      });
      adder.append(input, add);
      form.appendChild(row("Template role", adder, "Roles only this template needs. Every role can hold several people when its People setting says so."));
    };

    // ---- step 4: Fields -----------------------------------------------------------------
    const fields = (form: HTMLElement) => {
      const KINDS: { value: FieldKind; label: string }[] = [
        { value: "text", label: "Text" },
        { value: "number", label: "Number" },
        { value: "date", label: "Date" },
        { value: "picklist", label: "Picklist" },
        { value: "person", label: "Person" },
      ];
      const list = el("div", "app-tw-table");
      const head = el("div", "app-tw-tr app-tw-th");
      head.append(el("span", undefined, "Field"), el("span", undefined, "Kind"), el("span", undefined, "Required"), el("span", undefined, ""));
      list.appendChild(head);
      t.fields.forEach((f, i) => {
        const tr = el("div", "app-tw-tr");
        tr.appendChild(textInput(f.label, (v) => {
          f.label = v || f.label;
          mark();
        }));
        tr.appendChild(
          selectInput(f.kind, KINDS, (v) => {
            f.kind = v as FieldKind;
            mark();
            shell.refresh();
          })
        );
        const req = el("div", "app-tw-inline");
        req.append(toggle(f.required, (v) => {
          f.required = v;
          mark();
        }));
        tr.appendChild(req);
        const x = btn("×", "ltk-mw-chip-x");
        x.addEventListener("click", () => {
          t.fields.splice(i, 1);
          mark();
          shell.refresh();
        });
        tr.appendChild(x);
        list.appendChild(tr);
        if (f.kind === "picklist") {
          const opts = el("div", "app-tw-tr app-tw-sub");
          const input = textInput(f.options.join(", "), (v) => {
            f.options = v.split(",").map((x) => x.trim()).filter((x) => x !== "");
            mark();
          }, "Option A, Option B, …");
          opts.appendChild(row("Options", input));
          list.appendChild(opts);
        }
      });
      form.appendChild(list);
      const adder = el("div", "app-tw-inline");
      const input = textInput("", () => undefined, "e.g. Cost centre");
      const add = btn("＋ Add field", "ltk-mw-btn");
      add.addEventListener("click", () => {
        const v = input.value.trim();
        if (v === "") return;
        t.fields.push({ key: keyFor(v, t.fields.map((x) => x.key)), label: v, kind: "text", options: [], required: false });
        input.value = "";
        mark();
        shell.refresh();
      });
      adder.append(input, add);
      form.appendChild(row("Custom header field", adder, "Extra fields on the initiative header beyond title, org, priorities, roles and period. The charter can bind them."));
    };

    // ---- step 5: Metrics --------------------------------------------------------------
    const metrics = (form: HTMLElement) => {
      if (t.singleAction) {
        form.appendChild(el("div", "app-board-note", "Single-action templates carry no metrics."));
        return;
      }
      const DIRS: { value: GoodDirection; label: string }[] = [
        { value: "up", label: "Higher is better" },
        { value: "down", label: "Lower is better" },
        { value: "range", label: "Within limits" },
      ];
      const TRACK: { value: Tracking; label: string }[] = [
        { value: "value", label: "Value vs target" },
        { value: "goodbad", label: "Good / bad" },
        { value: "picklist", label: "Status picklist" },
      ];
      const list = el("div", "app-tw-table");
      const head = el("div", "app-tw-tr app-tw-th app-tw-tr-metrics");
      head.append(el("span", undefined, "Metric"), el("span", undefined, "Unit"), el("span", undefined, "Target"), el("span", undefined, "Good"), el("span", undefined, "Tracking"), el("span", undefined, ""));
      list.appendChild(head);
      t.metrics.forEach((m, i) => {
        const tr = el("div", "app-tw-tr app-tw-tr-metrics");
        tr.appendChild(textInput(m.name, (v) => {
          m.name = v || m.name;
          mark();
        }));
        tr.appendChild(textInput(m.unit, (v) => {
          m.unit = v;
          mark();
        }, "%, $, mins"));
        tr.appendChild(textInput(m.target === null ? "" : String(m.target), (v) => {
          const n = Number(v);
          m.target = v === "" || !Number.isFinite(n) ? null : n;
          mark();
        }, "—", "number"));
        tr.appendChild(selectInput(m.goodDirection, DIRS, (v) => {
          m.goodDirection = v as GoodDirection;
          mark();
        }));
        tr.appendChild(selectInput(m.tracking, TRACK, (v) => {
          m.tracking = v as Tracking;
          mark();
        }));
        const x = btn("×", "ltk-mw-chip-x");
        x.addEventListener("click", () => {
          t.metrics.splice(i, 1);
          mark();
          shell.refresh();
        });
        tr.appendChild(x);
        list.appendChild(tr);
      });
      form.appendChild(list);
      const adder = el("div", "app-tw-inline");
      const input = textInput("", () => undefined, "e.g. OEE");
      const add = btn("＋ Add metric", "ltk-mw-btn");
      add.addEventListener("click", () => {
        const v = input.value.trim();
        if (v === "") return;
        t.metrics.push({ key: keyFor(v, t.metrics.map((x) => x.key)), name: v, unit: "", target: null, goodDirection: "up", tracking: "value" });
        input.value = "";
        mark();
        shell.refresh();
      });
      adder.append(input, add);
      form.appendChild(row("Mandatory metric", adder, "Every initiative on this template carries these; owners add their own on top. Each needs a target before save. VDT links come with the value driver tree."));
      form.appendChild(amberNote());
    };

    // ---- step 6: Initiative board — INLINE designer, the meeting wizard's
    // pattern (Ben, 2026-08-19): the composer's designer mounts inside the
    // step in a .ltk-mw-boardhost (the wizard CSS widens the column), built
    // once and re-attached so board edits survive step navigation.
    let designerDiv: HTMLDivElement | null = null;
    let designerCleanup: (() => void) | null = null;
    const boardStep = (form: HTMLElement) => {
      if (t.singleAction) {
        form.appendChild(el("div", "app-board-note", "Single-action templates have no board."));
        return;
      }
      const hostBox = el("div", "ltk-mw-boardhost");
      form.appendChild(hostBox);
      hostBox.appendChild(
        el("div", "ltk-mw-help", "The cards every initiative on this template starts with. Lay them out below, then tag each with its stage and whether it is mandatory (the charter always is).")
      );
      const slotsBox = el("div", "app-tw-table app-tw-slots");
      if (designerDiv) {
        hostBox.appendChild(designerDiv);
      } else {
        designerDiv = document.createElement("div");
        designerDiv.className = "app-wizard-designer";
        hostBox.appendChild(designerDiv);
        void (async () => {
          if (t.boardId === "") {
            if (t.name.trim() === "") {
              designerDiv!.appendChild(el("div", "app-board-note", "Name the template (step 1) first — the board is created under that name."));
              designerDiv = null;
              return;
            }
            const note = el("div", "app-board-note", "Creating the template board…");
            designerDiv!.appendChild(note);
            t.boardId = await ensureTemplateBoard(t);
            await saveTemplate(t); // the board id must survive an abandoned wizard
            note.remove();
          }
          const stop = showLoading(designerDiv!);
          try {
            const { mountDesigner } = await import("../screens/composer");
            designerCleanup = await mountDesigner(designerDiv!, t.boardId);
          } finally {
            stop();
          }
          await refreshSlotCounts();
          paintSlotsInto(slotsBox);
        })();
      }
      hostBox.appendChild(slotsBox);
      paintSlotsInto(slotsBox);
    };

    function paintSlotsInto(slotsBox: HTMLElement) {
      void (async () => {
        clear(slotsBox);
        if (t.boardId === "") return;
        const b = await getBoard(t.boardId);
        if (!b) return;
        const manifest = parseManifest(b.manifestRaw);
        if (manifest.slots.length === 0) {
          slotsBox.appendChild(el("div", "ltk-mw-help", "The board is empty — add cards above."));
          return;
        }
        const head = el("div", "app-tw-tr app-tw-th app-tw-tr-slots");
        head.append(el("span", undefined, "Card"), el("span", undefined, "Stage"), el("span", undefined, "Mandatory"));
        slotsBox.appendChild(head);
        const stageOpts = [{ value: "", label: "Every stage" }, ...t.stages.map((st) => ({ value: st.id, label: st.name || st.id }))];
        for (const slot of manifest.slots) {
          const f = slotFlags(slot.settings);
          const tr = el("div", "app-tw-tr app-tw-tr-slots");
          tr.appendChild(el("span", undefined, `${slot.title || cardLabel(slot.cardType)} · ${cardLabel(slot.cardType)}`));
          tr.appendChild(
            selectInput(f.stage, stageOpts, (v) => {
              slot.settings = withSlotFlags(slot.settings, { ...slotFlags(slot.settings), stage: v });
              void saveManifest(b.id, manifest).then(() => refreshSlotCounts());
            })
          );
          const isCharter = slot.cardType === "CanvasCard" && manifest.slots.filter((x) => x.cardType === "CanvasCard").indexOf(slot) === 0;
          const md = el("div", "app-tw-inline");
          md.append(
            toggle(f.mandatory || isCharter, (v) => {
              slot.settings = withSlotFlags(slot.settings, { ...slotFlags(slot.settings), mandatory: v });
              void saveManifest(b.id, manifest);
            }, isCharter ? "The charter is always mandatory" : ""),
            el("span", "ltk-mw-help", isCharter ? "charter — always" : f.mandatory ? "undeletable" : "optional")
          );
          if (isCharter) (md.firstChild as HTMLButtonElement).disabled = true;
          tr.appendChild(md);
          slotsBox.appendChild(tr);
        }
      })();
    }

    // ---- step 7: Review ----------------------------------------------------------------
    const review = (form: HTMLElement) => {
      const errs = validateTemplate(t);
      const stepFor = (e: string): string =>
        /name is needed/.test(e) ? "basics" : /stage|gate|approver/i.test(e) ? "stages" : /metric/i.test(e) ? "metrics" : /board/i.test(e) ? "board" : "basics";
      if (errs.length > 0) {
        const box = el("div", "app-tw-errors");
        box.appendChild(el("div", "app-tw-errors-h", "Save is blocked until these are resolved:"));
        for (const e of errs) {
          const line = btn(`• ${e} — fix ›`, "app-tw-errlink");
          line.addEventListener("click", () => shell.goTo(stepFor(e)));
          box.appendChild(line);
        }
        form.appendChild(box);
      }
      const add = (label: string, value: string, stepKey?: string) => {
        if (value === "") return;
        const r = el("div", "app-tw-review-row");
        r.append(el("span", "app-tw-review-k", label), el("span", "app-tw-review-v", value));
        if (stepKey) {
          r.classList.add("app-tw-review-link");
          r.title = "Edit";
          r.addEventListener("click", () => shell.goTo(stepKey));
        }
        form.appendChild(r);
      };
      add("Name", t.name, "basics");
      add("Method", t.method + (t.singleAction ? " · single action" : ""), "basics");
      add("Description", t.description, "basics");
      if (!t.singleAction) {
        const gatedCount = t.stages.filter((s) => s.gate.enabled).length + (t.completeGate.enabled ? 1 : 0);
        add("Stages", `${t.stages.length} · ${gatedCount} gated — ` + stepperChips(t).map((c) => `${c.gated ? "⚑ " : ""}${c.label}`).join(" › "), "stages");
        add("Mandatory metrics", t.metrics.length === 0 ? "none" : t.metrics.map((m) => `${m.name}${m.unit ? ` (${m.unit})` : ""}${m.target !== null ? ` → ${m.target}` : ""}`).join(" · "), "metrics");
      }
      add("Roles", t.roles.map((r) => r.label + (r.multi ? " (several)" : "")).join(" · "), "roles");
      add("Fields", t.fields.length === 0 ? "none" : t.fields.map((f) => `${f.label} (${f.kind}${f.required ? ", required" : ""})`).join(" · "), "fields");
      add("Board", t.singleAction ? "none" : t.boardId !== "" ? `laid out (${Object.values(slotCountByStage).reduce((a, b) => a + b, 0)} cards)` : "not yet", "board");
      add("Company", t.company || "all", "basics");
      add("Availability", t.active ? "active" : "retired", "basics");
      form.appendChild(amberNote());
    };

    await refreshSlotCounts();
    if (dead) return;
    const shell = createWizardShell({
      host,
      title: isNew ? "New initiative template" : `Edit template — ${t.name}`,
      theme: appTheme(),
      steps: [
        { key: "basics", label: "Basics", description: "What this template is and when to use it.", render: basics },
        { key: "stages", label: "Stages & gates", description: "The path an initiative walks, and who signs off at each boundary.", render: stages },
        { key: "roles", label: "Roles", description: "Who holds what on an initiative; gates pick approvers from here.", render: roles },
        { key: "fields", label: "Fields", description: "Extra header fields the initiative carries.", render: fields },
        { key: "metrics", label: "Metrics", description: "Metrics every initiative on this template must track.", render: metrics },
        { key: "board", label: "Initiative board", description: "The cards an initiative starts with, tagged by stage.", render: boardStep },
        { key: "review", label: "Review", description: "Check, then save.", render: review },
      ],
      finalLabel: isNew ? "Create template" : "Save template",
      onFinal: () => {
        void (async () => {
          const errs = validateTemplate(t);
          if (errs.length > 0) {
            shell.goTo("review"); // the review lists what is unresolved, with links
            return;
          }
          await saveTemplate(t);
          dirty = false;
          window.location.hash = "#/settings/improvement";
        })();
      },
    });
    cleanups.push(() => shell.destroy());
    cleanups.push(() => designerCleanup?.());

    // leave guard
    cancel.addEventListener("click", (e) => {
      if (!dirty) return;
      e.preventDefault();
      void promptConfirm({ title: "Discard changes?", note: "The template edits made here will be lost.", confirmLabel: "Discard", danger: true }).then((yes) => {
        if (yes) {
          dirty = false;
          window.location.hash = "#/settings/improvement";
        }
      });
    });
  })().catch((err) => {
    stopLoading();
    host.appendChild(el("div", "app-board-note", `Template wizard could not load: ${err instanceof Error ? err.message : String(err)}`));
  });

  return () => {
    dead = true;
    for (const fn of cleanups) fn();
    host.remove();
  };
}

// ---- Settings → Improvement: the templates list ----------------------------------

export async function renderImprovementSettings(body: HTMLElement, isSuper: boolean): Promise<void> {
  clear(body);
  body.appendChild(
    el("div", "app-settings-note", "Initiative templates are the gate on everything in Improvement — method, stages and gates, roles, fields, mandatory metrics and the board an initiative starts from. Super admins author them; everyone picks from them when creating an initiative.")
  );

  // ---- app-level lists: methods + standard roles (Ben, 2026-08-19) ----
  const imp = parseImprovementSettings(await improvementSettingsJson());
  const persist = () => void saveImprovementSettingsJson(serializeImprovementSettings(imp));
  const section = (title: string, note: string): HTMLElement => {
    const box = el("div", "app-pr-section");
    box.appendChild(el("h3", "app-pr-h3", title));
    box.appendChild(el("div", "app-settings-note", note));
    body.appendChild(box);
    return box;
  };
  if (isSuper) {
    const mBox = section("Methods", "The problem-solving / project methods templates classify under — tracked even as templates change and version. Drag to reorder; the order is the picker's order.");
    const chips = el("div", "app-tw-inline app-tw-methods");
    let draggingMethod: number | null = null;
    const paintMethods = () => {
      clear(chips);
      imp.methods.forEach((m, i) => {
        const chip = el("span", "ltk-mw-chip app-tw-method", "");
        chip.appendChild(el("span", "app-drag-handle app-tw-method-handle", "⠿"));
        chip.appendChild(el("span", undefined, m));
        chip.draggable = true;
        chip.title = "Drag to reorder";
        chip.addEventListener("dragstart", (e) => {
          draggingMethod = i;
          chip.classList.add("app-dragging");
          e.dataTransfer?.setData("text/plain", m);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        });
        chip.addEventListener("dragend", () => {
          draggingMethod = null;
          chip.classList.remove("app-dragging");
        });
        const clearMarks = () => chip.classList.remove("app-tw-drop-left", "app-tw-drop-right");
        chip.addEventListener("dragover", (e) => {
          if (draggingMethod === null || draggingMethod === i) return;
          e.preventDefault();
          // a horizontal chip row: before/after by the pointer's X
          const r = chip.getBoundingClientRect();
          const after = e.clientX > r.left + r.width / 2;
          chip.classList.toggle("app-tw-drop-right", after);
          chip.classList.toggle("app-tw-drop-left", !after);
        });
        chip.addEventListener("dragleave", clearMarks);
        chip.addEventListener("drop", (e) => {
          clearMarks();
          if (draggingMethod === null || draggingMethod === i) return;
          e.preventDefault();
          const from = draggingMethod;
          draggingMethod = null;
          const r = chip.getBoundingClientRect();
          const after = e.clientX > r.left + r.width / 2;
          let to = i + (after ? 1 : 0);
          if (from < to) to--;
          const [moved] = imp.methods.splice(from, 1);
          imp.methods.splice(to, 0, moved);
          persist();
          paintMethods();
        });
        const x = el("button", "ltk-mw-chip-x", "×") as HTMLButtonElement;
        x.type = "button";
        x.title = "Remove (existing templates keep their method)";
        x.addEventListener("click", () => {
          imp.methods.splice(i, 1);
          persist();
          paintMethods();
        });
        chip.appendChild(x);
        chips.appendChild(chip);
      });
      const input = el("input", "app-input app-pr-short") as HTMLInputElement;
      input.placeholder = "Add method…";
      input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        const v = input.value.trim();
        if (v === "" || imp.methods.includes(v)) return;
        imp.methods.push(v);
        persist();
        paintMethods();
      });
      chips.appendChild(input);
    };
    paintMethods();
    mBox.appendChild(chips);

    const rBox = section("Standard roles", "Company-wide roles beyond the built-in five — e.g. a Finance lead who does financial approvals. Every template can add them as roles and gate approvers; people are assigned per initiative.");
    const roleList = el("div", "app-tw-table");
    const paintRoles = () => {
      clear(roleList);
      if (imp.standardRoles.length > 0) {
        const head = el("div", "app-tw-tr app-tw-th");
        head.append(el("span", undefined, "Role"), el("span", undefined, "People"), el("span", undefined, "Time commitment"), el("span", undefined, ""));
        roleList.appendChild(head);
      }
      imp.standardRoles.forEach((r, i) => {
        const tr = el("div", "app-tw-tr");
        const label = el("input", "ltk-mw-input") as HTMLInputElement;
        label.value = r.label;
        label.addEventListener("change", () => {
          r.label = label.value.trim() || r.label;
          persist();
        });
        tr.appendChild(label);
        const multi = el("select", "ltk-mw-input") as HTMLSelectElement;
        for (const [v, l] of [["multi", "Several"], ["single", "One person"]] as const) {
          const o = el("option", undefined, l) as HTMLOptionElement;
          o.value = v;
          multi.appendChild(o);
        }
        multi.value = r.multi ? "multi" : "single";
        multi.addEventListener("change", () => {
          r.multi = multi.value === "multi";
          persist();
        });
        tr.appendChild(multi);
        const tc = el("div", "app-tw-inline");
        const tcSel = el("select", "ltk-mw-input") as HTMLSelectElement;
        for (const [v, l] of [["off", "Not asked"], ["on", "Asked"]] as const) {
          const o = el("option", undefined, l) as HTMLOptionElement;
          o.value = v;
          tcSel.appendChild(o);
        }
        tcSel.value = r.timeCommitment ? "on" : "off";
        tcSel.addEventListener("change", () => {
          r.timeCommitment = tcSel.value === "on";
          persist();
        });
        tc.appendChild(tcSel);
        tr.appendChild(tc);
        const x = el("button", "ltk-mw-chip-x", "×") as HTMLButtonElement;
        x.type = "button";
        x.title = "Remove (templates that already added it keep it)";
        x.addEventListener("click", () => {
          imp.standardRoles.splice(i, 1);
          persist();
          paintRoles();
        });
        tr.appendChild(x);
        roleList.appendChild(tr);
      });
      const addRow = el("div", "app-tw-inline");
      const input = el("input", "app-input app-pr-short") as HTMLInputElement;
      input.placeholder = "e.g. Finance lead";
      const add = el("button", "app-btn", "＋ Add standard role") as HTMLButtonElement;
      add.type = "button";
      add.addEventListener("click", () => {
        const v = input.value.trim();
        if (v === "") return;
        imp.standardRoles.push({ key: keyFor(v, [...imp.standardRoles.map((x) => x.key), "sponsor", "owner", "lead", "team", "support"]), label: v, standard: true, multi: true, timeCommitment: false });
        input.value = "";
        persist();
        paintRoles();
      });
      addRow.append(input, add);
      roleList.appendChild(addRow);
    };
    paintRoles();
    rBox.appendChild(roleList);
    body.appendChild(el("h3", "app-pr-h3 app-tw-templates-h", "Initiative templates"));
  }
  const all = await listTemplates();
  // retired last (design 1.1)
  const templates = [...all.filter((t) => t.active), ...all.filter((t) => !t.active)];
  const list = el("div", "app-tw-list");
  if (templates.length === 0) list.appendChild(el("div", "app-settings-note", "No templates yet."));
  for (const t of templates) {
    const card = el("div", "app-tw-card" + (t.active ? "" : " app-tw-card-off"));
    const head = el("div", "app-tw-card-head");
    head.appendChild(el("span", "app-tw-card-name", t.name || "(unnamed)"));
    head.appendChild(el("span", "app-tw-card-method" + (t.singleAction ? " app-tw-card-method-single" : ""), t.method + (t.singleAction ? " · no board" : "")));
    if (!t.active) head.appendChild(el("span", "app-status-badge", "Retired"));
    head.appendChild(el("span", "app-bar-gap"));
    if (isSuper) {
      const edit = el("a", "app-btn", "Edit") as HTMLAnchorElement;
      edit.href = `#/template/${encodeURIComponent(t.id)}`;
      head.appendChild(edit);
      const more = el("button", "app-btn app-cp-more", "⋮") as HTMLButtonElement;
      more.type = "button";
      more.addEventListener("click", () => {
        document.querySelectorAll(".app-cp-menu").forEach((m) => m.remove());
        const menu = el("div", "app-cp-menu");
        const item = (label: string, run: () => void, disabled = false) => {
          const b = el("button", "app-cp-menu-item", label) as HTMLButtonElement;
          b.type = "button";
          b.disabled = disabled;
          b.addEventListener("click", () => {
            menu.remove();
            run();
          });
          menu.appendChild(b);
        };
        item("Duplicate", () => {
          void (async () => {
            const copy: InitiativeTemplate = { ...t, rowId: undefined, id: newId("tpl"), name: `${t.name} (copy)`, boardId: "", order: all.length + 1 };
            await saveTemplate(copy);
            window.location.hash = `#/template/${encodeURIComponent(copy.id)}`;
          })();
        });
        item(t.active ? "Retire" : "Restore", () => {
          void (async () => {
            t.active = !t.active;
            await saveTemplate(t);
            await renderImprovementSettings(body, isSuper);
          })();
        });
        item("Delete", () => {
          void promptConfirm({ title: `Delete ${t.name}?`, note: "Allowed while no initiative uses it. Its template board stays as a project board you can remove from Rituals.", confirmLabel: "Delete", danger: true }).then(async (yes) => {
            if (!yes || !t.rowId) return;
            await deleteTemplate(t.rowId);
            await renderImprovementSettings(body, isSuper);
          });
        });
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
      });
      head.appendChild(more);
    }
    card.appendChild(head);
    const strip = el("div", "app-tw-stepper app-tw-stepper-small");
    if (t.singleAction) strip.appendChild(el("span", "ltk-mw-help", "Header + actions, no stages"));
    else
      for (const c of stepperChips(t)) {
        const chip = el("span", "app-tw-step" + (c.pdca === null ? " app-tw-step-complete" : ""), `${c.gated ? "⚑ " : ""}${c.label}`);
        if (c.pdca !== null) {
          chip.style.color = PDCA_TOKENS[c.pdca].fg;
          chip.style.background = PDCA_TOKENS[c.pdca].bg;
        }
        strip.appendChild(chip);
      }
    card.appendChild(strip);
    card.appendChild(
      el(
        "div",
        "app-settings-note",
        [t.singleAction ? "no stages" : `${t.stages.length} stages`, `${t.roles.length} roles`, `${t.metrics.length} mandatory metrics`, t.boardId !== "" ? "board laid out" : "no board yet", t.company ? t.company : "all companies", "0 initiatives use this"].join(" · ")
      )
    );
    list.appendChild(card);
  }
  body.appendChild(list);
  if (isSuper) {
    const add = el("a", "app-btn app-btn-primary", "＋ New template") as HTMLAnchorElement;
    add.href = "#/template/new";
    body.appendChild(add);
  }
}

// the chip primitive is reused by the list and the wizard
export { pdcaChip };
