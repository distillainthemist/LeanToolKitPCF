// How a linked card names itself. Kept out of cardRegistry so tests can
// import it without dragging the Power Apps SDK into node.
//
// The source used to sit in a grey band above the card, costing a strip of
// height on every board and reading as chrome. It belongs in the title: what
// you are looking at, which board it came from, and which occurrence.

/** "27 Jul" — a yyyy-mm-dd day, as a person would write it. */
export function dayLabel(day: string): string {
  const t = Date.parse(`${day}T00:00:00`);
  if (!Number.isFinite(t)) return day;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** "Fri 25 Jul, 06:00" — the occurrence a linked card is showing. */
export function whenLabel(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * A linked card's title. A shared source has no occurrence of its own — its
 * document is the running one every meeting shares — so it says "current"
 * rather than inventing a date.
 */
export function linkTitle(
  cardName: string,
  boardName: string,
  instanceWhen: string
): string {
  const when = whenLabel(instanceWhen);
  return `${cardName} · ${boardName} · ${when !== "" ? when : "current"}`;
}
