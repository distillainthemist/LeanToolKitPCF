// EscalationViewer — 6C reframed. Renders the actions escalated to this
// board (fed pre-filtered into actionsInputJSON from the central actions
// table: Filter(Actions, Escalated = true)), grouped by their SOURCE card,
// with acknowledge + comment capture written back on actionsOutputJSON.
// There is no document — the actions channel is the data.
//
// Grouping: each action's instanceId identifies the card it was raised on.
// sourcesJSON ([{instanceId, label}]) maps those ids to friendly names
// ("Bottling line board · Fishbone"); unmapped ids fall back to the action's
// context.source (the card type), then "Other".

import { isComplete, LtkAction } from "../../shared/schema/actions";

export interface SourceLabel {
  instanceId: string;
  label: string;
}

/** Parse sourcesJSON defensively: [{instanceId, label}]. */
export function parseSources(raw: string | null | undefined): SourceLabel[] {
  const t = (raw ?? "").trim();
  if (t === "") return [];
  try {
    const arr = JSON.parse(t) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: SourceLabel[] = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const instanceId = String(o.instanceId ?? o.id ?? "").trim();
      const label = String(o.label ?? o.name ?? "").trim();
      if (instanceId === "" || label === "") continue;
      out.push({ instanceId, label });
    }
    return out;
  } catch {
    return [];
  }
}

export interface EscalationGroup {
  key: string;
  label: string;
  actions: LtkAction[];
  openCount: number;
}

const SOURCE_TITLES: Record<string, string> = {
  fishbone: "Fishbone",
  fivewhys: "Five whys",
  faulttree: "Fault tree",
  processmap: "Process map",
  raci: "RACI",
  skills: "Skills matrix",
  riskmatrix: "Risk matrix",
  heatmap: "Heatmap",
  sqdpc: "SQDPC",
  conditions: "Conditions",
  actionboard: "Action board",
};

function sourceTitle(source: string): string {
  if (source === "") return "Other";
  return SOURCE_TITLES[source.toLowerCase()] ?? source;
}

function isLive(a: LtkAction): boolean {
  return a.status !== "cancelled";
}

function sortKey(a: LtkAction): string {
  // open first (overdue naturally floats via due asc), done last
  const done = isComplete(a) || a.status === "done" ? "1" : "0";
  const due = a.due !== "" ? a.due : "9999-99-99";
  return `${done}|${due}|${a.issue}`;
}

/**
 * Group the (non-cancelled) escalated actions by source card, labelled via
 * sourcesJSON. Groups with open actions first, then by label.
 */
export function groupEscalations(
  actions: LtkAction[],
  sources: SourceLabel[]
): EscalationGroup[] {
  const labelFor = new Map(sources.map((s) => [s.instanceId, s.label]));
  const groups = new Map<string, EscalationGroup>();

  for (const a of actions) {
    if (!isLive(a)) continue;
    const key = a.instanceId !== "" ? a.instanceId : `src:${a.context.source}`;
    let g = groups.get(key);
    if (!g) {
      const label =
        (a.instanceId !== "" ? labelFor.get(a.instanceId) : undefined) ??
        sourceTitle(a.context.source);
      g = { key, label, actions: [], openCount: 0 };
      groups.set(key, g);
    }
    g.actions.push(a);
    if (!(isComplete(a) || a.status === "done")) g.openCount++;
  }

  const out = [...groups.values()];
  for (const g of out) {
    g.actions.sort((x, y) => (sortKey(x) < sortKey(y) ? -1 : 1));
  }
  out.sort((x, y) =>
    x.openCount > 0 !== (y.openCount > 0)
      ? x.openCount > 0
        ? -1
        : 1
      : x.label.localeCompare(y.label)
  );
  return out;
}
