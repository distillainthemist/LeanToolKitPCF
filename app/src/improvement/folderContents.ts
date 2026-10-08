// A folder's contents for the links card (2026-10-08): SharePoint REST
// through the SharePoint connector, as the viewer — the Documents cards'
// road, reached by DYNAMIC import so the board path never statically
// touches src/docs (the import gate). Path-carrying links only: a
// "/:f:/g/" token share needs Microsoft Graph's /shares, which none of
// the app's connectors reach.

import { folderTarget, FolderItem } from "../../../controls/LinksCard/types";

const spQuote = (s: string) => s.replace(/'/g, "''");

export async function listSharePointFolder(url: string): Promise<FolderItem[]> {
  const target = folderTarget(url);
  if (target === null) throw new Error("This link does not carry a folder path.");
  const { spRequest } = await import("../docs/sp");
  const base = `_api/web/GetFolderByServerRelativePath(decodedUrl='${spQuote(target.path)}')`;
  const [folders, files] = await Promise.all([
    spRequest(target.site, "GET", `${base}/Folders?$select=Name,ServerRelativeUrl,TimeLastModified,ItemCount&$orderby=Name`),
    spRequest(target.site, "GET", `${base}/Files?$select=Name,ServerRelativeUrl,TimeLastModified&$orderby=Name`),
  ]);
  if (!folders.ok || !files.ok) {
    const status = String((!folders.ok ? folders : files).status);
    throw new Error(
      /403|401/.test(status)
        ? "You don't have access to this folder."
        : /404/.test(status)
          ? "No folder at this address — is it a folder path?"
          : `Couldn't read this folder (${status}).`
    );
  }
  const rows = (r: unknown): Record<string, unknown>[] => {
    const v = (r as { value?: unknown })?.value;
    return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
  };
  const origin = new URL(target.site).origin;
  const item = (x: Record<string, unknown>, folder: boolean): FolderItem => ({
    name: String(x.Name ?? ""),
    url: `${origin}${String(x.ServerRelativeUrl ?? "")}`,
    folder,
    modified: typeof x.TimeLastModified === "string" ? x.TimeLastModified : "",
  });
  return [
    ...rows(folders.data).filter((x) => String(x.Name ?? "") !== "Forms").map((x) => item(x, true)),
    ...rows(files.data).map((x) => item(x, false)),
  ];
}
