// The issues PDF writer with a canvas-drawn "screenshot" — the same
// block shapes exportPdf.ts emits, rendered in the browser's PDF viewer.
import "../src/style.css";
import { Block, buildPdf, PdfImage } from "../src/issues/pdf";

async function fakeShot(w: number, h: number, label: string): Promise<PdfImage> {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "#faf8f4";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#2563eb";
  g.fillRect(0, 0, w, 56);
  g.fillStyle = "#fff";
  g.font = "bold 28px sans-serif";
  g.fillText(label, 20, 38);
  g.fillStyle = "#26241f";
  g.font = "18px sans-serif";
  for (let i = 0; i < 6; i++) g.fillText(`Row ${i + 1} · something on the board`, 20, 110 + i * 34);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.85));
  return { jpeg: new Uint8Array(await blob!.arrayBuffer()), width: w, height: h, caption: `${label}.png` };
}

const bar = document.getElementById("cases")!;
const view = document.getElementById("view") as HTMLIFrameElement;
const build = async () => {
  const wide = await fakeShot(1400, 700, "Wide screenshot");
  const tall = await fakeShot(600, 1300, "Tall screenshot");
  const blocks: Block[] = [
    { kind: "title", text: "LeanBoard issues export" },
    { kind: "meta", text: "2 issues  ·  exported 2026-10-06 09:00 UTC  ·  app v0.63.0  ·  apps.powerapps.com" },
    { kind: "p", text: "One section per issue: the report as filed, the context the app captured, the thread, and every attachment." },
    { kind: "h2", text: "Contents" },
    { kind: "p", text: "1. Charter card not updating on the overview  —  Bug · Improvement · New" },
    { kind: "p", text: "2. Gantt shows the kanban category  —  Bug · Boards · Triaged" },
    { kind: "pagebreak" },
    { kind: "h1", text: "1. Charter card not updating on the overview" },
    { kind: "kv", key: "Issue id", value: "0f8c1b2e-4d3a-4e5f-9a1b-2c3d4e5f6a7b", mono: true },
    { kind: "kv", key: "Kind", value: "Bug" },
    { kind: "kv", key: "Status", value: "New  ·  priority P1" },
    { kind: "kv", key: "Reporter", value: "Ben O'Brien <ben@pecheydistilling.com>" },
    { kind: "h2", text: "Description" },
    { kind: "p", text: "When I edit a linked field on the charter card and go back to the overview, the tile still shows the old value.\nIt only updates after a full reload — “stale” for a minute or so. Steps: open an initiative → edit the Problem statement → back." },
    { kind: "h2", text: "Context captured by the app" },
    { kind: "kv", key: "version", value: "v0.63.0" },
    { kind: "kv", key: "route", value: "#/board/init-reduce-changeover-4k2p", mono: true },
    { kind: "kv", key: "userAgent", value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0", mono: true },
    { kind: "h2", text: "Thread (1)" },
    { kind: "meta", text: "Ben O'Brien  ·  2026-10-01 10:12 UTC  ·  internal" },
    { kind: "p", text: "Reproduced on dev — three layers: the saver, the read cache, and the tile mount." },
    { kind: "h2", text: "Attachments (2)" },
    { kind: "image", image: wide },
    { kind: "image", image: tall },
    { kind: "pagebreak" },
    { kind: "h1", text: "2. Gantt shows the kanban category" },
    { kind: "kv", key: "Issue id", value: "7a7b7c7d-1111-2222-3333-444455556666", mono: true },
    { kind: "h2", text: "Description" },
    { kind: "p", text: "Rows read Safety / Quality / Delivery instead of the action." },
    { kind: "h2", text: "Attachments (0)" },
    { kind: "p", text: "(none)" },
  ];
  const bytes = buildPdf({ title: "LeanBoard issues export", footer: "LeanBoard issues · v0.63.0", blocks });
  const url = URL.createObjectURL(new Blob([bytes.buffer.slice(0, bytes.byteLength) as ArrayBuffer], { type: "application/pdf" }));
  view.src = url;
  (window as unknown as { pdfBytes: number }).pdfBytes = bytes.length;
};
const b = document.createElement("button");
b.className = "app-btn";
b.textContent = "Build sample PDF";
b.addEventListener("click", () => void build());
bar.appendChild(b);
void build();
