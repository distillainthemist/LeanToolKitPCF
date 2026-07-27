// Standard Documents — the document viewer and properties overlays
// (plan Phase 2). New-tab is the PRIMARY open path (the code app is
// itself an iframe on apps.powerapps.com, and SharePoint's embed
// surfaces may refuse foreign frame-ancestors); the in-overlay preview
// is progressive enhancement with the fallback visibly one click away.
// Working documents ask before opening for edit (the draft's UX).

import { el, clear } from "../../../shared/ui/dom";
import { markDialog, trapFocus } from "../focusTrap";
import {
  DocRow,
  downloadUrlFor,
  embedUrlFor,
  extGlyph,
  formatWhen,
  openUrlFor,
} from "./rows";
import { itemDetails, itemVersions } from "./data";

interface ViewerOpts {
  site: string;
  row: DocRow;
  /** Owning library's LeanBoard display name ("" unknown). */
  libraryName: string;
  /** true = working document: offer "work on it" before viewing. */
  askToWork: boolean;
}

function overlay(label: string): {
  panel: HTMLElement;
  close: () => void;
} {
  const scrim = el("div", "app-docs-scrim");
  const panel = el("div", "app-docs-dialog");
  markDialog(panel, label);
  scrim.appendChild(panel);
  document.body.appendChild(scrim);
  const untrap = trapFocus(panel);
  const close = () => {
    untrap();
    scrim.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey);
  scrim.addEventListener("pointerdown", (e) => {
    if (e.target === scrim) close();
  });
  return { panel, close };
}

function linkBtn(label: string, href: string, primary = false): HTMLAnchorElement {
  const a = el("a", `app-btn${primary ? " app-btn-primary" : ""}`, label) as HTMLAnchorElement;
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  return a;
}

export function openDocViewer(opts: ViewerOpts): void {
  const { site, row } = opts;
  const { panel, close } = overlay(row.name);
  panel.classList.add("app-docs-viewer");

  const head = el("div", "app-docs-viewhead");
  head.append(
    el("span", "app-docs-viewglyph", extGlyph(row.ext)),
    el("span", "app-docs-viewname", row.name),
    el(
      "span",
      "app-field-hint",
      [opts.libraryName, formatWhen(row.modified)].filter((s) => s !== "").join(" · ")
    )
  );
  const x = el("button", "app-btn app-docs-viewclose", "✕") as HTMLButtonElement;
  x.addEventListener("click", close);
  head.appendChild(x);
  panel.appendChild(head);

  const stage = el("div", "app-docs-viewstage");
  panel.appendChild(stage);

  const actions = el("div", "app-docs-viewactions");
  actions.append(
    linkBtn("Open in SharePoint ↗", openUrlFor(site, row), true),
    linkBtn("Download", downloadUrlFor(site, row))
  );
  const copy = el("button", "app-btn", "Copy link") as HTMLButtonElement;
  copy.addEventListener("click", () => {
    void navigator.clipboard.writeText(openUrlFor(site, row)).then(() => {
      copy.textContent = "Copied ✓";
      setTimeout(() => (copy.textContent = "Copy link"), 1500);
    });
  });
  const mail = linkBtn(
    "Email link",
    `mailto:?subject=${encodeURIComponent(row.name)}&body=${encodeURIComponent(openUrlFor(site, row))}`
  );
  mail.target = "_self"; // mailto in a new tab leaves a blank window behind
  actions.append(copy, mail);
  panel.appendChild(actions);

  const paintPreview = () => {
    clear(stage);
    const frame = el("iframe", "app-docs-viewframe") as HTMLIFrameElement;
    frame.src = embedUrlFor(site, row);
    frame.title = row.name;
    stage.appendChild(frame);
    stage.appendChild(
      el(
        "div",
        "app-field-hint app-docs-viewnote",
        "Preview blank? Some formats refuse to embed here — Open in SharePoint always works."
      )
    );
  };

  if (opts.askToWork) {
    // working documents: the draft's flow — ask before opening to edit
    const ask = el("div", "app-docs-viewask");
    ask.appendChild(el("div", "", `Work on “${row.name}”?`));
    const work = linkBtn("Work on it ↗", openUrlFor(site, row), true);
    work.addEventListener("click", close);
    const view = el("button", "app-btn", "Just view") as HTMLButtonElement;
    view.addEventListener("click", () => {
      ask.remove();
      paintPreview();
    });
    const btns = el("div", "app-docs-viewactions");
    btns.append(work, view);
    ask.appendChild(btns);
    stage.appendChild(ask);
  } else {
    paintPreview();
  }
}

interface PropsOpts {
  site: string;
  row: DocRow;
  /** internal → display label overrides from the library config. */
  labels: Record<string, string>;
}

/** Keys FieldValuesAsText returns that read as noise, not properties. */
const PROP_SKIP = new Set([
  "MetaInfo",
  "owshiddenversion",
  "FSObjType",
  "SortBehavior",
  "PermMask",
  "UniqueId",
  "ProgId",
  "ScopeId",
  "VirusStatus",
  "InstanceID",
  "Order",
  "WorkflowVersion",
  "GUID",
  "ParentVersionString",
  "ParentLeafName",
  "DocConcurrencyNumber",
  "StreamHash",
  "Restricted",
  "OriginatorId",
  "NoExecute",
  "ContentVersion",
  "AccessPolicy",
  "AppAuthor",
  "AppEditor",
  "SMTotalSize",
  "SMLastModifiedDate",
  "SMTotalFileStreamSize",
  "SMTotalFileCount",
  "ComplianceAssetId",
  "TriggerFlowInfo",
  "ContentType",
]);

export function openDocProperties(opts: PropsOpts): void {
  const { panel, close } = overlay(`${opts.row.name} — properties`);
  panel.classList.add("app-docs-props");
  const head = el("div", "app-docs-viewhead");
  head.append(el("span", "app-docs-viewname", `${opts.row.name} — properties & history`));
  const x = el("button", "app-btn app-docs-viewclose", "✕") as HTMLButtonElement;
  x.addEventListener("click", close);
  head.appendChild(x);
  panel.appendChild(head);
  const body = el("div", "app-docs-propsbody");
  panel.appendChild(body);
  body.appendChild(el("div", "app-loading-line", "Loading…"));

  void (async () => {
    const details = await itemDetails(opts.site, opts.row);
    clear(body);
    if (details.error !== "") {
      body.appendChild(el("div", "app-settings-note", `Could not load properties: ${details.error}`));
      return;
    }
    const grid = el("div", "app-docs-propgrid");
    for (const [k, v] of Object.entries(details.values)) {
      if (v.trim() === "" || PROP_SKIP.has(k)) continue;
      grid.append(
        el("span", "app-docs-propkey", opts.labels[k] ?? k),
        el("span", "app-docs-propval", v)
      );
    }
    body.appendChild(grid);

    body.appendChild(el("div", "app-field-label", "Revision history"));
    const vres =
      details.id > 0 && opts.row.listId !== ""
        ? await itemVersions(opts.site, opts.row.listId, details.id)
        : { versions: [], error: "item id unknown" };
    if (vres.error !== "") {
      body.appendChild(el("div", "app-field-hint", `History unavailable: ${vres.error}`));
      return;
    }
    if (vres.versions.length === 0) {
      body.appendChild(el("div", "app-field-hint", "No versions recorded."));
      return;
    }
    const list = el("div", "app-docs-verlist");
    for (const v of vres.versions) {
      const line = el("div", "app-docs-verrow");
      line.append(
        el("span", "app-docs-verlabel", `v${v.label}${v.current ? " · current" : ""}`),
        el("span", "app-docs-verwhen", formatWhen(v.when)),
        el("span", "app-docs-vercomment", v.comment)
      );
      list.appendChild(line);
    }
    body.appendChild(list);
  })();
}
