// Pure (no store import — vitest reaches it): the board the viewer is
// looking at, from the route. Quick add's default destination.

/** The board the viewer is looking at, from the route ("#/board/<id>/…"),
 *  or null on the hub, settings and the other screens. */
export function openBoardId(hash: string): string | null {
  const parts = hash.replace(/^#\/?/, "").split("/");
  return parts[0] === "board" && (parts[1] ?? "") !== "" ? decodeURIComponent(parts[1]) : null;
}
