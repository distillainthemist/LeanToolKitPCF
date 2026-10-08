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
    // a token share names nothing a person can read: say what it is
    if (/^\/:[a-z]:\/[gstu]\//i.test(u.pathname)) return `${u.host} › shared ${/^\/:f:/i.test(u.pathname) ? "folder" : "file"}`;
    return [u.host, ...parts.slice(-segments)].join(" › ");
  } catch {
    return url;
  }
}

/** A folder a SharePoint REST call can list: the site collection URL
 *  and the folder's server-relative path. Resolves the forms a person
 *  pastes — a library path, a Forms/AllItems.aspx?id= or onedrive.aspx?id=
 *  view link, a "/:f:/r/<path>" sharing link (which carries the path), a
 *  OneDrive personal-site path. A "/:f:/g/<token>" share carries no path
 *  and resolves to null — only Microsoft Graph's /shares can open those,
 *  and the app's connectors reach no such endpoint (2026-10-08). */
export function folderTarget(url: string): { site: string; path: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !u.host.toLowerCase().endsWith("sharepoint.com")) return null;
  const dec = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  let path = "";
  const id = u.searchParams.get("id");
  if (id) path = dec(id);
  else {
    const p = dec(u.pathname);
    const m = /^\/:[a-z]:\/r(\/.*)$/i.exec(p);
    if (m) path = m[1];
    else if (/^\/:[a-z]:\/[gstu]\//i.test(p)) return null; // a token share
    else if (/\/_layouts\//i.test(p) || /\.aspx$/i.test(p)) return null;
    else path = p;
  }
  path = path.replace(/\/+$/, "");
  if (path === "" || path === "/") return null;
  // the site collection: /sites/<x>, /teams/<x>, /personal/<x>, else the root
  const sm = /^(\/(?:sites|teams|personal)\/[^/]+)/i.exec(path);
  const site = `${u.protocol}//${u.host}${sm ? sm[1] : ""}`;
  if (sm && path.toLowerCase() === sm[1].toLowerCase()) return null; // the site itself, not a folder
  return { site, path };
}

/** True for a token sharing link ("/:f:/g/…"): opens fine, cannot be listed. */
export const isTokenShare = (url: string): boolean => {
  try {
    return /^\/:[a-z]:\/[gstu]\//i.test(new URL(url).pathname);
  } catch {
    return false;
  }
};

export interface FolderItem {
  name: string;
  url: string;
  folder: boolean;
  /** ISO modified time ("" = unknown). */
  modified: string;
}
