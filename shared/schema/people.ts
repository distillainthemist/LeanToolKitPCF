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
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
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
        crew,
      });
    }
    return out;
  } catch {
    return [];
  }
}
