// The RiskMatrix editor: a 5×5 likelihood × consequence matrix (banded
// tints) with numbered risk chips, beside the risk register. Tap an empty
// cell to add a risk rated there; tap a chip or row to edit. A residual
// (post-control) rating plots as a solid chip with the original outlined.
// Treatments are canonical actions (source "riskmatrix").

import { applyThemeVars, defaultTheme, textOn, Theme, tint } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import {
  fieldRow,
  openDialog,
  sectionLabel,
  selectInput,
  textArea,
} from "../../shared/ui/dialog";
import {
  actionRow,
  addActionSection,
  openActionDialog,
} from "../../shared/ui/actionUi";
import { parsePrompts, Prompts, renderTitleBar, hintFor } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { htmlToPng, saveSvg, SnapshotScheduler } from "../../shared/export/png";
import { LtkAction, newAction } from "../../shared/schema/actions";
import { newId, nowIso } from "../../shared/schema/id";
import { Person } from "../../shared/schema/people";
import {
  band,
  CLASS_ROMAN,
  CONSEQUENCE_LABELS,
  LIKELIHOOD_LABELS,
  Risk,
  riskClass,
  riskLabel,
  RiskMatrixEnvelope,
  SCHEMA_ID,
} from "./types";
import { RISKMATRIX_CSS } from "./styles";

const BAND_COLOURS = ["#107c10", "#f2c811", "#ca5010", "#d13438"];

export interface RiskMatrixEditorCallbacks {
  onChange: (env: RiskMatrixEnvelope, actions: LtkAction[]) => void;
  onPngReady?: (dataUri: string, svgMarkup?: string) => void;
}

export class RiskMatrixEditor {
  private readonly root: HTMLElement;
  private env: RiskMatrixEnvelope;
  private actions: LtkAction[] = [];
  private theme: Theme = defaultTheme();
  private people: Person[] = [];
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  private readOnly = false;
  private readonly png: SnapshotScheduler;

  constructor(
    host: HTMLElement,
    private readonly cb: RiskMatrixEditorCallbacks
  ) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-riskmatrix-css", RISKMATRIX_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.env = {
      schema: SCHEMA_ID,
      meta: { title: "", updated: "" },
      data: { risks: [] },
    };
    this.png = new SnapshotScheduler(() => this.generatePng());
    this.render();
  }

  setEnvelope(env: RiskMatrixEnvelope, actions: LtkAction[]): void {
    this.env = env;
    this.actions = actions;
    this.render();
    this.png.schedule();
  }

  setTheme(theme: Theme): void {
    if (JSON.stringify(theme) === JSON.stringify(this.theme)) return;
    this.theme = theme;
    this.render();
  }

  setPeople(people: Person[]): void {
    this.people = people;
  }

  setChrome(cardTitle: string, promptsRaw: string): void {
    if (cardTitle === this.cardTitle && promptsRaw === this.lastPromptsRaw) {
      return;
    }
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

  // ---- theming ----

  private bandColour(l: number, c: number): string {
    const b = band(l, c);
    return this.theme.legend[b] ?? BAND_COLOURS[b];
  }

  private doneColor(): string {
    return this.theme.legend[1] ?? "#107c10";
  }

  /** The rating a risk currently sits at (residual when set). */
  private currentRating(r: Risk): { l: number; c: number } {
    return r.postLikelihood !== null && r.postConsequence !== null
      ? { l: r.postLikelihood, c: r.postConsequence }
      : { l: r.likelihood, c: r.consequence };
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
        { label: "Download PNG", onClick: () => this.downloadPng() },
        { label: "Download SVG", onClick: () => this.downloadSvg() },
      ]);
    }

    const body = el("div", "ltk-rm-body");
    this.root.appendChild(body);

    // the matrix is always shown (even with no risks) so a cell can be tapped
    // to start an assessment
    body.appendChild(this.renderMatrix());
    body.appendChild(this.renderRegister());
  }

  private renderMatrix(): HTMLElement {
    const left = el("div", "ltk-rm-left");
    const grid = el("div", "ltk-rm-grid");
    grid.style.gridTemplateColumns = `92px repeat(5, minmax(48px, 1fr))`;

    // rows: likelihood 5 (top) → 1 (bottom); cols: consequence 1 → 5
    for (let l = 5; l >= 1; l--) {
      grid.appendChild(
        el("div", "ltk-rm-axis-cell ltk-rm-axis-lik", LIKELIHOOD_LABELS[l - 1])
      );
      for (let c = 1; c <= 5; c++) {
        const cell = el("div", "ltk-rm-cell");
        if (this.readOnly) cell.classList.add("ltk-readonly");
        cell.style.background = tint(this.bandColour(l, c), 0.62);
        if (!this.readOnly) {
          cell.title = `Add a risk here — ${LIKELIHOOD_LABELS[l - 1]} × ${CONSEQUENCE_LABELS[c - 1]} (Class ${CLASS_ROMAN[riskClass(l, c)]})`;
          cell.addEventListener("click", () => this.editRisk(null, l, c));
        }

        // faint class watermark behind any chips
        const wm = el("div", "ltk-rm-classwm", CLASS_ROMAN[riskClass(l, c)]);
        wm.style.color = this.bandColour(l, c);
        cell.appendChild(wm);

        // chips for risks sitting in this cell
        this.env.data.risks.forEach((risk, idx) => {
          const cur = this.currentRating(risk);
          const hasPost =
            risk.postLikelihood !== null && risk.postConsequence !== null;
          const put = (ghosted: boolean) => {
            const chip = el("div", "ltk-rm-chip", String(idx + 1));
            if (ghosted) {
              chip.classList.add("ltk-rm-pre-ghost");
              chip.style.borderColor = this.theme.foreground;
              chip.style.color = this.theme.foreground;
              chip.title = `${riskLabel(risk)} (before controls)`;
            } else {
              chip.style.background = this.theme.foreground;
              chip.style.color = textOn(this.theme.foreground);
              chip.title = riskLabel(risk);
            }
            if (!this.readOnly) {
              chip.addEventListener("click", (e) => {
                e.stopPropagation();
                this.editRisk(risk, null, null);
              });
            }
            cell.appendChild(chip);
          };
          if (cur.l === l && cur.c === c) put(false);
          if (hasPost && risk.likelihood === l && risk.consequence === c) put(true);
        });
        grid.appendChild(cell);
      }
    }
    // consequence axis row: blank corner + severity labels
    grid.appendChild(el("div"));
    for (let c = 1; c <= 5; c++) {
      grid.appendChild(
        el("div", "ltk-rm-axis-cell ltk-rm-axis-con", CONSEQUENCE_LABELS[c - 1])
      );
    }
    left.appendChild(el("div", "ltk-rm-axis-title", "Likelihood ↑"));
    left.appendChild(grid);
    left.appendChild(
      el("div", "ltk-rm-axis-title ltk-rm-axis-title-con", "Consequence / severity →")
    );
    return left;
  }

  private renderRegister(): HTMLElement {
    const list = el("div", "ltk-rm-list");
    if (this.env.data.risks.length === 0) {
      list.appendChild(
        el(
          "div",
          "ltk-rm-emptyhint",
          this.readOnly
            ? "No risks recorded."
            : "No risks yet — tap a matrix cell, or ＋ Add risk."
        )
      );
    }
    this.env.data.risks.forEach((risk, idx) => {
      const row = el("div", "ltk-rm-row");
      if (this.readOnly) row.classList.add("ltk-readonly");
      const num = el("div", "ltk-rm-row-num", String(idx + 1));
      num.style.background = this.theme.foreground;
      num.style.color = textOn(this.theme.foreground);
      row.appendChild(num);

      // main: the risk, then its controls, so both read on the card
      const main = el("div", "ltk-rm-row-main");
      main.appendChild(el("div", "ltk-rm-row-risk", riskLabel(risk)));
      main.appendChild(
        el(
          "div",
          "ltk-rm-row-controls",
          risk.controls !== "" ? `Controls: ${risk.controls}` : "No controls recorded"
        )
      );
      row.appendChild(main);

      // class transition: pre → post (roman), coloured by the current class
      const cur = this.currentRating(risk);
      const preClass = CLASS_ROMAN[riskClass(risk.likelihood, risk.consequence)];
      const curClass = CLASS_ROMAN[riskClass(cur.l, cur.c)];
      const hasPost =
        risk.postLikelihood !== null && risk.postConsequence !== null;
      const badge = el(
        "div",
        "ltk-rm-class",
        hasPost ? `${preClass} → ${curClass}` : curClass
      );
      badge.style.background = this.bandColour(cur.l, cur.c);
      badge.style.color = textOn(this.bandColour(cur.l, cur.c));
      badge.title = `Risk class ${curClass}`;
      row.appendChild(badge);

      const open = this.actions.filter(
        (a) =>
          a.context.sourceId === risk.id &&
          a.status !== "cancelled" &&
          a.status !== "done"
      ).length;
      if (open > 0) {
        row.appendChild(el("div", "ltk-rm-badge", `${open} ▸`));
      }
      if (!this.readOnly) {
        row.addEventListener("click", () => this.editRisk(risk, null, null));
      }
      list.appendChild(row);
    });

    if (!this.readOnly) {
      const add = el("button", "ltk-rm-add", "＋ Add risk");
      add.type = "button";
      add.addEventListener("click", () => this.editRisk(null, 3, 3));
      list.appendChild(add);
    }
    return list;
  }

  // ---- mutations ----

  private commit(): void {
    this.env.meta.updated = nowIso();
    this.emit();
  }

  private commitActions(): void {
    this.emit();
  }

  private emit(): void {
    this.render();
    this.cb.onChange(this.env, this.actions);
    this.png.schedule();
  }

  private ratingSelect(
    value: number | null,
    allowNone: boolean,
    labels: string[]
  ): HTMLSelectElement {
    const options = [];
    if (allowNone) options.push({ value: "", label: "—" });
    for (let i = 1; i <= 5; i++) {
      options.push({ value: String(i), label: `${i} · ${labels[i - 1]}` });
    }
    return selectInput(value === null ? "" : String(value), options);
  }

  private editRisk(risk: Risk | null, prefillL: number | null, prefillC: number | null): void {
    const hazard = textArea(risk?.hazard ?? "", {
      placeholder: hintFor(this.prompts, "hazard", "Source of harm (e.g. rotating capper)"),
      rows: 1,
    });
    const riskField = textArea(risk?.risk ?? "", {
      placeholder: hintFor(this.prompts, "risk", "What could happen?"),
      rows: 2,
    });
    const impact = textArea(risk?.impact ?? "", {
      placeholder: hintFor(this.prompts, "impact", "Consequence if it happens"),
      rows: 2,
    });
    const controls = textArea(risk?.controls ?? "", {
      placeholder: hintFor(this.prompts, "controls", "Controls in place"),
      rows: 2,
    });
    const lSel = this.ratingSelect(risk?.likelihood ?? prefillL ?? 3, false, LIKELIHOOD_LABELS);
    const cSel = this.ratingSelect(risk?.consequence ?? prefillC ?? 3, false, CONSEQUENCE_LABELS);
    const plSel = this.ratingSelect(risk?.postLikelihood ?? null, true, LIKELIHOOD_LABELS);
    const pcSel = this.ratingSelect(risk?.postConsequence ?? null, true, CONSEQUENCE_LABELS);
    const inline = risk === null ? addActionSection(this.people, "Treatment action") : null;

    // live class readouts under each rating pair
    const preClassEl = el("div", "ltk-rm-classreadout");
    const postClassEl = el("div", "ltk-rm-classreadout");
    const refreshClasses = () => {
      const pc = riskClass(Number(lSel.value), Number(cSel.value));
      preClassEl.textContent = `Risk class ${CLASS_ROMAN[pc]}`;
      preClassEl.style.color = this.bandColour(Number(lSel.value), Number(cSel.value));
      if (plSel.value !== "" && pcSel.value !== "") {
        const rc = riskClass(Number(plSel.value), Number(pcSel.value));
        postClassEl.textContent = `Residual class ${CLASS_ROMAN[rc]}`;
        postClassEl.style.color = this.bandColour(Number(plSel.value), Number(pcSel.value));
      } else {
        postClassEl.textContent = "";
      }
    };
    [lSel, cSel, plSel, pcSel].forEach((s) => s.addEventListener("change", refreshClasses));

    const buttons = [];
    if (risk) {
      buttons.push({
        label: "Delete",
        kind: "danger" as const,
        onClick: () => {
          this.env.data.risks = this.env.data.risks.filter((r) => r.id !== risk.id);
          for (const a of this.actions) {
            if (a.context.sourceId === risk.id && a.status !== "done") {
              a.status = "cancelled";
            }
          }
          dlg.close();
          this.commit();
        },
      });
    }
    buttons.push({
      label: "Cancel",
      kind: "secondary" as const,
      onClick: () => dlg.close(),
    });
    buttons.push({
      label: risk ? "Save" : "Add",
      kind: "primary" as const,
      onClick: () => {
        const riskText = riskField.value.trim();
        const hazardText = hazard.value.trim();
        if (riskText === "" && hazardText === "") return;
        const pl = plSel.value === "" ? null : Number(plSel.value);
        const pc = pcSel.value === "" ? null : Number(pcSel.value);
        if (risk) {
          risk.hazard = hazardText;
          risk.risk = riskText;
          risk.impact = impact.value.trim();
          risk.controls = controls.value.trim();
          risk.likelihood = Number(lSel.value);
          risk.consequence = Number(cSel.value);
          risk.postLikelihood = pl;
          risk.postConsequence = pc;
        } else {
          const created: Risk = {
            id: newId("r"),
            hazard: hazardText,
            risk: riskText,
            impact: impact.value.trim(),
            controls: controls.value.trim(),
            likelihood: Number(lSel.value),
            consequence: Number(cSel.value),
            postLikelihood: pl,
            postConsequence: pc,
          };
          this.env.data.risks.push(created);
          if (inline && inline.form.hasContent()) {
            this.pushAction(created, riskLabel(created), inline.form.apply.bind(inline.form));
          }
        }
        dlg.close();
        this.commit();
      },
    });
    const dlg = openDialog({
      host: this.root,
      title: risk ? "Edit risk" : "Add risk",
      buttons,
    });
    // assessment flow: hazard → risk → impact → rate the inherent risk →
    // record controls → rate the residual risk after those controls
    dlg.body.appendChild(fieldRow("Hazard", hazard));
    dlg.body.appendChild(fieldRow("Risk", riskField));
    dlg.body.appendChild(fieldRow("Impact", impact));

    dlg.body.appendChild(sectionLabel("Rating before controls"));
    const pre = el("div");
    pre.style.display = "flex";
    pre.style.gap = "12px";
    const lRow = fieldRow("Likelihood", lSel);
    lRow.classList.add("ltk-field-half");
    const cRow = fieldRow("Consequence", cSel);
    cRow.classList.add("ltk-field-half");
    pre.append(lRow, cRow);
    dlg.body.appendChild(pre);
    dlg.body.appendChild(preClassEl);

    dlg.body.appendChild(fieldRow("Controls", controls));

    dlg.body.appendChild(sectionLabel("Risk after controls (optional)"));
    const post = el("div");
    post.style.display = "flex";
    post.style.gap = "12px";
    const plRow = fieldRow("Likelihood", plSel);
    plRow.classList.add("ltk-field-half");
    const pcRow = fieldRow("Consequence", pcSel);
    pcRow.classList.add("ltk-field-half");
    post.append(plRow, pcRow);
    dlg.body.appendChild(post);
    dlg.body.appendChild(postClassEl);
    refreshClasses();

    if (inline) {
      dlg.body.appendChild(inline.el);
    } else if (risk) {
      const existing = this.actions.filter(
        (a) => a.context.sourceId === risk.id && a.status !== "cancelled"
      );
      dlg.body.appendChild(
        sectionLabel(
          existing.length > 0 ? `Treatments (${existing.length})` : "Treatments"
        )
      );
      for (const a of existing) {
        dlg.body.appendChild(
          actionRow(a, {
            doneColor: this.doneColor(),
            onChanged: () => this.commitActions(),
            onEdit: (act) =>
              openActionDialog({
                host: this.root,
                action: act,
                people: this.people,
                isNew: false,
                onCommit: () => this.commitActions(),
              }),
          })
        );
      }
      const raise = el("button", "ltk-btn ltk-btn-secondary", "＋ Raise action");
      raise.type = "button";
      raise.addEventListener("click", () => {
        dlg.close();
        const action = newAction({ source: "riskmatrix", sourceId: risk.id });
        action.issue = riskLabel(risk);
        openActionDialog({
          host: this.root,
          action,
          people: this.people,
          isNew: true,
          onCommit: () => {
            this.actions.push(action);
            this.commitActions();
          },
        });
      });
      dlg.body.appendChild(raise);
    }
    (risk ? riskField : hazard).focus();
  }

  private pushAction(
    risk: Risk,
    issue: string,
    apply: (a: LtkAction) => void
  ): void {
    const action = newAction({ source: "riskmatrix", sourceId: risk.id });
    action.issue = issue;
    apply(action);
    this.actions.push(action);
  }

  // ---- PNG export ----

  private generatePng(): void {
    if (!this.cb.onPngReady) return;
    htmlToPng(this.root, LTK_BASE_CSS + RISKMATRIX_CSS, this.theme.background, (uri, svg) =>
      this.cb.onPngReady!(uri, svg)
    );
  }

    private downloadSvg(): void {
    htmlToPng(this.root, LTK_BASE_CSS + RISKMATRIX_CSS, this.theme.background, (_uri, svg) =>
      saveSvg(svg ?? "", "risk-matrix.svg")
    );
  }

private downloadPng(): void {
    htmlToPng(this.root, LTK_BASE_CSS + RISKMATRIX_CSS, this.theme.background, (uri) => {
      const link = document.createElement("a");
      link.href = uri;
      link.download = "risk-matrix.png";
      link.click();
    });
  }
}
