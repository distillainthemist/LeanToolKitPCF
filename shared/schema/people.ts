// The people list supplied to action-capable controls via the peopleJSON
// input: [{whoId, who, initials?, colour?, crew?}]. `crew` links a person to
// a rostered crew (MeetingScheduler attendee filtering); people without a
// crew are treated as always attending.

export interface Person {
  whoId: string;
  who: string;
  initials: string;
  colour?: string;
  crew?: string;
  /** Not shown as an assignee chip up front — reachable via the "search
   *  everyone" box in the action form (the wider roster behind a
   *  meeting's own participants). */
  secondary?: boolean;
}

/** Two initials from a display name. Directory names arrive in several
 *  shapes — "Ben O'Brien", "O'Brien, Ben (Pechey Distilling)" — so a
 *  bracketed suffix is dropped and "Surname, Given" is read in that
 *  order (2026-10-01: the old first-word/last-word rule gave the
 *  surname's initial and an opening bracket). */
export function initialsFor(name: string): string {
  const bare = name.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").trim();
  const comma = bare.indexOf(",");
  const ordered = comma >= 0 ? `${bare.slice(comma + 1)} ${bare.slice(0, comma)}` : bare;
  const parts = ordered
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+/u, ""))
    .filter((w) => w !== "");
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Parse peopleJSON defensively; never throws. */
export function parsePeople(raw: string | null | undefined): Person[] {
  const t = (raw ?? "").trim();
  if (t === "") return [];
  try {
    const data = JSON.parse(t) as unknown;
    if (!Array.isArray(data)) return [];
    const out: Person[] = [];
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const p = item as Partial<Person> & { name?: unknown; id?: unknown };
      const who =
        typeof p.who === "string" && p.who.trim() !== ""
          ? p.who.trim()
          : typeof p.name === "string"
            ? String(p.name).trim()
            : "";
      if (who === "") continue;
      const whoId =
        typeof p.whoId === "string" && p.whoId !== ""
          ? p.whoId
          : typeof p.id === "string" && p.id !== ""
            ? String(p.id)
            : who.toLowerCase().replace(/\s+/g, "-");
      const crew =
        typeof p.crew === "string" && p.crew.trim() !== ""
          ? p.crew.trim()
          : undefined;
      out.push({
        whoId,
        who,
        initials:
          typeof p.initials === "string" && p.initials !== ""
            ? p.initials
            : initialsFor(who),
        colour: typeof p.colour === "string" ? p.colour : undefined,
        ...(p.secondary === true ? { secondary: true } : {}),
        crew,
        secondary: p.secondary === true ? true : undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** A name-bearing person reference (meeting participant / roster row). */
export interface PersonLike {
  whoId: string;
  who: string;
  crew?: string;
}

/**
 * The assignee list for a meeting's action forms: the meeting's own people
 * (owner first, then participants) as up-front chips, with the rest of the
 * app roster behind the search box (`secondary`). A meeting with no people
 * of its own falls back to the whole roster up front — exactly the old
 * behaviour. Deduped by whoId (the meeting entry wins).
 */
export function assigneePeople(
  meetingPeople: PersonLike[],
  roster: PersonLike[],
  /** With nobody of its own: "roster" puts the whole roster up front (the
   *  old behaviour, the default); "search" keeps everyone behind the
   *  search box — a design surface with no meeting to draw people from
   *  must not open on a wall of every user (Ben, 2026-09-30). */
  whenEmpty: "roster" | "search" = "roster"
): Person[] {
  const toPerson = (p: PersonLike, secondary: boolean): Person => ({
    whoId: p.whoId,
    who: p.who,
    initials: initialsFor(p.who),
    crew: p.crew !== undefined && p.crew !== "" ? p.crew : undefined,
    secondary: secondary ? true : undefined,
  });
  const seen = new Set<string>();
  const primary: Person[] = [];
  for (const p of meetingPeople) {
    if (p.who.trim() === "" || seen.has(p.whoId)) continue;
    seen.add(p.whoId);
    primary.push(toPerson(p, false));
  }
  if (primary.length === 0 && whenEmpty === "roster") return roster.map((p) => toPerson(p, false));
  const rest = roster
    .filter((p) => !seen.has(p.whoId))
    .sort((a, b) => a.who.localeCompare(b.who))
    .map((p) => toPerson(p, true));
  return [...primary, ...rest];
}

/** How many people a who-picker shows up front. */
export const WHO_CHIP_CAP = 20;

/** A who-picker's two halves: the people shown up front, and everyone
 *  behind the search box. The up-front set is the board's own people,
 *  CAPPED (a 500-person site must not become a wall of chips — Ben,
 *  2026-09-01); the overflow joins the search with the wider roster.
 *  ONE rule for the action form and every card's picker. */
export function splitWho(people: Person[], cap = WHO_CHIP_CAP): { upFront: Person[]; behindSearch: Person[] } {
  const own = people.filter((p) => p.secondary !== true);
  return { upFront: own.slice(0, cap), behindSearch: [...own.slice(cap), ...people.filter((p) => p.secondary === true)] };
}
