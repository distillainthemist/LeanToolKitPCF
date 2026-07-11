// The EscalationViewer editor: escalated actions grouped by source card,
// each group a collapsible band with an open-count badge. Rows reuse the
// shared action row (tap-to-complete circle, edit dialog) and add the
// receiving-board affordances: one-tap Acknowledge (stamped with the viewer)
// and quick comments. All changes write back on the actions channel — this
// card owns no document.

import { applyThemeVars, defaultTheme, Theme } from "../../shared/tokens";
import { LTK_BASE_CSS } from "../../shared/ui/baseCss";
import { clear, el, ensureStylesheet } from "../../shared/ui/dom";
import { fieldRow, openDialog, textArea } from "../../shared/ui/dialog";
import { actionRow, openActionDialog } from "../../shared/ui/actionUi";
import { parsePrompts, Prompts, renderGhost, renderTitleBar } from "../../shared/ui/chrome";
import { renderKebab } from "../../shared/ui/menu";
import { htmlToPng, SnapshotScheduler } from "../../shared/export/png";
import { Acknowledgement, LtkAction } from "../../shared/schema/actions";
import { nowIso, todayIso } from "../../shared/schema/id";
import { Person } from "../../shared/schema/people";
import { EscalationGroup, groupEscalations, SourceLabel } from "./types";
import { ESCALATION_CSS } from "./styles";

export interface EscalationEditorCallbacks {
  onChange: (actions: LtkAction[]) => void;
  onPngReady?: (dataUri: string, svgMarkup?: string) => void;
}

export interface Viewer {
  whoId: string;
  who: string;
}

export class EscalationViewerEditor {
  private readonly root: HTMLElement;
  private actions: LtkAction[] = [];
  private sources: SourceLabel[] = [];
  private theme: Theme = defaultTheme();
  private people: Person[] = [];
  private viewer: Viewer = { whoId: "", who: "" };
  private cardTitle = "";
  private prompts: Prompts = { general: [], fields: {} };
  private lastPromptsRaw: string | null = null;
  private readOnly = false;
  private collapsed = new Set<string>();
  private readonly png: SnapshotScheduler;

  constructor(host: HTMLElement, private readonly cb: EscalationEditorCallbacks) {
    ensureStylesheet("ltk-base-css", LTK_BASE_CSS);
    ensureStylesheet("ltk-escalation-css", ESCALATION_CSS);
    this.root = el("div", "ltk-root");
    host.appendChild(this.root);
    this.png = new SnapshotScheduler(() => this.generatePng());
    this.render();
  }

  setActions(actions: LtkAction[]): void {
    this.actions = actions;
    this.render();
    this.png.schedule();
  }

  /** Source labels can arrive/change independently of the actions gate. */
  setSources(sources: SourceLabel[]): void {
    if (JSON.stringify(sources) === JSON.stringify(this.sources)) return;
    this.sources = sources;
    this.render();
  }

  setTheme(theme: Theme): void {
    if (JSON.stringify(theme) === JSON.stringify(this.theme)) return;
    this.theme = theme;
    this.render();
  }

  setPeople(people: Person[]): void {
    this.people = people;
  }

  setViewer(viewer: Viewer): void {
    this.viewer = viewer;
  }

  setChrome(cardTitle: string, promptsRaw: string): void {
    if (cardTitle === this.cardTitle && promptsRaw === this.lastPromptsRaw) return;
    this.cardTitle = cardTitle;
    this.lastPromptsRaw = promptsRaw;
    this.prompts = parsePrompts(promptsRaw);
    this.render();
  }

  setReadOnly(ro: boolean): void {
    if (this.readOnly !== ro) {
      this.readOnly = ro;
      this.render();
    }
  }

  destroy(): void {
    this.png.cancel();
    this.root.remove();
  }

  // ---- rendering ----

  private render(): void {
    const overlays = Array.from(this.root.children).filter((c) =>
      c.classList.contains("ltk-dialog-overlay")
    );
    this.renderBody();
    for (const o of overlays) this.root.appendChild(o);
  }

  private renderBody(): void {
    clear(this.root);
    applyThemeVars(this.root, this.theme);
    renderTitleBar(this.root, this.cardTitle, this.prompts);
    if (!this.readOnly) {
      renderKebab(this.root, [
        { label: "Download PNG", onClick: () => this.downloadPng() },
      ]);
    }

    const body = el("div", "ltk-ev-body");
    this.root.appendChild(body);

    const groups = groupEscalations(this.actions, this.sources);
    if (groups.length === 0) {
      const lines = this.prompts.general.length
        ? this.prompts.general
        : ["No escalations", "Actions escalated to this board appear here."];
      renderGhost(body, lines.slice(0, 2));
      return;
    }

    let total = 0;
    let open = 0;
    for (const g of groups) {
      total += g.actions.length;
      open += g.openCount;
      body.appendChild(this.renderGroup(g));
    }

    body.appendChild(
      el(
        "div",
        "ltk-ev-summary",
        `${total} escalation${total === 1 ? "" : "s"} · ${open} open`
      )
    );
  }

  private renderGroup(group: EscalationGroup): HTMLElement {
    const wrap = el("div", "ltk-ev-group");
    const head = el("div", "ltk-ev-grouphead");
    const chevron = el(
      "span",
      "ltk-ev-chevron",
      this.collapsed.has(group.key) ? "▸" : "▾"
    );
    head.appendChild(chevron);
    head.appendChild(el("span", "ltk-ev-grouplabel", group.label));
    if (group.openCount > 0) {
      const badge = el("span", "ltk-ev-groupbadge", String(group.openCount));
      badge.style.background = this.theme.accent;
      badge.style.color = "#ffffff";
      head.appendChild(badge);
    }
    head.addEventListener("click", () => {
      if (this.collapsed.has(group.key)) this.collapsed.delete(group.key);
      else this.collapsed.add(group.key);
      this.render();
    });
    wrap.appendChild(head);

    if (!this.collapsed.has(group.key)) {
      for (const a of group.actions) {
        wrap.appendChild(this.renderEscalation(a));
      }
    }
    return wrap;
  }

  private renderEscalation(a: LtkAction): HTMLElement {
    const item = el("div", "ltk-ev-item");
    item.appendChild(
      actionRow(a, {
        doneColor: this.theme.legend[1] ?? "#107c10",
        showIssue: true,
        onChanged: () => this.emit(),
        onEdit: (act) => {
          if (this.readOnly) return;
          openActionDialog({
            host: this.root,
            action: act,
            people: this.people,
            isNew: false,
            onCommit: () => this.emit(),
          });
        },
      })
    );

    // receiving-board strip: acknowledge state + quick comment
    const strip = el("div", "ltk-ev-strip");

    if (a.acknowledged) {
      const ack = el(
        "button",
        "ltk-ev-ack ltk-ev-ack-on",
        `✓ Acknowledged · ${a.acknowledged.who || "someone"} · ${a.acknowledged.when.slice(0, 10)}`
      );
      ack.type = "button";
      ack.title = this.readOnly ? "" : "Tap to remove the acknowledgement";
      if (!this.readOnly) {
        ack.addEventListener("click", () => {
          delete a.acknowledged;
          this.emit();
        });
      }
      strip.appendChild(ack);
    } else if (!this.readOnly) {
      const ack = el("button", "ltk-ev-ack", "Acknowledge");
      ack.type = "button";
      ack.title = "Sign this escalation off as seen by this board";
      ack.addEventListener("click", () => {
        const acknowledged: Acknowledgement = {
          whoId: this.viewer.whoId,
          who: this.viewer.who,
          when: nowIso(),
        };
        a.acknowledged = acknowledged;
        this.emit();
      });
      strip.appendChild(ack);
    }

    if (!this.readOnly) {
      const comment = el(
        "button",
        "ltk-ev-comment",
        a.comments.length > 0 ? `💬 ${a.comments.length} · comment` : "💬 Comment"
      );
      comment.type = "button";
      comment.addEventListener("click", () => this.openComment(a));
      strip.appendChild(comment);
    } else if (a.comments.length > 0) {
      strip.appendChild(el("span", "ltk-ev-comment-count", `💬 ${a.comments.length}`));
    }

    item.appendChild(strip);

    // the latest comment, inline for context
    const last = a.comments[a.comments.length - 1];
    if (last) {
      item.appendChild(
        el(
          "div",
          "ltk-ev-lastcomment",
          `"${last.text}" — ${last.who || last.whoId || "unknown"}, ${last.when}`
        )
      );
    }
    return item;
  }

  private openComment(a: LtkAction): void {
    const ta = textArea("", { placeholder: "Add a comment…", rows: 3 });
    const dlg = openDialog({
      host: this.root,
      title: a.issue || "Escalation",
      buttons: [
        { label: "Cancel", kind: "secondary", onClick: () => dlg.close() },
        {
          label: "Save",
          kind: "primary",
          onClick: () => {
            const text = ta.value.trim();
            if (text === "") return;
            a.comments.push({
              whoId: this.viewer.whoId,
              who: this.viewer.who || undefined,
              when: todayIso(),
              text,
            });
            dlg.close();
            this.emit();
          },
        },
      ],
    });
    if (a.comments.length > 0) {
      const history = el("div", "ltk-ev-history");
      for (const c of a.comments.slice(-5)) {
        history.appendChild(
          el("div", "ltk-ev-history-row", `${c.when} · ${c.who || c.whoId || "unknown"}: ${c.text}`)
        );
      }
      dlg.body.appendChild(history);
    }
    dlg.body.appendChild(fieldRow("Comment", ta));
    ta.focus();
  }

  // ---- emission ----

  private emit(): void {
    this.render();
    this.cb.onChange(this.actions);
    this.png.schedule();
  }

  // ---- PNG export ----

  private generatePng(): void {
    if (!this.cb.onPngReady) return;
    htmlToPng(this.root, LTK_BASE_CSS + ESCALATION_CSS, this.theme.background, (uri, svg) =>
      this.cb.onPngReady!(uri, svg)
    );
  }

  private downloadPng(): void {
    htmlToPng(this.root, LTK_BASE_CSS + ESCALATION_CSS, this.theme.background, (uri) => {
      const link = document.createElement("a");
      link.href = uri;
      link.download = "escalations.png";
      link.click();
    });
  }
}
