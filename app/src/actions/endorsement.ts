// Action endorsement — what the app knows (2026-09-30): which initiatives
// ask for it, and whether the viewer may give it (owner, sponsor, admin —
// people assigned on the initiative and the site's standard-role fillers
// alike). A synchronous lookup answers the dialog and the tick from a
// cache; the store asks for the fresh answer at the write.

import { currentViewer } from "../runtime";
import { improvementSettingsJson } from "../store/config";
import { changeVersion } from "../store/changes";
import { listInitiatives } from "../store/initiatives";
import { viewerPerson } from "../store/people";
import { parseImprovementSettings } from "../improvement/templateModel";
import { endorsementOn, endorserIds } from "../improvement/endorsers";
import type { EndorseContext } from "../../../shared/schema/actionEndorsement";

interface Known {
  byId: Map<string, EndorseContext>;
  byBoard: Map<string, EndorseContext>;
}

async function load(): Promise<Known> {
  const whoId = currentViewer()?.objectId ?? "";
  const [all, impRaw, me] = await Promise.all([
    listInitiatives().catch(() => []),
    improvementSettingsJson().catch(() => ""),
    whoId !== "" ? viewerPerson(whoId).catch(() => null) : Promise.resolve(null),
  ]);
  const imp = parseImprovementSettings(impRaw);
  const isAdmin = me?.role === "superadmin" || me?.role === "siteadmin";
  const known: Known = { byId: new Map(), byBoard: new Map() };
  for (const i of all) {
    const ctx: EndorseContext = { on: endorsementOn(i), mine: isAdmin || (whoId !== "" && endorserIds(i, imp.standardRoles).includes(whoId)) };
    known.byId.set(i.id, ctx);
    if (i.boardId !== "") known.byBoard.set(i.boardId, ctx);
  }
  return known;
}

let cache: { key: string; at: number; value: Known | null; loading: Promise<Known> } | null = null;
const stamp = (): string => [currentViewer()?.objectId ?? "", changeVersion("initiatives"), changeVersion("people")].join("|");

function ensure(): NonNullable<typeof cache> {
  const key = stamp();
  if (cache === null || cache.key !== key || Date.now() - cache.at > 60_000) {
    const prev = cache?.value ?? null;
    const loading = load();
    const next: NonNullable<typeof cache> = { key, at: Date.now(), value: prev, loading };
    cache = next;
    loading
      .then((v) => {
        next.value = v;
      })
      .catch(() => {
        if (cache === next) cache = null;
      });
  }
  return cache;
}

const pick = (k: Known, a: { initiativeId?: string; instanceId: string }): EndorseContext | null => {
  if (a.initiativeId) return k.byId.get(a.initiativeId) ?? null;
  const board = a.instanceId.includes(":") ? a.instanceId.split(":")[0] : "";
  return board.startsWith("init-") ? (k.byBoard.get(board) ?? null) : null;
};

/** At once, from what is known (null until the first load lands). */
export function endorsementNow(a: { initiativeId?: string; instanceId: string }): EndorseContext | null {
  const c = ensure();
  return c.value ? pick(c.value, a) : null;
}

/** The fresh answer — the store asks at the write. */
export async function endorsementAtWrite(a: { initiativeId?: string; instanceId: string }): Promise<EndorseContext | null> {
  try {
    return pick(await ensure().loading, a);
  } catch {
    return null;
  }
}

/** Warm the cache (the shell calls this once the viewer is known). */
export function warmEndorsement(): void {
  ensure();
}
