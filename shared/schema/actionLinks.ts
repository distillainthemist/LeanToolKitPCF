// What an action is linked to (2026-09-29): nothing (personal), ONE
// ritual or ONE initiative — never both (Ben). The link is read from what
// the action already carries — its instance key ("board:card", a board's
// channel "board:board", the personal "hub…", the legacy
// "improvement:<id>") and its initiative id — so no new column. Pure: the
// dialog, the hosts and the tests share it.

import { boardChannelKey, LtkAction } from "./actions";

export type LinkKind = "ritual" | "initiative";

export interface LinkTarget {
  kind: LinkKind;
  /** A ritual's board id; an initiative's id. */
  id: string;
  /** The board it lives on ("" = an initiative without a board). */
  boardId: string;
  title: string;
  /** The muted second line (organisation, owner). */
  detail: string;
  /** Further searchable text — role-holders, method. */
  keywords: string;
  /** The viewer owns it, attends it or holds a role on it. */
  mine: boolean;
  /** On the viewer's own site. */
  near: boolean;
  /** Its board's cards, for the chip: card id → title. */
  cards: Record<string, string>;
}

export interface ActionLink {
  kind: "personal" | LinkKind;
  /** null when personal, or when the target is not offered to this viewer
   *  (restricted, closed, archived) — the chip then names the kind only. */
  target: LinkTarget | null;
  /** The card the action hangs off; "" for the board as a whole. */
  cardId: string;
  cardLabel: string;
}

const CHANNEL = "board";

/** The board an instance key names; "" for the personal and legacy keys. */
export function homeBoardOf(instanceId: string): string {
  if (!instanceId.includes(":") || instanceId.startsWith("hub") || instanceId.startsWith("improvement:")) return "";
  return instanceId.split(":")[0];
}

/** The card an instance key names; "" for a board's channel. */
export function homeCardOf(instanceId: string): string {
  if (homeBoardOf(instanceId) === "") return "";
  const card = instanceId.slice(instanceId.indexOf(":") + 1);
  return card === CHANNEL ? "" : card;
}

/** Does the action hang off a specific card? Taking it off is confirmed. */
export function isCardKeyed(instanceId: string): boolean {
  return homeCardOf(instanceId) !== "";
}

/** The link an action carries. `contextHome` stands in for an action that
 *  has no key yet (raised on a card, stamped by the host at save). An
 *  initiative id outranks the home — rows from before links were
 *  exclusive may carry both. */
export function currentLink(a: Pick<LtkAction, "instanceId" | "initiativeId">, targets: LinkTarget[], contextHome = ""): ActionLink {
  const key = a.instanceId !== "" ? a.instanceId : contextHome;
  const board = homeBoardOf(key);
  const card = homeCardOf(key);
  const initId = a.initiativeId ?? (key.startsWith("improvement:") ? key.slice("improvement:".length) : "");
  if (initId !== "") {
    const t = targets.find((x) => x.kind === "initiative" && x.id === initId) ?? null;
    const onIts = t !== null && t.boardId !== "" && t.boardId === board;
    return { kind: "initiative", target: t, cardId: onIts ? card : "", cardLabel: onIts ? (t.cards[card] ?? "") : "" };
  }
  if (board !== "") {
    const t = targets.find((x) => x.boardId === board) ?? null;
    if (t) return { kind: t.kind, target: t, cardId: card, cardLabel: t.cards[card] ?? "" };
    return { kind: board.startsWith("init-") ? "initiative" : "ritual", target: null, cardId: card, cardLabel: "" };
  }
  return { kind: "personal", target: null, cardId: "", cardLabel: "" };
}

/** Link an action to a ritual or an initiative, or to nothing (null =
 *  personal). Exclusive: the action MOVES — onto the target board's
 *  channel (the legacy key for an initiative without a board), or the
 *  viewer's personal channel — and leaves the card it hung off. */
export function applyLink(a: LtkAction, target: LinkTarget | null, personalWho: string): void {
  if (target === null) {
    delete a.initiativeId;
    a.instanceId = `hub:${personalWho}`;
    a.context = { source: "leanhub", sourceId: "" };
    return;
  }
  if (target.kind === "initiative") {
    a.initiativeId = target.id;
    a.instanceId = target.boardId !== "" ? boardChannelKey(target.boardId) : `improvement:${target.id}`;
  } else {
    delete a.initiativeId;
    a.instanceId = boardChannelKey(target.boardId);
  }
  a.context = { source: "card", sourceId: "" };
}

/** Would applying `target` change anything? The same target is a change
 *  only when the action hangs off a card (it moves to the board). */
export function linkChanges(origin: ActionLink, target: LinkTarget | null): boolean {
  if (target === null) return origin.kind !== "personal";
  if (origin.target === null) return true;
  if (origin.target.kind !== target.kind || origin.target.id !== target.id) return true;
  return origin.cardId !== "";
}

const rank = (t: LinkTarget): number => (t.mine ? 0 : t.near ? 1 : 2);
const byRank = (a: LinkTarget, b: LinkTarget): number => rank(a) - rank(b) || a.title.localeCompare(b.title);

/** Search: every typed word must appear in the title, the second line or
 *  the keywords; title matches lead, then the viewer's own, then their
 *  site. Capped per kind. */
export function searchLinkTargets(targets: LinkTarget[], query: string, cap = 5): { rituals: LinkTarget[]; initiatives: LinkTarget[] } {
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return { rituals: [], initiatives: [] };
  const scored: { t: LinkTarget; s: number }[] = [];
  for (const t of targets) {
    const title = t.title.toLowerCase();
    const hay = `${title} ${t.detail.toLowerCase()} ${t.keywords.toLowerCase()}`;
    if (!words.every((w) => hay.includes(w))) continue;
    scored.push({ t, s: title.startsWith(q) ? 0 : words.every((w) => title.includes(w)) ? 1 : 2 });
  }
  scored.sort((a, b) => a.s - b.s || byRank(a.t, b.t));
  const of = (kind: LinkKind) => scored.filter((x) => x.t.kind === kind).slice(0, cap).map((x) => x.t);
  return { rituals: of("ritual"), initiatives: of("initiative") };
}

/** The chip's words: the kind, the title, the card. */
export function linkLabel(l: ActionLink): { kind: string; text: string } {
  if (l.kind === "personal") return { kind: "Personal", text: "not linked" };
  const kind = l.kind === "ritual" ? "Ritual" : "Initiative";
  if (l.target === null) return { kind, text: "not available to you" };
  return { kind, text: l.cardLabel !== "" ? `${l.target.title} · ${l.cardLabel}` : l.target.title };
}
