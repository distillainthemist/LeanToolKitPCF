// Pure (no store import — vitest reaches it): what the viewer is looking
// at, from the route. Quick add's default link and the home of an action
// raised on a card.

const parts = (hash: string): string[] => hash.replace(/^#\/?/, "").split("/");

/** The board on screen ("#/board/<id>/…", "#/edit/<id>/<instance>/<card>"),
 *  or null on the hub, settings and the other screens. */
export function openBoardId(hash: string): string | null {
  const p = parts(hash);
  return (p[0] === "board" || p[0] === "edit") && (p[1] ?? "") !== "" ? decodeURIComponent(p[1]) : null;
}

/** The card on screen as an instance key ("board:card"), "" off the
 *  focused card view. */
export function openCardKey(hash: string): string {
  const p = parts(hash);
  return p[0] === "edit" && (p[1] ?? "") !== "" && (p[3] ?? "") !== "" ? `${decodeURIComponent(p[1])}:${decodeURIComponent(p[3])}` : "";
}
