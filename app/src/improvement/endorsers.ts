// Who endorses a completed action, and on which initiatives (2026-09-30).
// Pure — the store-facing lookup, the board and the tests share it.

import { parseImprovementSettings, roleFillersAt } from "./templateModel";
import type { Initiative } from "./initiativeModel";

/** The roles that endorse. */
export const ENDORSER_ROLES = ["owner", "sponsor"];

/** Everyone who may endorse on an initiative: those assigned as owner or
 *  sponsor, and the site's fillers of those standard roles. */
export function endorserIds(i: Pick<Initiative, "roles" | "org">, standardRoles: ReturnType<typeof parseImprovementSettings>["standardRoles"]): string[] {
  const out = new Set<string>();
  for (const key of ENDORSER_ROLES) {
    for (const p of i.roles[key] ?? []) out.add(p.whoId);
    const std = standardRoles.find((r) => r.key === key);
    if (std) for (const p of roleFillersAt(std, i.org.site)) out.add(p.whoId);
  }
  out.delete("");
  return [...out];
}

/** Endorsement applies: switched on, and not a single-action initiative. */
export function endorsementOn(i: Pick<Initiative, "endorsement" | "singleAction">): boolean {
  return i.endorsement && !i.singleAction;
}

