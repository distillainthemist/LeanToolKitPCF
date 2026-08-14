// The CaptureRollup editor: one merged table over several Capture cards
// (decision 4 — a leading Source column, not per-source sections). The
// mounter loads/refreshes the resolved sources (store road) and hands the
// projected state in; this control renders it and drives write-back through
// callbacks. Cells render through the capture card's own machinery
// (fields.ts) so a rolled-up row looks exactly like its source.

import { applyThemeVars, defaultTheme, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import { openDialog } from "../../shared/ui/dialog";
import { parsePrompts, Prompts, renderGhost, renderTitleBar } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { htmlToPng, htmlToSvg, saveSvg, SnapshotScheduler } from "../../shared/export/png";
import { CaptureRow } from "../CaptureCard/types";
import {
  buildCaptureField,
  readFields,
  renderCaptureCellInto,
  wireDependentFields,
} from "../CaptureCard/fields";
import { CAPTURE_CSS } from "../CaptureCard/styles";
import { ResolvedRollupSource, RollupRow, WriteMode } from "./types";
import { ROLLUP_CSS } from "./styles";

/** What the mounter computed for one render. */
export interface RollupViewState {
  /** The display column names (config order). */
  names: string[];
  rows: RollupRow[];
  /** The resolved sources — the dialogs need each source's full column set. */
  sources: ResolvedRollupSource[];
  /** lastN window: rows carry their occurrence date. */
  showWhen: boolean;
  /** Any source has a flag column — show the ⚑ column. */
  anyFlag: boolean;
  writeMode: WriteMode;
  flaggedOnly: boolean;
  configured: boolean;
  loading: boolean;
}

export interface RollupEditorCallbacks {
  /**
   * Persist one row's mutation into its source document (the store road's
   * read-modify-write). "gone" = the row vanished on the source board —
   * the editor tells the viewer and asks for a refresh.
   */
  onWriteBack: (
    ref: { docRowGuid: string; rowId: string },
    mutate: (row: CaptureRow) => void
  ) => Promise<"ok" | "gone">;
  /** Reload the sources (the mounter re-resolves and calls setState). */
  onRefresh: () => void;
  onSnapshot?: (svgMarkup: string) => void;
}

const EMPTY_STATE: RollupViewState = {
  names: [],
  rows: [],
  sources: [],
  showWhen: false,
  anyFlag: false,
  writeMode: "readonly",
  flaggedOnly: false,
  configured: false,
  loading: true,
};

export class RollupEditor {
  private readonly root: HTMLElement;
  private state: RollupViewState = EMPTY_STATE;
  private theme: Theme = defaultTheme();
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  private readOnly = false;
  private readonly snapshots: SnapshotScheduler;

  constructor(
    host: HTMLElement,
    private readonly cb: RollupEditorCallbacks
  ) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-capture-css", CAPTURE_CSS);
    ensureStylesheet("ltk-rollup-css", ROLLUP_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.snapshots = new SnapshotScheduler(() => this.generateSnapshot());
    this.render();
  }

  setState(state: RollupViewState): void {
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

  destroy(): void {
    this.snapshots.cancel();
    this.root.remove();
  }

  /** The mode the dialogs act at — a closed meeting reads everything. */
  private effectiveMode(): WriteMode {
    return this.readOnly ? "readonly" : this.state.writeMode;
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
      renderGhost(body, ["No capture cards linked", "Choose them in board setup."]);
      return;
    }
    if (s.loading) {
      renderGhost(body, ["Loading capture cards…"]);
      return;
    }
    if (s.rows.length === 0) {
      const lines = this.prompts.general.length
        ? this.prompts.general
        : s.flaggedOnly
          ? ["No flagged items", "Rows flagged ⚑ on the linked capture cards appear here."]
          : ["Nothing captured yet", "Rows on the linked capture cards appear here."];
      renderGhost(body, lines);
      this.renderErrors(body);
      return;
    }

    const table = el("table", "ltk-cc-table");
    const thead = el("thead");
    const headRow = el("tr");
    if (s.anyFlag) headRow.appendChild(el("th", "ltk-cr-flagcell", "⚑"));
    headRow.appendChild(el("th", undefined, "Source"));
    for (const name of s.names) headRow.appendChild(el("th", undefined, name));
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el("tbody");
    for (const row of s.rows) {
      const tr = el("tr", "ltk-cc-row");
      if (this.effectiveMode() === "readonly") tr.classList.add("ltk-readonly");
      if (s.anyFlag) {
        const td = el("td", "ltk-cr-flagcell");
        td.appendChild(
          row.flagged
            ? el("span", "ltk-cc-flag", "⚑")
            : el("span", "ltk-cc-empty", "—")
        );
        tr.appendChild(td);
      }
      const src = el("td", "ltk-cr-source", row.source.boardName);
      src.title = row.source.boardName;
      if (s.showWhen && row.source.when !== "") {
        src.appendChild(el("span", "ltk-cr-when", row.source.when.slice(0, 10)));
      }
      tr.appendChild(src);
      for (const col of row.columns) {
        const td = el("td");
        if (col === null) td.appendChild(el("span", "ltk-cc-empty", "—"));
        else renderCaptureCellInto(td, col, row.row.cells[col.key]);
        tr.appendChild(td);
      }
      tr.addEventListener("click", () => this.openRow(row));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    const wrap = el("div", "ltk-cr-tablewrap");
    wrap.appendChild(table);
    body.appendChild(wrap);
    this.renderErrors(body);
  }

  private renderErrors(body: HTMLElement): void {
    const failed = this.state.sources.filter((s) => s.error);
    if (failed.length === 0) return;
    const box = el("div", "ltk-cr-errors");
    for (const s of failed) {
      box.appendChild(
        el("div", "ltk-cr-error", `${s.boardName || s.boardId}: ${s.error ?? ""}`)
      );
    }
    body.appendChild(box);
  }

  // ---- the row dialogs ----

  private sourceFor(row: RollupRow): ResolvedRollupSource | undefined {
    return this.state.sources.find(
      (s) => s.boardId === row.source.boardId && s.cardId === row.source.cardId
    );
  }

  private rowTitle(row: RollupRow): string {
    const src = this.sourceFor(row);
    const card = src?.cardTitle ?? "Capture card";
    return `${card} · ${row.source.boardName}`;
  }

  private openRow(row: RollupRow): void {
    const mode = this.effectiveMode();
    if (mode === "full") {
      this.openEdit(row);
      return;
    }
    this.openView(row, mode === "unflag");
  }

  /** Read-only view of the FULL source row (every source column), with the
   *  un-flag action when the mode allows it and the row is flagged. */
  private openView(row: RollupRow, canUnflag: boolean): void {
    const src = this.sourceFor(row);
    const cols = src?.columns ?? [];
    const view = el("div", "ltk-cr-view");
    for (const col of cols) {
      const line = el("div", "ltk-cr-view-row");
      line.appendChild(el("div", "ltk-cr-view-label", col.label));
      const value = el("div", "ltk-cr-view-value");
      renderCaptureCellInto(value, col, row.row.cells[col.key]);
      line.appendChild(value);
      view.appendChild(line);
    }

    const buttons = [];
    if (canUnflag && row.flagged && row.flagKey !== "") {
      buttons.push({
        label: "Remove flag",
        kind: "primary" as const,
        onClick: () => {
          dlg.close();
          void this.persist(row, (r) => {
            r.cells[row.flagKey] = false;
          });
        },
      });
    }
    buttons.push({
      label: "Close",
      kind: "secondary" as const,
      onClick: () => dlg.close(),
    });
    const dlg = openDialog({ host: this.root, title: this.rowTitle(row), buttons });
    dlg.body.appendChild(view);
    dlg.body.appendChild(
      el("div", "ltk-cr-note", "Edits happen on the source board.")
    );
  }

  /** Full edit: the capture card's own field dialog over the source's
   *  complete column set — the write replaces the row's cells. */
  private openEdit(row: RollupRow): void {
    const src = this.sourceFor(row);
    const cols = src?.columns ?? [];
    const fields = cols.map((col) => buildCaptureField(col, row.row.cells[col.key], ""));
    wireDependentFields(fields);

    const dlg = openDialog({
      host: this.root,
      title: this.rowTitle(row),
      buttons: [
        {
          label: "Cancel",
          kind: "secondary" as const,
          onClick: () => dlg.close(),
        },
        {
          label: "Save",
          kind: "primary" as const,
          onClick: () => {
            const cells = readFields(fields);
            dlg.close();
            void this.persist(row, (r) => {
              r.cells = cells;
            });
          },
        },
      ],
    });
    for (const field of fields) dlg.body.appendChild(field.el);
    dlg.body.appendChild(
      el("div", "ltk-cr-note", "Saves straight onto the source board's card.")
    );
    const firstInput = dlg.body.querySelector<HTMLElement>("input, textarea");
    if (firstInput) firstInput.focus();
  }

  private async persist(row: RollupRow, mutate: (r: CaptureRow) => void): Promise<void> {
    try {
      const result = await this.cb.onWriteBack(row.ref, mutate);
      if (result === "gone") {
        this.notice(
          "This item was changed on the source board in the meantime — refreshing the list instead."
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
      title: "Capture rollup",
      buttons: [{ label: "OK", kind: "primary" as const, onClick: () => dlg.close() }],
    });
    dlg.body.appendChild(el("div", undefined, text));
  }

  // ---- snapshot + downloads ----

  private generateSnapshot(): void {
    if (!this.cb.onSnapshot) return;
    htmlToSvg(this.root, LTK_BASE_CSS + CAPTURE_CSS + ROLLUP_CSS, this.theme.background, (svg) =>
      this.cb.onSnapshot!(svg)
    );
  }

  private downloadSvg(): void {
    htmlToSvg(this.root, LTK_BASE_CSS + CAPTURE_CSS + ROLLUP_CSS, this.theme.background, (svg) =>
      saveSvg(svg, "capture-rollup.svg")
    );
  }

  private downloadPng(): void {
    htmlToPng(this.root, LTK_BASE_CSS + CAPTURE_CSS + ROLLUP_CSS, this.theme.background, (uri) => {
      const link = document.createElement("a");
      link.href = uri;
      link.download = "capture-rollup.png";
      link.click();
    });
  }
}
