// Standard Documents — the document list renderer (plan Phase 2).
// Pure DOM: columns in, rows appended in pages, an IntersectionObserver
// sentinel asks for the next page. No SDK imports, so the perf harness
// (app/docs-list.html) drives exactly this code at 1,000+ rows.

import { el, clear } from "../../../shared/ui/dom";

export interface ListColumn<T> {
  key: string;
  label: string;
  /** Cell content; strings become text nodes. */
  render: (row: T) => string | HTMLElement;
  /** Grid width (CSS track), default "1fr". */
  width?: string;
  /** Set to make this column's header a sort control (Vault V3). */
  sortKey?: string;
}

export interface DocListOptions<T> {
  columns: ListColumn<T>[];
  onRow: (row: T) => void;
  /** Called when the scroll approaches the end (guard re-entry yourself). */
  onNearEnd: () => void;
  emptyText: string;
  /** Active sort, painted in the header (server-side — the caller
   *  reloads; this component only reports clicks via onSort). */
  sort?: { key: string; asc: boolean } | null;
  onSort?: (key: string) => void;
  /** Row density: comfortable 44px (default) or compact 36px floor. */
  density?: "comfortable" | "compact";
  /** Extra element under the empty message (e.g. "Clear all filters"). */
  emptyExtra?: () => HTMLElement | null;
}

export interface DocList<T> {
  /** Replace everything (new query). */
  setRows: (rows: T[]) => void;
  /** Append a page. */
  append: (rows: T[]) => void;
  /** Show/hide the tail spinner line. */
  setLoading: (on: boolean) => void;
  /** Rendered row count. */
  count: () => number;
  /** The rows currently rendered (loaded pages so far). */
  rows: () => T[];
  destroy: () => void;
}

export function mountDocList<T>(host: HTMLElement, opts: DocListOptions<T>): DocList<T> {
  const wrap = el("div", "app-doclist");
  const header = el("div", "app-doclist-head");
  const bodyWrap = el("div", "app-doclist-scroll");
  const body = el("div", "app-doclist-body");
  const tail = el("div", "app-doclist-tail");
  const sentinel = el("div", "app-doclist-sentinel");
  bodyWrap.append(body, tail, sentinel);
  wrap.append(header, bodyWrap);
  host.appendChild(wrap);

  if (opts.density === "compact") wrap.classList.add("app-doclist-compact");
  const tracks = opts.columns.map((c) => c.width ?? "1fr").join(" ");
  header.style.gridTemplateColumns = tracks;
  for (const c of opts.columns) {
    if (c.sortKey !== undefined && opts.onSort) {
      const sortKey = c.sortKey;
      const active = opts.sort?.key === sortKey;
      const b = el(
        "button",
        `app-doclist-h app-doclist-hsort${active ? " app-doclist-hsort-on" : ""}`,
        `${c.label}${active ? (opts.sort?.asc ? " \u25b4" : " \u25be") : ""}`
      ) as HTMLButtonElement;
      b.title = active
        ? "Reverse the sort"
        : `Sort by ${c.label.toLowerCase()}`;
      b.addEventListener("click", () => opts.onSort?.(sortKey));
      header.appendChild(b);
    } else {
      header.appendChild(el("span", "app-doclist-h", c.label));
    }
  }

  let n = 0;
  let held: T[] = [];
  const appendRows = (rows: T[]) => {
    held = held.concat(rows);
    const frag = document.createDocumentFragment();
    for (const row of rows) {
      const r = el("div", "app-doclist-row");
      r.style.gridTemplateColumns = tracks;
      for (const c of opts.columns) {
        const cell = el("div", "app-doclist-cell");
        const content = c.render(row);
        if (typeof content === "string") cell.textContent = content;
        else cell.appendChild(content);
        r.appendChild(cell);
      }
      r.addEventListener("click", () => opts.onRow(row));
      frag.appendChild(r);
      n++;
    }
    body.appendChild(frag);
    empty();
  };

  const empty = () => {
    const existing = body.querySelector(".app-doclist-empty");
    if (n === 0 && !existing) {
      const box = el("div", "app-doclist-empty", opts.emptyText);
      const extra = opts.emptyExtra?.();
      if (extra) box.appendChild(extra);
      body.appendChild(box);
    } else if (n > 0 && existing) {
      existing.remove();
    }
  };

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) opts.onNearEnd();
    },
    { root: bodyWrap, rootMargin: "300px" }
  );
  observer.observe(sentinel);

  empty();
  return {
    setRows: (rows) => {
      clear(body);
      n = 0;
      held = [];
      appendRows(rows);
      bodyWrap.scrollTop = 0;
    },
    append: appendRows,
    setLoading: (on) => {
      tail.textContent = on ? "Loading…" : "";
      // first load: skeleton rows instead of an empty pane (removed by
      // the first real setRows/append via clear/empty)
      const skel = body.querySelectorAll(".app-doclist-skel");
      if (on && n === 0 && skel.length === 0) {
        body.querySelector(".app-doclist-empty")?.remove();
        for (let i = 0; i < 6; i++) {
          const r = el("div", "app-doclist-row app-doclist-skel");
          r.style.gridTemplateColumns = tracks;
          for (let c = 0; c < opts.columns.length; c++) {
            const cell = el("div", "app-doclist-cell");
            cell.appendChild(el("span", "app-doclist-skelbar", ""));
            r.appendChild(cell);
          }
          body.appendChild(r);
        }
      } else if (!on) {
        for (const s of skel) s.remove();
        empty();
      }
    },
    count: () => n,
    rows: () => held,
    destroy: () => {
      observer.disconnect();
      wrap.remove();
    },
  };
}
