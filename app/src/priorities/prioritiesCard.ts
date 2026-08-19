// Cascaded priorities — the embedded ritual card (design §8). Same view
// compressed: the tile shows the displayed matrix (vision band, objective
// headings, status edges); the focused editor opens in walk mode at step 1
// with the meeting's date setting the period. Card settings hold org,
// pillar filter and view mode — blank org parts fall back to the board's
// own site / department. Loaded by the registry through a dynamic import,
// so none of this enters the board chunk.

import type { CardMount } from "../cardRegistry";
import { getBoard } from "../store/boards";
import { mountPriorities } from "./prioritiesScreen";
import { focusForTopic, parseTopicMap } from "./model";

const cfg = (opts: CardMount, key: string): string => {
  const c = (opts.settings.config ?? {}) as Record<string, unknown>;
  const v = c[key];
  return typeof v === "string" ? v.trim() : "";
};

export function mountPrioritiesCard(opts: CardMount): () => void {
  let dead = false;
  let teardown: (() => void) | null = null;
  void (async () => {
    // the board's own org is the default; explicit settings override
    let site = cfg(opts, "prSite");
    let department = cfg(opts, "prDepartment");
    if (site === "" && department === "") {
      try {
        const b = await getBoard(opts.boardId);
        site = b?.site ?? "";
        department = b?.department ?? "";
      } catch {
        /* falls back to the viewer's site inside the screen */
      }
    }
    if (dead) return;
    // tile vs focused: the focused editor hands the card a wide host; the
    // board's live tiles are narrow. Measured once, after layout.
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    if (dead) return;
    const focused = opts.host.clientWidth >= 700 && opts.host.clientHeight >= 400;
    const view = cfg(opts, "prView") === "dynamic" ? "dynamic" : "simple";
    // rotation focus: the occurrence's topic → pillars; no focus → the
    // plain pillar-name filter → all
    const topic = opts.instanceTopic ?? "";
    const focus = focusForTopic(parseTopicMap(cfg(opts, "prTopicMap")), topic);
    teardown = mountPriorities(opts.host, {
      embedded: true,
      card: {
        mode: focused ? "focused" : "tile",
        org: {
          ...(site !== "" ? { site } : {}),
          ...(department !== "" ? { department } : {}),
          ...(cfg(opts, "prArea") !== "" ? { area: cfg(opts, "prArea") } : {}),
        },
        pillarName: cfg(opts, "prPillar"),
        focus: focus ?? undefined,
        topic,
        view,
        periodDate: opts.instanceWhen !== "" ? opts.instanceWhen.slice(0, 10) : undefined,
        onSnapshot: (svg) => opts.onTile?.(svg),
      },
    });
  })();
  return () => {
    dead = true;
    teardown?.();
    opts.host.replaceChildren();
  };
}
