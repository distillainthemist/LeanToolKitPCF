// LinksCard — "Documentation & links" (docs/initiative-links-proposal-2026-10.md
// §3, built 2026-10-08): a curated list of links a board keeps — working
// folders, references, the places the work's documents live. The card's
// document is the list; on an initiative board the initiative's working
// folder is pinned first by the host (the charter binding), never stored
// here twice. Pure: no DOM.

export const SCHEMA_ID = "ltk.links.v1";

export interface LinkItem {
  id: string;
  title: string;
  url: string;
  note: string;
  /** Optional group head the link sits under ("" = none). */
  group: string;
}

export interface LinksEnvelope {
  schema: typeof SCHEMA_ID;
  meta: { title: string; updated: string };
  data: { links: LinkItem[] };
}

export function emptyLinks(): LinksEnvelope {
  return { schema: SCHEMA_ID, meta: { title: "", updated: "" }, data: { links: [] } };
}

let seq = 0;
export function newLinkId(): string {
  seq += 1;
  return `lk-${Date.now().toString(36)}-${seq.toString(36)}`;
}

export const isHttps = (s: string): boolean => /^https:\/\/\S+$/i.test(s.trim());

/** A title for a pasted URL: its last path segment, decoded, dashes and
 *  underscores as spaces; the host when the path is bare. */
export function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const idParam = u.searchParams.get("id");
    const parts = (idParam ?? u.pathname).split("/").filter((p) => p !== "" && !/\.aspx$/i.test(p));
    const last = parts[parts.length - 1];
    if (!last) return u.host;
    let d = last;
    try {
      d = decodeURIComponent(last);
    } catch {
      /* keep */
    }
    return d.replace(/[-_]+/g, " ").trim() || u.host;
  } catch {
    return url;
  }
}

/** Tolerant parse: anything unreadable yields an empty list; a link
 *  without an https url is dropped; ids are minted when missing. */
export function parseLinks(raw: string): LinksEnvelope {
  const out = emptyLinks();
  if (raw.trim() === "") return out;
  try {
    const o = JSON.parse(raw) as { meta?: unknown; data?: unknown };
    const meta = o.meta && typeof o.meta === "object" ? (o.meta as Record<string, unknown>) : {};
    out.meta.title = typeof meta.title === "string" ? meta.title : "";
    out.meta.updated = typeof meta.updated === "string" ? meta.updated : "";
    const data = o.data && typeof o.data === "object" ? (o.data as Record<string, unknown>) : {};
    const links = Array.isArray(data.links) ? (data.links as unknown[]) : [];
    for (const x of links) {
      if (!x || typeof x !== "object") continue;
      const r = x as Record<string, unknown>;
      const url = typeof r.url === "string" ? r.url.trim() : "";
      if (!isHttps(url)) continue;
      out.data.links.push({
        id: typeof r.id === "string" && r.id !== "" ? r.id : newLinkId(),
        title: typeof r.title === "string" ? r.title : "",
        url,
        note: typeof r.note === "string" ? r.note : "",
        group: typeof r.group === "string" ? r.group : "",
      });
    }
  } catch {
    /* empty */
  }
  return out;
}

export function serializeLinks(env: LinksEnvelope): string {
  return JSON.stringify({
    schema: SCHEMA_ID,
    meta: env.meta,
    data: { links: env.data.links.map((l) => ({ id: l.id, title: l.title, url: l.url, note: l.note, group: l.group })) },
  });
}

/** Links in their groups, in list order; the ungrouped first under "". */
export function groupLinks(links: LinkItem[]): { group: string; links: LinkItem[] }[] {
  const order: string[] = [];
  const by = new Map<string, LinkItem[]>();
  for (const l of links) {
    const g = l.group.trim();
    if (!by.has(g)) {
      by.set(g, []);
      order.push(g);
    }
    by.get(g)!.push(l);
  }
  order.sort((a, b) => (a === "" ? -1 : b === "" ? 1 : 0));
  return order.map((g) => ({ group: g, links: by.get(g)! }));
}

/** The service a link points at — the glyph picks on it. */
export function hostKind(url: string): "sharepoint" | "teams" | "onedrive" | "web" {
  try {
    const h = new URL(url).host.toLowerCase();
    if (h.endsWith("sharepoint.com")) return h.includes("-my.") ? "onedrive" : "sharepoint";
    if (h === "teams.microsoft.com" || h.endsWith(".teams.microsoft.com")) return "teams";
    return "web";
  } catch {
    return "web";
  }
}

/** "host › last › segments" for a long link. */
export function linkText(url: string, segments = 2): string {
  try {
    const u = new URL(url);
    const idParam = u.searchParams.get("id");
    const parts = (idParam ?? u.pathname)
      .split("/")
      .filter((p) => p !== "" && !/\.aspx$/i.test(p) && !/^:[a-z]:$/i.test(p) && p !== "r" && p !== "sites" && p !== "teams")
      .map((p) => {
        try {
          return decodeURIComponent(p);
        } catch {
          return p;
        }
      });
    return [u.host, ...parts.slice(-segments)].join(" › ");
  } catch {
    return url;
  }
}
