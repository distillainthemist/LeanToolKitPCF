// The KPI card's "Grid…" (grid entry, 2026-09-08): the shared values grid
// in a wide dialog on document.body. Loaded lazily from the board path —
// the improvement chunk stays out of a board's first paint.

import { el } from "../../../../shared/ui/dom";
import { paletteMap } from "../../../../shared/palette";
import { appPalettes } from "../../store/config";
import { ragPaletteKey } from "../../priorities/model";
import { Cadence, CADENCE_LABELS, NodeFormat } from "./model";
import { cardGridSource, driverGridSource, renderValueGrid } from "./grid";
import { GridLevel } from "./gridModel";

export interface GridDialogOpts {
  title: string;
  /** The card's own location, or the driver's when linked. */
  location: { boardId: string; cardId: string };
  driver: { id: string; cadence: Cadence; aggregate: "sum" | "avg" | "last" | "min" | "max"; unit: string; format: NodeFormat } | null;
  cadence: Cadence;
  unit: string;
  level: GridLevel;
  /** The card's window — the first page opens around today anyway. */
  window: { from: string; to: string };
  readOnly: boolean;
  /** Called when the dialog closes after at least one write. */
  onClosed: (changed: boolean) => void;
}

export async function openValueGridDialog(o: GridDialogOpts): Promise<void> {
  const palettes = await appPalettes().catch(() => ({ states: [], titles: [] }));
  const stateColors = paletteMap(palettes.states);
  const ragColor = (rag: "green" | "amber" | "red"): string => stateColors[ragPaletteKey(rag)] ?? "#9a948a";
  const scrim = el("div", "app-modal-overlay");
  const box = el("div", "app-modal app-modal-wide app-vg-modal");
  const head = el("div", "app-modal-title", o.title);
  box.appendChild(head);
  box.appendChild(
    el(
      "div",
      "app-modal-note",
      o.driver
        ? `${CADENCE_LABELS[o.driver.cadence]} · ${o.unit || "no unit"} · the value driver's own series — every linked card and the Value drivers tab read the same numbers.`
        : `${CADENCE_LABELS[o.cadence]} · ${o.unit || "no unit"} · this card's own readings. Targets and limits set here carry forward until changed.`
    )
  );
  const host = el("div");
  box.appendChild(host);
  let changed = false;
  const source = o.driver
    ? driverGridSource(o.driver, o.level, o.readOnly)
    : cardGridSource(o.location.boardId, o.location.cardId, o.cadence, o.unit, o.level, o.readOnly);
  const grid = renderValueGrid({
    host,
    source,
    home: o.window,
    ragColor,
    onSaved: () => {
      changed = true;
    },
    csvName: o.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "kpi-values",
  });
  const foot = el("div", "app-modal-footer");
  const close = el("button", "app-btn app-btn-primary", "Done") as HTMLButtonElement;
  close.type = "button";
  close.addEventListener("click", () => {
    close.disabled = true;
    void grid.destroy().then(() => {
      scrim.remove();
      o.onClosed(changed);
    });
  });
  foot.appendChild(close);
  box.appendChild(foot);
  scrim.appendChild(box);
  document.body.appendChild(scrim);
}
