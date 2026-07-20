// Navigation guard — a single slot a screen can fill to veto (or defer)
// leaving it. The router consults it before tearing the screen down, so
// a screen with unsaved work can prompt Save / Discard / Cancel. Kept in
// its own module so the router and screens share it without an import
// cycle.

/** Returns true if it's OK to leave; false to stay put. May be async. */
export type LeaveGuard = () => Promise<boolean>;

let guard: LeaveGuard | null = null;

export function setLeaveGuard(fn: LeaveGuard | null): void {
  guard = fn;
}

export function getLeaveGuard(): LeaveGuard | null {
  return guard;
}
