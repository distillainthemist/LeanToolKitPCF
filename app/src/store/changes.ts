// Cross-screen change signal (2026-09-09): a screen that memoises a read
// (the Priorities screen's 60s boot cache) checks the topic's version at
// hit time; a write anywhere bumps it, so a link made on the Improvement
// tab shows on Priorities at once instead of after a reload.

const versions = new Map<string, number>();

export function changeVersion(topic: string): number {
  return versions.get(topic) ?? 0;
}

export function bumpChange(topic: string): void {
  versions.set(topic, changeVersion(topic) + 1);
}
