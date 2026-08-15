// The CanvasRollup editor: the portfolio table — one row per linked
// canvas card, columns matched by field label. Cells paint through the
// canvas card's own display module; full-mode cell edits open the very
// same field dialogs the canvas uses (fieldDialog.ts), writing back
// read-modify-write to the specific source document. The charter cell
// opens a read-only full view of the whole plan.

import { applyThemeVars, defaultTheme, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import { openDialog } from "../../shared/ui/dialog";
import { parsePrompts, Prompts, renderGhost, renderTitleBar } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { htmlToPng, htmlToSvg, saveSvg, SnapshotScheduler } from "../../shared/export/png";
import { Person } from "../../shared/schema/people";
import { CAPTURE_CSS } from "../CaptureCard/styles";
import { paintCanvasValue } from "../CanvasCard/display";
import { canvasFieldDialog } from "../CanvasCard/fieldDialog";
import { CanvasField, CanvasValue } from "../CanvasCard/types";
import { CANVAS_CSS } from "../CanvasCard/styles";
import { ROLLUP_CSS } from "../CaptureRollup/styles";
import {
  CanvasRollupRow,
  CanvasWriteMode,
  ResolvedCanvasSource,
} from "./types";
import { CANVASROLLUP_CSS } from "./styles";

export interface CanvasRollupViewState {
  names: string[];
  rows: CanvasRollupRow[];
  sources: ResolvedCanvasSource[];
  writeMode: CanvasWriteMode;
  configured: boolean;
  loading: boolean;
}

export interface CanvasRollupCallbacks {
  /** Persist ONE field of one charter (the store road's read-modify-write).
   *  "gone" = the charter's document vanished — refresh instead. */
  onWriteBack: (
    ref: { docRowGuid: string },
    fieldId: string,
    value: CanvasValue | undefined
  ) => Promise<"ok" | "gone">;
  onRefresh: () => void;
  onSnapshot?: (svgMarkup: string) => void;
}

const EMPTY_STATE: CanvasRollupViewState = {
  names: [],
  rows: [],
  sources: [],
  writeMode: "readonly",
  configured: false,
  loading: true,
};

export class CanvasRollupEditor {
  private readonly root: HTMLElement;
  private state: CanvasRollupViewState = EMPTY_STATE;
  private theme: Theme = defaultTheme();
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  private readOnly = false;
  private palette: Record<string, string> = {};
  private people: Person[] = [];
  private readonly snapshots: SnapshotScheduler;

  constructor(
    host: HTMLElement,
    private readonly cb: CanvasRollupCallbacks
  ) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-capture-css", CAPTURE_CSS);
    ensureStylesheet("ltk-canvas-css", CANVAS_CSS);
    ensureStylesheet("ltk-rollup-css", ROLLUP_CSS);
    ensureStylesheet("ltk-canvasrollup-css", CANVASROLLUP_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.snapshots = new SnapshotScheduler(() => this.generateSnapshot());
    this.render();
  }

  setState(state: CanvasRollupViewState): void {
    this.state = state;
    this.render();
    if (!state.loading) this.snapshots.schedule();
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

  setPalette(palette: Record<string, string>): void {
    if (JSON.stringify(palette) === JSON.stringify(this.palette)) return;
    this.palette = palette;
    this.render();
  }

  setPeople(people: Person[]): void {
    if (JSON.stringify(people) === JSON.stringify(this.people)) return;
    this.people = people; // picker dialogs only — no render needed
  }

  destroy(): void {
    this.snapshots.cancel();
    this.root.remove();
  }

  private canEdit(): boolean {
    return !this.readOnly && this.state.writeMode === "full";
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
        { label: "Refresh", onClick: () => this.cb.onRefresh() },
        { label: "Download PNG", onClick: () => this.downloadPng() },
        { label: "Download SVG", onClick: () => this.downloadSvg() },
      ]);
    }

    const body = el("div", "ltk-cr-body");
    this.root.appendChild(body);
    const s = this.state;

    if (!s.configured) {
      renderGhost(body, ["No canvas cards linked", "Choose them in board setup."]);
      return;
    }
    if (s.loading) {
      renderGhost(body, ["Loading canvas cards…"]);
      return;
    }
    if (s.rows.length === 0) {
      const lines = this.prompts.general.length
        ? this.prompts.general
        : ["Nothing to show yet", "The linked canvas cards have no content."];
      renderGhost(body, lines);
      this.renderNotes(body);
      return;
    }

    const table = el("table", "ltk-cc-table");
    const thead = el("thead");
    const headRow = el("tr");
    headRow.appendChild(el("th", undefined, "Charter"));
    for (const name of s.names) headRow.appendChild(el("th", undefined, name));
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el("tbody");
    for (const row of s.rows) {
      const tr = el("tr", "ltk-cc-row");
      const src = el("td", "ltk-vr-charter");
      src.appendChild(
        el("span", "ltk-vr-charter-title", row.source.cardTitle || "Canvas")
      );
      src.appendChild(el("span", "ltk-vr-charter-board", row.source.boardName));
      src.title = "Open the full plan";
      src.addEventListener("click", () => this.openCharter(row));
      tr.appendChild(src);

      for (const field of row.fields) {
        const td = el("td", "ltk-vr-cell");
        if (field === null) {
          td.appendChild(el("span", "ltk-cv-empty", "—"));
        } else {
          const area = el("div");
          paintCanvasValue(area, field, row.values[field.id], {
            palette: this.palette,
            readOnly: true,
          });
          td.appendChild(area);
          if (this.canEdit()) {
            td.classList.add("ltk-cv-editable");
            td.addEventListener("click", () => this.editCell(row, field));
          }
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    const wrap = el("div", "ltk-cr-tablewrap");
    wrap.appendChild(table);
    body.appendChild(wrap);
    this.renderNotes(body);
  }

  /** Failed sources + charters with no content yet, named inline. */
  private renderNotes(body: HTMLElement): void {
    const notes: string[] = [];
    for (const s of this.state.sources) {
      const label = `${s.cardTitle || s.cardId} (${s.boardName || s.boardId})`;
      if (s.error) notes.push(`${label}: ${s.error}`);
      else if (s.doc === null) notes.push(`${label}: nothing filled in yet.`);
    }
    if (notes.length === 0) return;
    const box = el("div", "ltk-cr-errors");
    for (const n of notes) box.appendChild(el("div", "ltk-cr-error", n));
    body.appendChild(box);
  }

  // ---- interactions ----

  /** The whole plan, read-only — headings as sections, values painted by
   *  the canvas display module. */
  private openCharter(row: CanvasRollupRow): void {
    const source = this.state.sources.find(
      (s) => s.boardId === row.source.boardId && s.cardId === row.source.cardId
    );
    const view = el("div", "ltk-vr-view");
    for (const field of source?.config.fields ?? []) {
      if (field.type === "heading") {
        view.appendChild(el("div", "ltk-vr-view-heading", field.label));
        continue;
      }
      const block = el("div");
      block.appendChild(el("div", "ltk-vr-view-label", field.label));
      const area = el("div", "ltk-cv-value");
      paintCanvasValue(area, field, row.values[field.id], {
        palette: this.palette,
        readOnly: true,
      });
      block.appendChild(area);
      view.appendChild(block);
    }
    const dlg = openDialog({
      host: this.root,
      title: `${row.source.cardTitle || "Canvas"} · ${row.source.boardName}`,
      buttons: [
        { label: "Close", kind: "secondary" as const, onClick: () => dlg.close() },
      ],
    });
    dlg.body.appendChild(view);
    if (this.canEdit()) {
      dlg.body.appendChild(
        el("div", "ltk-cr-note", "Click a cell in the table to edit that field.")
      );
    }
  }

  /** Full-mode cell edit: the canvas card's OWN field dialog, then the
   *  write-back road. Mini-tables edit on their source card. */
  private editCell(row: CanvasRollupRow, field: CanvasField): void {
    const opened = canvasFieldDialog({
      host: this.root,
      field,
      value: row.values[field.id],
      palette: this.palette,
      people: this.people,
      onSave: (v) => void this.persist(row, field, v),
    });
    if (!opened) {
      this.notice("Table fields are edited on the source card itself.");
    }
  }

  private async persist(
    row: CanvasRollupRow,
    field: CanvasField,
    value: CanvasValue | undefined
  ): Promise<void> {
    try {
      const result = await this.cb.onWriteBack(row.ref, field.id, value);
      if (result === "gone") {
        this.notice(
          "This charter was changed on its board in the meantime — refreshing instead."
        );
      }
    } catch (err) {
      this.notice(
        `The change could not be saved: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    this.cb.onRefresh();
  }

  private notice(text: string): void {
    const dlg = openDialog({
      host: this.root,
      title: "Canvas rollup",
      buttons: [{ label: "OK", kind: "primary" as const, onClick: () => dlg.close() }],
    });
    dlg.body.appendChild(el("div", undefined, text));
  }

  // ---- snapshot + downloads ----

  private css(): string {
    return LTK_BASE_CSS + CAPTURE_CSS + CANVAS_CSS + ROLLUP_CSS + CANVASROLLUP_CSS;
  }

  private generateSnapshot(): void {
    if (!this.cb.onSnapshot) return;
    htmlToSvg(this.root, this.css(), this.theme.background, (svg) =>
      this.cb.onSnapshot!(svg)
    );
  }

  private downloadSvg(): void {
    htmlToSvg(this.root, this.css(), this.theme.background, (svg) =>
      saveSvg(svg, "canvas-rollup.svg")
    );
  }

  private downloadPng(): void {
    htmlToPng(this.root, this.css(), this.theme.background, (uri) => {
      const link = document.createElement("a");
      link.href = uri;
      link.download = "canvas-rollup.png";
      link.click();
    });
  }
}
