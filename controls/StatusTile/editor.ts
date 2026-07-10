// The StatusTile editor: one big state tile. Tap to cycle states, ✎ to set
// the reason. State labels come from the `states` input; colours from
// legendColors (defaults green / amber / red, then repeating).

import { applyThemeVars, defaultTheme, textOn, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import { fieldRow, openDialog, textArea } from "../../shared/ui/dialog";
import { parsePrompts, Prompts, renderTitleBar, hintFor } from "../../shared/ui/chrome";
import { htmlToPng, SnapshotScheduler } from "../../shared/export/png";
import { nowIso } from "../../shared/schema/id";
import { StatusTileEnvelope, SCHEMA_ID } from "./types";
import { STATUSTILE_CSS } from "./styles";

const DEFAULT_COLOURS = ["#107c10", "#f2c811", "#d13438"];

export interface StatusTileEditorCallbacks {
  onChange: (env: StatusTileEnvelope) => void;
  onPngReady?: (dataUri: string) => void;
}

export class StatusTileEditor {
  private readonly root: HTMLElement;
  private env: StatusTileEnvelope;
  private states: string[] = ["On track", "At risk", "Off track"];
  private theme: Theme = defaultTheme();
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  private readOnly = false;
  private readonly png: SnapshotScheduler;

  constructor(
    host: HTMLElement,
    private readonly cb: StatusTileEditorCallbacks
  ) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-statustile-css", STATUSTILE_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.env = {
      schema: SCHEMA_ID,
      meta: { title: "", updated: "" },
      data: { stateIndex: 0, reason: "" },
    };
    this.png = new SnapshotScheduler(() => this.generatePng());
    this.render();
  }

  setEnvelope(env: StatusTileEnvelope): void {
    this.env = env;
    this.render();
    this.png.schedule();
  }

  setTheme(theme: Theme): void {
    if (JSON.stringify(theme) === JSON.stringify(this.theme)) return;
    this.theme = theme;
    this.render();
  }

  setStates(states: string[]): void {
    if (JSON.stringify(states) === JSON.stringify(this.states)) return;
    this.states = states;
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

  private stateColour(index: number): string {
    return (
      this.theme.legend[index] ??
      DEFAULT_COLOURS[index % DEFAULT_COLOURS.length]
    );
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

    const body = el("div", "ltk-st-body");
    this.root.appendChild(body);

    const idx = Math.min(this.env.data.stateIndex, this.states.length - 1);
    const colour = this.stateColour(idx);
    const tile = el("div", "ltk-st-tile");
    tile.style.background = colour;
    tile.style.color = textOn(colour);
    if (this.readOnly) tile.classList.add("ltk-readonly");

    tile.appendChild(el("div", "ltk-st-state", this.states[idx]));

    const hint = hintFor(this.prompts, "reason", "Tap ✎ to add the reason");
    const hasReason = this.env.data.reason.trim() !== "";
    tile.appendChild(
      el(
        "div",
        "ltk-st-reason" + (hasReason ? "" : " ltk-st-placeholder"),
        hasReason ? this.env.data.reason : this.readOnly ? "" : hint
      )
    );

    // one dot per state, current filled — shows where you are in the cycle
    const dots = el("div", "ltk-st-dots");
    this.states.forEach((_, i) => {
      dots.appendChild(
        el("div", "ltk-st-dot" + (i === idx ? " ltk-st-dot-on" : ""))
      );
    });
    tile.appendChild(dots);

    if (this.env.meta.updated !== "") {
      tile.appendChild(
        el("div", "ltk-st-updated", `Updated ${this.env.meta.updated.slice(0, 10)}`)
      );
    }

    if (!this.readOnly) {
      tile.addEventListener("click", () => {
        this.env.data.stateIndex = (idx + 1) % this.states.length;
        this.commit();
      });
      const edit = el("button", "ltk-st-edit", "✎");
      edit.type = "button";
      edit.title = "Edit reason";
      edit.addEventListener("click", (e) => {
        e.stopPropagation();
        this.editReason();
      });
      tile.appendChild(edit);
    }
    body.appendChild(tile);
  }

  private commit(): void {
    this.env.meta.updated = nowIso();
    this.render();
    this.cb.onChange(this.env);
    this.png.schedule();
  }

  private editReason(): void {
    const ta = textArea(this.env.data.reason, {
      placeholder: hintFor(this.prompts, "reason", "What is driving this status?"),
      rows: 3,
    });
    const dlg = openDialog({
      host: this.root,
      title: "Reason",
      buttons: [
        { label: "Cancel", kind: "secondary", onClick: () => dlg.close() },
        {
          label: "Save",
          kind: "primary",
          onClick: () => {
            this.env.data.reason = ta.value.trim();
            dlg.close();
            this.commit();
          },
        },
      ],
    });
    dlg.body.appendChild(fieldRow("Reason", ta));
    ta.focus();
  }

  private generatePng(): void {
    if (!this.cb.onPngReady) return;
    htmlToPng(this.root, LTK_BASE_CSS + STATUSTILE_CSS, this.theme.background, (uri) =>
      this.cb.onPngReady!(uri)
    );
  }
}
