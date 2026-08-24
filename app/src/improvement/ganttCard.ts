// The Actions Gantt ritual card (P8). Board org (or explicit gxSite /
// gxDepartment) scopes the initiatives; the window centres on the
// meeting's week. Editing follows the card's readOnly flag — a live
// ritual can reschedule from the wall, a snapshot cannot.

import type { CardMount } from "../cardRegistry";
import { mountGantt } from "./gantt";
import { listInitiatives } from "../store/initiatives";
import { actionsForInitiatives } from "../store/actions";
import { getBoard } from "../store/boards";
import { appPalettes } from "../store/config";
import { paletteMap } from "../../../shared/palette";
import { ragInputsFor } from "./initiativeModel";
import { initiativeRag } from "../priorities/model";
import { todayIso } from "../../../shared/schema/id";
import { currentViewer } from "../runtime";

function cfg(opts: CardMount, key: string): string {
  const c = opts.settings.config;
  const v = c && typeof c === "object" ? (c as Record<string, unknown>)[key] : "";
  return typeof v === "string" ? v : "";
}

export function mountGanttCard(opts: CardMount): () => void {
  let dead = false;
  let teardown: (() => void) | null = null;
  void (async () => {
    let site = cfg(opts, "gxSite");
    let department = cfg(opts, "gxDepartment");
    if (site === "") {
      try {
        const b = await getBoard(opts.boardId);
        site = b?.site ?? "";
        if (department === "") department = b?.department ?? "";
      } catch {
        /* org filter stays open */
      }
    }
    const [initiatives, actions, palettes] = await Promise.all([
      listInitiatives().catch(() => []),
      actionsForInitiatives().catch(() => []),
      appPalettes(),
    ]);
    if (dead) return;
    const palette = paletteMap(palettes.states);
    const scoped = initiatives.filter(
      (i) =>
        i.status === "active" &&
        !i.confidential &&
        (site === "" || i.org.site === site) &&
        (department === "" || i.org.department === department)
    );
    const weeks = Number(cfg(opts, "gxWeeks")) || 4;
    const today = todayIso();
    teardown = mountGantt({
      host: opts.host,
      scopes: [{ key: "org", label: site || "All sites" }],
      initiatives: scoped,
      actions,
      palette,
      ragFor: (i) => {
        const inputs = ragInputsFor(i, actions, today);
        return initiativeRag(inputs);
      },
      canEdit: !opts.readOnly,
      actor: { whoId: currentViewer()?.objectId ?? "", who: currentViewer()?.name ?? "" },
      onChanged: () => {},
      centerIso: opts.instanceWhen !== "" ? opts.instanceWhen.slice(0, 10) : undefined,
      windowWeeks: weeks,
    });
  })();
  return () => {
    dead = true;
    teardown?.();
  };
}
