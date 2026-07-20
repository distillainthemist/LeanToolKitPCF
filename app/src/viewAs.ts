// View-as (role emulation) — lets a super admin preview the app as a
// site admin or plain user. UI-gating only: the stored role is untouched
// and Dataverse security is unchanged; screens simply gate on the
// effective role. Session-scoped (sessionStorage) so a closed tab always
// comes back as the real role.

import type { RosterPerson } from "./store/mappers";

const KEY = "leanboard.viewas";

export type EmulatedRole = "siteadmin" | "user";

export function viewAsRole(): EmulatedRole | null {
  try {
    const v = sessionStorage.getItem(KEY);
    return v === "siteadmin" || v === "user" ? v : null;
  } catch {
    return null;
  }
}

export function setViewAsRole(role: EmulatedRole | null): void {
  try {
    if (role === null) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, role);
  } catch {
    /* storage unavailable — feature simply stays off */
  }
}

/**
 * The person as the UI should treat them: only a real super admin can
 * emulate, and only downward. Returns a copy — never write it back.
 */
export function effectivePerson(stored: RosterPerson): RosterPerson {
  const emulated = stored.role === "superadmin" ? viewAsRole() : null;
  return emulated ? { ...stored, role: emulated } : stored;
}
