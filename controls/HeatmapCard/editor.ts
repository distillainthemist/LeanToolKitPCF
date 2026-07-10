// The HeatmapCard editor: a fixed image with tap-to-pin issues. Pins are
// numbered, coloured by severity, and can capture an action as they're
// added (source "heatmap"). Tap a pin to edit it.

import { applyThemeVars, defaultTheme, Theme } from "../../shared/tokens";
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
import { htmlToPng, SnapshotScheduler } from "../../shared/export/png";
import { LtkAction, newAction } from "../../shared/schema/actions";
import { newId, nowIso } from "../../shared/schema/id";
import { Person } from "../../shared/schema/people";
import { HeatmapEnvelope, HeatmapPin, SCHEMA_ID } from "./types";
import { HEATMAP_CSS } from "./styles";

const SEVERITY_COLOURS = ["#f2c811", "#ca5010", "#d13438"];
const SEVERITY_LABELS = ["Low", "Medium", "High"];

export interface HeatmapEditorCallbacks {
  onChange: (env: HeatmapEnvelope, actions: LtkAction[]) => void;
  onPngReady?: (dataUri: string) => void;
}

export class HeatmapEditor {
  private readonly root: HTMLElement;
  private env: HeatmapEnvelope;
  private actions: LtkAction[] = [];
  private theme: Theme = defaultTheme();
  private people: Person[] = [];
  private image = "";
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  private readOnly = false;
  private readonly png: SnapshotScheduler;

  constructor(
    host: HTMLElement,
    private readonly cb: HeatmapEditorCallbacks
  ) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-heatmap-css", HEATMAP_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.env = {
      schema: SCHEMA_ID,
      meta: { title: "", updated: "" },
      data: { pins: [] },
    };
    this.png = new SnapshotScheduler(() => this.generatePng());
    this.render();
  }

  setEnvelope(env: HeatmapEnvelope, actions: LtkAction[]): void {
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

  setImage(image: string): void {
    if (image === this.image) return;
    this.image = image;
    this.render();
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

  private severityColour(severity: number): string {
    const i = Math.max(1, Math.min(3, severity)) - 1;
    return this.theme.legend[i] ?? SEVERITY_COLOURS[i];
  }

  private doneColor(): string {
    return "#107c10";
  }

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

    const body = el("div", "ltk-hm-body");
    this.root.appendChild(body);

    if (this.image.trim() === "") {
      body.appendChild(
        el(
          "div",
          "ltk-hm-noimg",
          "Set the Image property (a data URI or URL) to pin issues onto it."
        )
      );
      return;
    }

    const stage = el("div", "ltk-hm-stage");
    const wrap = el("div", "ltk-hm-imgwrap");
    const img = el("img", "ltk-hm-img") as HTMLImageElement;
    if (this.readOnly) img.classList.add("ltk-readonly");
    img.src = this.image;
    img.draggable = false;
    if (!this.readOnly) {
      img.addEventListener("click", (e) => {
        const r = img.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        this.editPin(null, x, y);
      });
    }
    wrap.appendChild(img);

    this.env.data.pins.forEach((pin, idx) => {
      const dot = el("div", "ltk-hm-pin", String(idx + 1));
      if (this.readOnly) dot.classList.add("ltk-readonly");
      dot.style.left = `${pin.x * 100}%`;
      dot.style.top = `${pin.y * 100}%`;
      dot.style.background = this.severityColour(pin.severity);
      dot.title = pin.note || `Pin ${idx + 1}`;
      if (!this.readOnly) {
        dot.addEventListener("click", (e) => {
          e.stopPropagation();
          this.editPin(pin, null, null);
        });
      }
      wrap.appendChild(dot);
    });

    stage.appendChild(wrap);
    body.appendChild(stage);

    if (!this.readOnly) {
      body.appendChild(
        el("div", "ltk-hm-hint", "Tap the image to pin an issue · tap a pin to edit")
      );
    }
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

  private editPin(pin: HeatmapPin | null, x: number | null, y: number | null): void {
    const ta = textArea(pin?.note ?? "", {
      placeholder: hintFor(this.prompts, "note", "What is the issue here?"),
      rows: 2,
    });
    const sevSel = selectInput(String(pin?.severity ?? 2), [
      { value: "1", label: "Low" },
      { value: "2", label: "Medium" },
      { value: "3", label: "High" },
    ]);
    const inline = pin === null ? addActionSection(this.people) : null;

    const buttons = [];
    if (pin) {
      buttons.push({
        label: "Delete",
        kind: "danger" as const,
        onClick: () => {
          this.env.data.pins = this.env.data.pins.filter((p) => p.id !== pin.id);
          for (const a of this.actions) {
            if (a.context.sourceId === pin.id && a.status !== "done") {
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
      label: pin ? "Save" : "Add",
      kind: "primary" as const,
      onClick: () => {
        const note = ta.value.trim();
        if (note === "") return;
        if (pin) {
          pin.note = note;
          pin.severity = Number(sevSel.value);
        } else {
          const created: HeatmapPin = {
            id: newId("h"),
            x: x ?? 0.5,
            y: y ?? 0.5,
            note,
            severity: Number(sevSel.value),
          };
          this.env.data.pins.push(created);
          if (inline && inline.form.hasContent()) {
            const action = newAction({ source: "heatmap", sourceId: created.id });
            action.issue = note;
            inline.form.apply(action);
            this.actions.push(action);
          }
        }
        dlg.close();
        this.commit();
      },
    });
    const dlg = openDialog({
      host: this.root,
      title: pin ? "Edit pin" : "Pin issue",
      buttons,
    });
    dlg.body.appendChild(fieldRow("Issue", ta));
    const sevRow = fieldRow("Severity", sevSel);
    sevRow.classList.add("ltk-field-half");
    dlg.body.appendChild(sevRow);

    if (inline) {
      dlg.body.appendChild(inline.el);
    } else if (pin) {
      const existing = this.actions.filter(
        (a) => a.context.sourceId === pin.id && a.status !== "cancelled"
      );
      dlg.body.appendChild(
        sectionLabel(existing.length > 0 ? `Actions (${existing.length})` : "Actions")
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
        const action = newAction({ source: "heatmap", sourceId: pin.id });
        action.issue = pin.note;
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

  // ---- PNG export ----

  private generatePng(): void {
    if (!this.cb.onPngReady) return;
    htmlToPng(this.root, LTK_BASE_CSS + HEATMAP_CSS, this.theme.background, (uri) =>
      this.cb.onPngReady!(uri)
    );
  }

  private downloadPng(): void {
    htmlToPng(this.root, LTK_BASE_CSS + HEATMAP_CSS, this.theme.background, (uri) => {
      const link = document.createElement("a");
      link.href = uri;
      link.download = "heatmap.png";
      link.click();
    });
  }
}
