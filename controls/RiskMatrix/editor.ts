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
import { parsePrompts, Prompts, renderGhost, renderTitleBar, hintFor } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { htmlToPng, SnapshotScheduler } from "../../shared/export/png";
import { LtkAction, newAction } from "../../shared/schema/actions";
import { newId, nowIso } from "../../shared/schema/id";
import { Person } from "../../shared/schema/people";
import { band, Risk, RiskMatrixEnvelope, SCHEMA_ID } from "./types";
import { RISKMATRIX_CSS } from "./styles";

const BAND_COLOURS = ["#107c10", "#f2c811", "#ca5010", "#d13438"];

const DEFAULT_GHOST = [
  "No risks captured yet",
  "Rate each risk by likelihood and consequence — treatments become actions.",
];

export interface RiskMatrixEditorCallbacks {
  onChange: (env: RiskMatrixEnvelope, actions: LtkAction[]) => void;
  onPngReady?: (dataUri: string) => void;
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
      ]);
    }

    const body = el("div", "ltk-rm-body");
    this.root.appendChild(body);

    if (this.env.data.risks.length === 0) {
      const lines = this.prompts.general.length
        ? this.prompts.general
        : DEFAULT_GHOST;
      const ghost = renderGhost(
        body,
        this.readOnly ? lines : [...lines, "Tap to add the first risk"]
      );
      if (!this.readOnly) {
        ghost.addEventListener("click", () => this.editRisk(null, 3, 3));
      }
      return;
    }

    body.appendChild(this.renderMatrix());
    body.appendChild(this.renderRegister());
  }

  private renderMatrix(): HTMLElement {
    const left = el("div", "ltk-rm-left");
    const grid = el("div", "ltk-rm-grid");

    // rows: likelihood 5 (top) → 1 (bottom); cols: consequence 1 → 5
    for (let l = 5; l >= 1; l--) {
      grid.appendChild(el("div", "ltk-rm-axis-cell", String(l)));
      for (let c = 1; c <= 5; c++) {
        const cell = el("div", "ltk-rm-cell");
        if (this.readOnly) cell.classList.add("ltk-readonly");
        cell.style.background = tint(this.bandColour(l, c), 0.72);
        if (!this.readOnly) {
          cell.title = `Add a risk rated L${l} × C${c}`;
          cell.addEventListener("click", () => this.editRisk(null, l, c));
        }

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
              chip.title = `${risk.text} (before controls)`;
            } else {
              chip.style.background = this.theme.foreground;
              chip.style.color = textOn(this.theme.foreground);
              chip.title = risk.text;
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
    // consequence axis row
    grid.appendChild(el("div", "ltk-rm-axis-cell", ""));
    for (let c = 1; c <= 5; c++) {
      grid.appendChild(el("div", "ltk-rm-axis-cell", String(c)));
    }
    left.appendChild(el("div", "ltk-rm-axis-title", "Likelihood ↑"));
    left.appendChild(grid);
    left.appendChild(el("div", "ltk-rm-axis-title", "Consequence →"));
    return left;
  }

  private renderRegister(): HTMLElement {
    const list = el("div", "ltk-rm-list");
    this.env.data.risks.forEach((risk, idx) => {
      const row = el("div", "ltk-rm-row");
      if (this.readOnly) row.classList.add("ltk-readonly");
      const num = el("div", "ltk-rm-row-num", String(idx + 1));
      num.style.background = this.theme.foreground;
      num.style.color = textOn(this.theme.foreground);
      row.appendChild(num);
      row.appendChild(el("div", "ltk-rm-row-text", risk.text));

      const cur = this.currentRating(risk);
      const score = el(
        "div",
        "ltk-rm-row-score",
        risk.postLikelihood !== null
          ? `${risk.likelihood * risk.consequence} → ${cur.l * cur.c}`
          : String(cur.l * cur.c)
      );
      score.style.color = this.bandColour(cur.l, cur.c);
      row.appendChild(score);

      const open = this.actions.filter(
        (a) =>
          a.context.sourceId === risk.id &&
          a.status !== "cancelled" &&
          a.status !== "done"
      ).length;
      if (open > 0) {
        row.appendChild(el("div", "ltk-rm-badge", String(open)));
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

  private ratingSelect(value: number | null, allowNone: boolean): HTMLSelectElement {
    const options = [];
    if (allowNone) options.push({ value: "", label: "—" });
    for (let i = 1; i <= 5; i++) {
      options.push({ value: String(i), label: String(i) });
    }
    return selectInput(value === null ? "" : String(value), options);
  }

  private editRisk(risk: Risk | null, prefillL: number | null, prefillC: number | null): void {
    const ta = textArea(risk?.text ?? "", {
      placeholder: hintFor(this.prompts, "risk", "What could go wrong?"),
      rows: 2,
    });
    const lSel = this.ratingSelect(risk?.likelihood ?? prefillL ?? 3, false);
    const cSel = this.ratingSelect(risk?.consequence ?? prefillC ?? 3, false);
    const plSel = this.ratingSelect(risk?.postLikelihood ?? null, true);
    const pcSel = this.ratingSelect(risk?.postConsequence ?? null, true);
    const inline = risk === null ? addActionSection(this.people, "Treatment action") : null;

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
        const text = ta.value.trim();
        if (text === "") return;
        const pl = plSel.value === "" ? null : Number(plSel.value);
        const pc = pcSel.value === "" ? null : Number(pcSel.value);
        if (risk) {
          risk.text = text;
          risk.likelihood = Number(lSel.value);
          risk.consequence = Number(cSel.value);
          risk.postLikelihood = pl;
          risk.postConsequence = pc;
        } else {
          const created: Risk = {
            id: newId("r"),
            text,
            likelihood: Number(lSel.value),
            consequence: Number(cSel.value),
            postLikelihood: pl,
            postConsequence: pc,
          };
          this.env.data.risks.push(created);
          if (inline && inline.form.hasContent()) {
            this.pushAction(created, text, inline.form.apply.bind(inline.form));
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
    dlg.body.appendChild(fieldRow("Risk", ta));
    const pre = el("div");
    pre.style.display = "flex";
    pre.style.gap = "12px";
    const lRow = fieldRow("Likelihood", lSel);
    lRow.classList.add("ltk-field-half");
    const cRow = fieldRow("Consequence", cSel);
    cRow.classList.add("ltk-field-half");
    pre.append(lRow, cRow);
    dlg.body.appendChild(pre);
    dlg.body.appendChild(sectionLabel("After controls (optional)"));
    const post = el("div");
    post.style.display = "flex";
    post.style.gap = "12px";
    const plRow = fieldRow("Likelihood", plSel);
    plRow.classList.add("ltk-field-half");
    const pcRow = fieldRow("Consequence", pcSel);
    pcRow.classList.add("ltk-field-half");
    post.append(plRow, pcRow);
    dlg.body.appendChild(post);

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
        action.issue = risk.text;
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
    ta.focus();
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
    htmlToPng(this.root, LTK_BASE_CSS + RISKMATRIX_CSS, this.theme.background, (uri) =>
      this.cb.onPngReady!(uri)
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
