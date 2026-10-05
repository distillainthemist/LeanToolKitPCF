// Issues → one PDF (2026-10-06): the triage desk ticks reports and
// exports them as a single document, a section per issue with every
// detail and the screenshots — the hand-off for fixing a production
// deployment nobody at the keyboard can open. Reads the four issue
// tables, re-encodes attachments as JPEG through a canvas (the writer
// speaks DCTDecode only), and downloads through a blob URL.

import type { Ben_ltkissues } from "../generated/models/Ben_ltkissuesModel";
import { Ben_ltkissuesService } from "../generated/services/Ben_ltkissuesService";
import { Ben_ltkissuefilesService } from "../generated/services/Ben_ltkissuefilesService";
import { Ben_ltkissuemessagesService } from "../generated/services/Ben_ltkissuemessagesService";
import { Ben_ltkissuewatchsService } from "../generated/services/Ben_ltkissuewatchsService";
import { Block, buildPdf, PdfImage } from "./pdf";

type Issue = Ben_ltkissues;

const STATUS_WORDS: Record<string, string> = { new: "New", triaged: "Triaged", inprogress: "In progress", done: "Done", declined: "Declined", merged: "Merged" };
const AREA_WORDS: Record<string, string> = { boards: "Boards", cards: "Cards", priorities: "Priorities", improvement: "Improvement", documents: "Documents", settings: "Settings", other: "Other" };

/** A plain ArrayBuffer for Blob — the typed array may sit on a shared or offset buffer. */
const asBuffer = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

const when = (iso: string | undefined): string => {
  const t = Date.parse(iso ?? "");
  return Number.isNaN(t) ? "" : new Date(t).toISOString().replace("T", " ").slice(0, 16) + " UTC";
};

/** Any image bytes → JPEG + size, long edge capped (the PDF stays
 *  mail-sized). Null when the bytes are not an image the browser decodes. */
async function toJpeg(bytes: Uint8Array, mime: string, maxEdge = 1400): Promise<PdfImage | null> {
  try {
    const bmp = await createImageBitmap(new Blob([asBuffer(bytes)], { type: mime }));
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; // transparent PNG regions print white, not black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (blob === null) return null;
    return { jpeg: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
  } catch {
    return null;
  }
}

const mimeFor = (name: string): string => (/\.png$/i.test(name) ? "image/png" : /\.(gif)$/i.test(name) ? "image/gif" : /\.webp$/i.test(name) ? "image/webp" : "image/jpeg");

export interface ExportProgress {
  (text: string): void;
}

/** Build and download the PDF for `issues` (in the order given). */
export async function exportIssuesPdf(issues: Issue[], progress: ExportProgress = () => undefined): Promise<void> {
  const version = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "unknown";
  const exportedAt = new Date().toISOString();
  const blocks: Block[] = [];
  blocks.push({ kind: "title", text: "LeanBoard issues export" });
  blocks.push({ kind: "meta", text: `${issues.length} issue${issues.length === 1 ? "" : "s"}  ·  exported ${when(exportedAt)}  ·  app ${version}  ·  ${window.location.host}` });
  blocks.push({ kind: "p", text: "One section per issue: the report as filed, the context the app captured, the thread, and every attachment. Issue ids are the Dataverse row ids." });
  blocks.push({ kind: "gap", pt: 8 });
  blocks.push({ kind: "h2", text: "Contents" });
  issues.forEach((i, n) => {
    blocks.push({ kind: "p", text: `${n + 1}. ${i.ben_name ?? ""}  —  ${i.ben_kind === "idea" ? "Idea" : "Bug"} · ${AREA_WORDS[i.ben_area ?? ""] ?? i.ben_area ?? ""} · ${STATUS_WORDS[i.ben_status ?? ""] ?? i.ben_status ?? ""}` });
  });

  const { getClient } = await import("@microsoft/power-apps/data");
  const { dataSourcesInfo } = await import("../../.power/schemas/appschemas/dataSourcesInfo");
  const client = getClient(dataSourcesInfo);

  let n = 0;
  for (const issue of issues) {
    n++;
    progress(`Reading issue ${n} of ${issues.length}…`);
    const id = issue.ben_ltkissueid;
    const [files, messages, watches, children, parent] = await Promise.all([
      Ben_ltkissuefilesService.getAll({ filter: `_ben_issue_value eq '${id}'` }),
      Ben_ltkissuemessagesService.getAll({ filter: `_ben_issue_value eq '${id}'` }),
      Ben_ltkissuewatchsService.getAll({ filter: `_ben_issue_value eq '${id}'` }),
      Ben_ltkissuesService.getAll({ filter: `_ben_duplicateof_value eq '${id}'`, select: ["ben_ltkissueid", "ben_name", "ben_reportername"] }),
      issue._ben_duplicateof_value ? Ben_ltkissuesService.get(issue._ben_duplicateof_value) : Promise.resolve(null),
    ]);
    blocks.push({ kind: "pagebreak" });
    blocks.push({ kind: "h1", text: `${n}. ${issue.ben_name ?? "(untitled)"}` });
    blocks.push({ kind: "kv", key: "Issue id", value: id, mono: true });
    blocks.push({ kind: "kv", key: "Kind", value: issue.ben_kind === "idea" ? "Idea" : "Bug" });
    blocks.push({ kind: "kv", key: "Area", value: AREA_WORDS[issue.ben_area ?? ""] ?? issue.ben_area ?? "" });
    blocks.push({ kind: "kv", key: "Status", value: `${STATUS_WORDS[issue.ben_status ?? ""] ?? issue.ben_status ?? ""}${issue.ben_priority !== undefined && issue.ben_priority !== null ? `  ·  priority P${issue.ben_priority}` : ""}` });
    blocks.push({ kind: "kv", key: "Reporter", value: `${issue.ben_reportername ?? ""}${issue.ben_reporteremail ? ` <${issue.ben_reporteremail}>` : ""}`.trim() || "—" });
    blocks.push({ kind: "kv", key: "Reported", value: when(issue.createdon) || "—" });
    if (issue.modifiedon && issue.modifiedon !== issue.createdon) blocks.push({ kind: "kv", key: "Last changed", value: when(issue.modifiedon) });
    if (parent && parent.success !== false && parent.data) blocks.push({ kind: "kv", key: "Merged into", value: `${parent.data.ben_name ?? ""} (${parent.data.ben_ltkissueid})` });
    const mergedIn = children.success !== false ? (children.data ?? []) : [];
    if (mergedIn.length > 0) blocks.push({ kind: "kv", key: "Includes", value: mergedIn.map((c) => `${c.ben_name ?? ""} — ${c.ben_reportername ?? ""} (${c.ben_ltkissueid})`).join("; ") });
    const watchers = watches.success !== false ? (watches.data ?? []) : [];
    if (watchers.length > 0) blocks.push({ kind: "kv", key: "Following", value: watchers.map((w) => w.ben_watchername || w.ben_email || "").filter((s) => s !== "").join(", ") });

    blocks.push({ kind: "h2", text: "Description" });
    const desc = (issue.ben_description ?? "").trim();
    blocks.push({ kind: "p", text: desc !== "" ? desc : "(none)" });

    blocks.push({ kind: "h2", text: "Context captured by the app" });
    let ctx: Record<string, string> = {};
    try {
      ctx = JSON.parse(issue.ben_context ?? "{}") as Record<string, string>;
    } catch {
      ctx = { raw: issue.ben_context ?? "" };
    }
    const order = ["version", "route", "host", "viewport", "when", "userAgent"];
    const keys = [...order.filter((k) => ctx[k] !== undefined), ...Object.keys(ctx).filter((k) => !order.includes(k))];
    if (keys.length === 0) blocks.push({ kind: "p", text: "(none)" });
    for (const k of keys) blocks.push({ kind: "kv", key: k, value: String(ctx[k]), mono: k === "userAgent" || k === "route" || k === "raw" });

    if ((issue.ben_resolution ?? "").trim() !== "") {
      blocks.push({ kind: "h2", text: "Resolution" });
      blocks.push({ kind: "p", text: (issue.ben_resolution ?? "").trim() });
    }

    const msgs = (messages.success !== false ? (messages.data ?? []) : []).sort((a, b) => Date.parse(a.createdon ?? "") - Date.parse(b.createdon ?? ""));
    blocks.push({ kind: "h2", text: `Thread (${msgs.length})` });
    if (msgs.length === 0) blocks.push({ kind: "p", text: "(no messages)" });
    for (const m of msgs) {
      blocks.push({ kind: "meta", text: `${m.ben_authorname || m.ben_authoremail || ""}  ·  ${when(m.createdon)}${m.ben_audience === "internal" ? "  ·  internal" : "  ·  to the reporter"}` });
      blocks.push({ kind: "p", text: (m.ben_body ?? "").trim() || "(empty)" });
    }

    const fileRows = files.success !== false ? (files.data ?? []) : [];
    blocks.push({ kind: "h2", text: `Attachments (${fileRows.length})` });
    if (fileRows.length === 0) blocks.push({ kind: "p", text: "(none)" });
    let f = 0;
    for (const row of fileRows) {
      f++;
      progress(`Issue ${n} of ${issues.length}: attachment ${f} of ${fileRows.length}…`);
      const name = row.ben_name ?? `attachment ${f}`;
      const caption = `${name}${row.ben_caption ? ` — ${row.ben_caption}` : ""}`;
      const down = await client.downloadFileFromRecord("ben_ltkissuefiles", row.ben_ltkissuefileid, "ben_file");
      if (down.success === false || !(down.data instanceof Uint8Array)) {
        blocks.push({ kind: "p", text: `${caption}: could not be read (${down.success === false ? (down.error?.message ?? "refused") : "no bytes"})` });
        continue;
      }
      const img = await toJpeg(down.data, mimeFor(name));
      if (img === null) {
        blocks.push({ kind: "p", text: `${caption}: ${Math.round(down.data.length / 1024)} KB — not an image the browser can decode, left out` });
        continue;
      }
      img.caption = caption;
      blocks.push({ kind: "image", image: img });
    }
  }

  progress("Writing the PDF…");
  const bytes = buildPdf({ title: "LeanBoard issues export", author: "LeanBoard", footer: `LeanBoard issues · ${version}`, blocks });
  const blob = new Blob([asBuffer(bytes)], { type: "application/pdf" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `leanboard-issues-${exportedAt.slice(0, 10)}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  progress(`Exported ${issues.length} issue${issues.length === 1 ? "" : "s"} (${Math.round(bytes.length / 1024)} KB).`);
}
