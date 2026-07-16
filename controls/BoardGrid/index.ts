// BoardGrid PCF lifecycle. Pure input → pure output: tilesJSON in, tap and
// layout events out. No document, no LoadGate (the outputs never feed the
// inputs), no actions channel, no snapshots — a board-of-boards image would
// reintroduce the very <img> problem this control exists to avoid.

import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { BoardGridView } from "./editor";
import { parseColumns, parseColumnTitles, parseTiles } from "./types";
import { cfg, parseSettings, rawOr, readTheme, str } from "../../shared/pcf/standard";
import { nowIso } from "../../shared/schema/id";

/** Standard component proportion when the host doesn't allocate a height. */
const ASPECT_RATIO = 1.77;
const DEFAULT_WIDTH = 960;

export class BoardGrid implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private container!: HTMLDivElement;
  private view!: BoardGridView;
  private notifyOutputChanged!: () => void;

  private selectedJson = "";
  private layoutJson = "";

  public init(
    context: ComponentFramework.Context<IInputs>,
    notifyOutputChanged: () => void,
    _state: ComponentFramework.Dictionary,
    container: HTMLDivElement
  ): void {
    this.container = container;
    this.notifyOutputChanged = notifyOutputChanged;

    if (context.mode.trackContainerResize) {
      context.mode.trackContainerResize(true);
    }

    this.view = new BoardGridView(container, {
      onSelect: (e) => {
        // selectedAt changes on every tap, so OnChange always fires — even
        // re-opening the same card
        this.selectedJson = JSON.stringify({ ...e, selectedAt: nowIso() });
        this.notifyOutputChanged();
      },
      onLayout: (slots, columnTitles) => {
        this.layoutJson = JSON.stringify({ movedAt: nowIso(), slots, columnTitles });
        this.notifyOutputChanged();
      },
    });

    this.applyAll(context);
  }

  public updateView(context: ComponentFramework.Context<IInputs>): void {
    this.applyAll(context);
  }

  public getOutputs(): IOutputs {
    return {
      selectedSlotJSON: this.selectedJson,
      layoutJSON: this.layoutJson,
    };
  }

  public destroy(): void {
    if (this.view) this.view.destroy();
  }

  /**
   * Respect the host-allocated size; when the host doesn't provide a height
   * (the test harness, or an unset canvas size), default to the toolkit's
   * standard 1.77:1 viewport proportion so the grid never renders collapsed.
   */
  private applySize(context: ComponentFramework.Context<IInputs>): void {
    const w = context.mode.allocatedWidth;
    const h = context.mode.allocatedHeight;
    if (w > 0) this.container.style.width = `${w}px`;
    if (h > 0) {
      this.container.style.height = `${h}px`;
    } else {
      const width = w > 0 ? w : this.container.clientWidth || DEFAULT_WIDTH;
      this.container.style.height = `${Math.round(width / ASPECT_RATIO)}px`;
    }
  }

  private applyAll(context: ComponentFramework.Context<IInputs>): void {
    const p = context.parameters;
    const s = parseSettings(p.settingsJSON?.raw);

    this.applySize(context);
    this.view.setTheme(readTheme(p, s));
    this.view.setChrome(str(p.cardTitle, s.title), rawOr(p.prompts, s.promptsRaw));

    const disabled = context.mode.isControlDisabled === true;
    this.view.setReadOnly(disabled || p.readOnly?.raw === true || s.readOnly);
    this.view.setEditMode(
      p.editMode?.raw === true || s.config.editMode === true
    );

    this.view.setColumnTitles(
      parseColumnTitles(rawOr(p.columnTitles, cfg(s, "columnTitles")))
    );
    const tiles = parseTiles(rawOr(p.tilesJSON, cfg(s, "tilesJSON")));
    this.view.setTiles(
      tiles,
      parseColumns(rawOr(p.gridSize, cfg(s, "gridSize")), tiles)
    );
  }
}
