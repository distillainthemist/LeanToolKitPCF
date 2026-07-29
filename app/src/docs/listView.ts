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
}

export interface DocListOptions<T> {
  columns: ListColumn<T>[];
  onRow: (row: T) => void;
  /** Called when the scroll approaches the end (guard re-entry yourself). */
  onNearEnd: () => void;
  emptyText: string;
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

  const tracks = opts.columns.map((c) => c.width ?? "1fr").join(" ");
  header.style.gridTemplateColumns = tracks;
  for (const c of opts.columns) header.appendChild(el("span", "app-doclist-h", c.label));

  let n = 0;
  const appendRows = (rows: T[]) => {
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
      body.appendChild(el("div", "app-doclist-empty", opts.emptyText));
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
    destroy: () => {
      observer.disconnect();
      wrap.remove();
    },
  };
}
