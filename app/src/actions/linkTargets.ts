// What an action may be linked to, as the VIEWER may see it. Every list
// handed to the action dialog comes through here, so confidentiality is
// applied once: a confidential initiative reaches only its role-holders,
// the owners of its organisations and admins; a confidential ritual only
// its owner and participants (2026-09-29 — the first Initiative select
// listed every active one by title).

import { currentViewer } from "../runtime";
import { canSee, ImprovementViewer, Initiative, orgsOf } from "../improvement/initiativeModel";
import { archivedSites, orgOwnersMap } from "../store/config";
import { canViewBoard, listBoards } from "../store/boards";
import { listInitiatives } from "../store/initiatives";
import { parseManifest } from "../store/mappers";
import { viewerPerson } from "../store/people";
import { changeVersion } from "../store/changes";
import { parseMeetingInfo, orgLabel } from "../../../shared/schema/meeting";
import { LinkTarget } from "../../../shared/schema/actionLinks";
import { ActionLinkContext } from "../../../shared/ui/actionLinkProvider";
import { cardLabel } from "../../../controls/CardSettings/registry";
import { openBoardId, openCardKey } from "./openBoard";

/** The viewer as the improvement rules know them. */
export async function improvementViewer(): Promise<ImprovementViewer> {
  const whoId = currentViewer()?.objectId ?? "";
  if (whoId === "") return { whoId, ownedOrgKeys: [], isAdmin: false };
  const [me, owners] = await Promise.all([viewerPerson(whoId).catch(() => null), orgOwnersMap().catch(() => ({}) as Awaited<ReturnType<typeof orgOwnersMap>>)]);
  return {
    whoId,
    ownedOrgKeys: Object.entries(owners)
      .filter(([, people]) => people.some((p) => p.whoId === whoId))
      .map(([key]) => key),
    isAdmin: me?.role === "superadmin" || me?.role === "siteadmin",
  };
}

/** Active initiatives the viewer may see, by title. */
export async function visibleInitiatives(): Promise<Initiative[]> {
  const [list, viewer] = await Promise.all([listInitiatives().catch(() => []), improvementViewer()]);
  return list.filter((i) => i.status === "active" && canSee(i, viewer)).sort((a, b) => a.title.localeCompare(b.title));
}

const join = (bits: string[]): string => bits.filter((b) => b !== "").join(" · ");

async function loadTargets(): Promise<LinkTarget[]> {
  const whoId = currentViewer()?.objectId ?? "";
  const [boards, initiatives, me, archived] = await Promise.all([
    listBoards().catch(() => []),
    visibleInitiatives(),
    whoId !== "" ? viewerPerson(whoId).catch(() => null) : Promise.resolve(null),
    archivedSites().catch(() => [] as string[]),
  ]);
  const mySite = me?.site ?? "";
  const cardsOf = (manifestRaw: string): Record<string, string> =>
    Object.fromEntries(parseManifest(manifestRaw).slots.map((sl) => [sl.cardId, sl.title || cardLabel(sl.cardType)]));
  const out: LinkTarget[] = [];
  for (const b of boards) {
    // rituals only: initiative boards are reached through their initiative
    if (b.kind !== "meeting" || b.isTemplate || b.boardId.startsWith("init-") || b.boardId.startsWith("tpl-")) continue;
    if (!canViewBoard(b.occurrenceSettingsRaw, whoId)) continue;
    if (b.site !== "" && archived.includes(b.site)) continue;
    const info = parseMeetingInfo(b.occurrenceSettingsRaw);
    const org = info ? orgLabel(info.org) : join([b.site, b.department]);
    out.push({
      kind: "ritual",
      id: b.boardId,
      boardId: b.boardId,
      title: b.name,
      detail: join([org !== "" ? org : join([b.site, b.department]), b.category, info?.owner?.who ?? ""]),
      keywords: [...(info?.participants ?? []).map((p) => p.who), ...(info?.alsoOrgs ?? []).map(orgLabel)].join(" "),
      mine: whoId !== "" && (info?.owner?.whoId === whoId || (info?.participants ?? []).some((p) => p.whoId === whoId)),
      near: mySite !== "" && (b.site === mySite || info?.org.site === mySite),
      cards: cardsOf(b.manifestRaw),
    });
  }
  const boardById = new Map(boards.map((b) => [b.boardId, b]));
  for (const i of initiatives) {
    const people = Object.values(i.roles).flat();
    const owner = (i.roles.owner ?? [])[0]?.who ?? "";
    const board = i.boardId !== "" ? boardById.get(i.boardId) : undefined;
    out.push({
      kind: "initiative",
      id: i.id,
      boardId: i.boardId,
      title: i.title,
      detail: join([[i.org.site, i.org.department, i.org.area].filter((v) => v !== "").join(" / "), owner]),
      keywords: [i.method, ...people.map((p) => p.who), ...orgsOf(i).map((o) => [o.site, o.department, o.area].join(" "))].join(" "),
      mine: whoId !== "" && people.some((p) => p.whoId === whoId),
      near: mySite !== "" && orgsOf(i).some((o) => o.site === mySite),
      cards: board ? cardsOf(board.manifestRaw) : {},
    });
  }
  return out;
}

/** The action dialog's link context — the provider the shell registers.
 *  Targets are cached 60s (a board or initiative write drops them); the
 *  route is read fresh. */
let cached: { key: string; at: number; value: Promise<LinkTarget[]> } | null = null;
export async function loadLinkContext(): Promise<ActionLinkContext> {
  const whoId = currentViewer()?.objectId ?? "";
  const key = [whoId, changeVersion("boards"), changeVersion("initiatives"), changeVersion("people")].join("|");
  if (cached === null || cached.key !== key || Date.now() - cached.at > 60_000) {
    const value = loadTargets();
    cached = { key, at: Date.now(), value };
    value.catch(() => {
      cached = null;
    });
  }
  return { targets: await cached.value, personalWho: whoId, openBoardId: openBoardId(window.location.hash), openHome: openCardKey(window.location.hash) };
}
