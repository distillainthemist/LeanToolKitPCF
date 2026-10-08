// The Documentation & links card: the open card (editable, a pinned
// working folder with Set/Change) and the same document as a tile.
import "../src/style.css";
import { LinksEditor } from "../../controls/LinksCard/editor";
import { parseLinks, serializeLinks } from "../../controls/LinksCard/types";
import { defaultTheme } from "../../shared/tokens";

const doc = JSON.stringify({ data: { links: [
  { id: "1", title: "Changeover standard work", url: "https://contoso.sharepoint.com/sites/ops/Shared%20Documents/Line%202/Standard%20work.docx", note: "Rev C, approved", group: "" },
  { id: "2", title: "Trial video", url: "https://contoso.sharepoint.com/sites/ops/Shared%20Documents/Line%202/Trial.mp4", note: "", group: "" },
  { id: "3", title: "Line 2 channel", url: "https://teams.microsoft.com/l/channel/19%3Aabc/Line%202", note: "Daily notes", group: "Teams" },
  { id: "4", title: "OEM manual", url: "https://example.com/manuals/filler-9000.pdf", note: "", group: "Reference" },
  { id: "5", title: "Risk register", url: "https://contoso.sharepoint.com/sites/ops/Lists/Risks/AllItems.aspx", note: "", group: "Reference" },
  { id: "6", title: "Budget", url: "https://contoso.sharepoint.com/sites/fin/Shared%20Documents/Budget.xlsx", note: "", group: "Reference" },
  { id: "7", title: "Seventh link", url: "https://example.com/7", note: "", group: "Reference" },
] } });
const log = document.getElementById("log")!;
let pinned = "https://contoso.sharepoint.com/sites/ops/Shared%20Documents/Line%202%20changeover";
const theme = defaultTheme();
const open = new LinksEditor(document.getElementById("open")!, {
  onChange: (env) => { log.textContent = `saved ${serializeLinks(env).length} bytes · ${env.data.links.length} links`; },
  onSnapshot: () => undefined,
});
open.setTheme(theme);
open.setChrome("Documentation & links", "");
open.setEnvelope(parseLinks(doc));
const paintPinned = () => open.setPinned({ url: pinned, onSet: () => { pinned = pinned === "" ? "https://contoso.sharepoint.com/sites/ops/Shared%20Documents/New" : ""; paintPinned(); log.textContent = `pinned → ${pinned || "(none)"}`; } });
paintPinned();
const tile = new LinksEditor(document.getElementById("tile")!, { onChange: () => undefined });
tile.setTheme(theme);
tile.setChrome("Documentation & links", "");
tile.setReadOnly(true);
tile.setEnvelope(parseLinks(doc));
tile.setPinned({ url: pinned });
