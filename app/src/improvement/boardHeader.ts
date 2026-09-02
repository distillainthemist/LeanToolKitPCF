// Improvement — the initiative board's DETAILS PANE + title-zone bits
// (P6e remake, Ben's markup 2026-08-28; supersedes the two-tier header
// band). Three hosts, one mount:
//   • titleHost (board toolbar): stage pill · flag/confidential chips
//   • controlsHost (board toolbar): Current | All seg (default All) · ⋮
//   • paneHost (the right side column, the meeting schedule pane's spot):
//     key details (org · period · priority · roles · health) → the STAGE
//     RAIL (every stage with target date + gate approvals, the chevron
//     stepper's replacement — richer and vertical) → commentary
//     (High / Low / Next / Support needed; latest with ‹ older stepping).
//
// Escalation notifies the sponsor by Teams/email through the docs notify
// road (dynamic import — the connectors stay docs-only per the import
// gate; this module is itself a lazy chunk off the board path).

import { el, clear } from "../../../shared/ui/dom";
import { initialsFor } from "../../../shared/schema/people";
import { nowIso, todayIso } from "../../../shared/schema/id";
import { currentViewer } from "../runtime";
import { promptConfirm } from "../prompts";
import { listPeople } from "../store/people";
import { improvementSettingsJson } from "../store/config";
import { appendInitiativeEvent, listInitiativeEvents, listInitiatives, saveInitiative } from "../store/initiatives";
import { InitiativeEvent } from "../store/initiatives";
import { dayLabel } from "../linkTitle";
import { Initiative, myRoles, nextGateFor, PendingGate } from "./initiativeModel";
import { HealthQuestion, parseImprovementSettings, PDCA_TOKENS, roleFillersAt } from "./templateModel";

const btn = (label: string, cls = "app-btn"): HTMLButtonElement => {
  const b = el("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  return b;
};

export interface InitiativePaneOpts {
  paneHost: HTMLElement;
  titleHost: HTMLElement;
  controlsHost: HTMLElement;
  boardId: string;
  /** The board repaints its tiles through this filter: slot stage id →
   *  show? The stage list rides along for tile chips, the current ring
   *  and future-stage placeholders. */
  onStageFilter: (
    mode: "current" | "all",
    currentStageId: string,
    stages: { id: string; name: string; fg: string; bg: string }[]
  ) => void;
  /** Called when a gate's final approval lands, BEFORE the stage moves —
   *  the board stamps its snapshot here (P6e). */
  onGateApproved?: (stageName: string) => Promise<void>;
}

export interface InitiativePaneHandle {
  teardown: () => void;
  /** Scroll the pane's stage rail to the active stage (Show details). */
  revealActive: () => void;
}

export function mountInitiativePane(o: InitiativePaneOpts): InitiativePaneHandle {
  const pane = el("div", "app-ib-pane");
  o.paneHost.appendChild(pane);
  let dead = false;
  const cleanups: (() => void)[] = [];
  let activeStageEl: HTMLElement | null = null;

  void (async () => {
    const who = currentViewer();
    const [all, roster, impRaw] = await Promise.all([listInitiatives(), listPeople(), improvementSettingsJson()]);
    if (dead) return;
    const initiative = all.find((x) => x.boardId === o.boardId) ?? null;
    if (!initiative) {
      pane.remove();
      return;
    }
    let i = initiative;
    const imp = parseImprovementSettings(impRaw);
    const palettes = await import("../store/config").then((m) => m.appPalettes()).catch(() => null);
    const stateMap = palettes ? (await import("../../../shared/palette")).paletteMap(palettes.states) : {};
    const stateColor = (key: string): string => (stateMap as Record<string, string>)[key] ?? "#9a948a";
    const me = roster.find((p) => p.whoId === (who?.objectId ?? "")) ?? null;
    const isAdmin = me?.role === "superadmin" || me?.role === "siteadmin";
    const mine = () => myRoles(i, who?.objectId ?? "").length > 0 || isAdmin;
    const actor = () => ({ whoId: who?.objectId ?? "", who: me?.who ?? who?.name ?? "" });
    let stageMode: "current" | "all" = "all"; // default All (Ben, 2026-08-28)

    const roleLabel = (key: string) => i.snapshot.roleLabels[key] ?? key;
    const emailOf = (whoId: string) => roster.find((p) => p.whoId === whoId)?.email ?? "";

    /** Everyone who may act for a role on THIS initiative: the people
     *  assigned on the header, plus the site's standard-role fillers. */
    const actorsForRole = (key: string): { whoId: string; who: string }[] => {
      const assigned = i.roles[key] ?? [];
      const std = imp.standardRoles.find((r) => r.key === key);
      const fillers = std ? roleFillersAt(std, i.org.site) : [];
      const seen = new Set<string>();
      return [...assigned, ...fillers].filter((p) => {
        if (seen.has(p.whoId)) return false;
        seen.add(p.whoId);
        return true;
      });
    };
    const iAmApprover = (roles: string[]) => roles.some((r) => actorsForRole(r).some((p) => p.whoId === (who?.objectId ?? "")));

    const persist = async () => {
      await saveInitiative(i);
    };

    // one event read serves the rail's history AND the commentary trail
    let events: InitiativeEvent[] = [];
    const loadEvents = async () => {
      events = await listInitiativeEvents(i).catch(() => []);
    };

    const render = () => {
      clear(o.titleHost);
      clear(o.controlsHost);
      clear(pane);
      o.onStageFilter(
        stageMode,
        i.stageId,
        i.snapshot.stages.map((st) => ({ id: st.id, name: st.name, fg: PDCA_TOKENS[st.pdca].fg, bg: PDCA_TOKENS[st.pdca].bg }))
      );

      // ---- title zone: stage pill + state chips -----------------------------
      const stage = i.snapshot.stages.find((s) => s.id === i.stageId) ?? null;
      if (i.status === "completed") {
        o.titleHost.appendChild(el("span", "app-im-stagechip app-ib-titlepill", "✓ Complete"));
      } else if (stage && !i.singleAction) {
        const pill = el("span", "app-im-stagechip app-ib-titlepill", stage.name);
        pill.style.color = PDCA_TOKENS[stage.pdca].fg;
        pill.style.background = PDCA_TOKENS[stage.pdca].bg;
        o.titleHost.appendChild(pill);
      }
      if (i.flag === "escalated") {
        const sponsor = (i.roles.sponsor ?? [])[0]?.who ?? "sponsor";
        const chip = el("span", "app-im-chip", `▲ Escalated to ${sponsor}`);
        chip.style.background = stateColor("issue");
        chip.style.color = "#fff";
        o.titleHost.appendChild(chip);
      } else if (i.flag === "flag") {
        const chip = el("span", "app-im-chip", "⚐ Needs support");
        chip.style.border = `1px solid ${stateColor("atrisk")}`;
        chip.style.color = stateColor("atrisk");
        o.titleHost.appendChild(chip);
      }
      if (i.confidential) o.titleHost.appendChild(el("span", "app-im-chip app-im-chip-conf", "◈ Confidential"));
      if (i.status !== "active" && i.status !== "completed") o.titleHost.appendChild(el("span", "app-status-badge", i.status));

      // ---- controls: Current | All (accent seg, ui-standard) + ⋮ ------------
      const seg = el("div", "app-docs-seg");
      for (const [v, l] of [["current", "Current stage"], ["all", "All stages"]] as const) {
        const b = btn(l, "app-docs-segbtn" + (stageMode === v ? " app-docs-segbtn-on" : ""));
        b.addEventListener("click", () => {
          stageMode = v;
          render();
        });
        seg.appendChild(b);
      }
      o.controlsHost.appendChild(seg);
      const more = btn("⋮", "app-btn app-cp-more");
      more.addEventListener("click", () => openMenu(more));
      o.controlsHost.appendChild(more);

      // ---- pane -------------------------------------------------------------
      pane.appendChild(renderKeyDetails());
      pane.appendChild(renderStageRail());
      pane.appendChild(renderCommentary());
    };

    // ---- key details (pane top) --------------------------------------------------
    const renderKeyDetails = (): HTMLElement => {
      const box = el("div", "app-ib-keys");
      const line = (label: string, node: HTMLElement | string) => {
        const row = el("div", "app-ib-keyrow");
        row.appendChild(el("span", "app-ib-keyk", label));
        if (typeof node === "string") row.appendChild(el("span", "app-ib-keyv", node));
        else row.appendChild(node);
        box.appendChild(row);
      };
      line("Org", [i.org.site, i.org.department, i.org.area].filter((s) => s !== "").join(" · ") || i.org.company);
      line("Period", i.period || "—");
      line("Method", i.method || "—");
      // roles: avatars + names
      const rolesBox = el("span", "app-ib-keyv");
      const seen = new Set<string>();
      for (const [key, people] of Object.entries(i.roles)) {
        for (const p of people) {
          if (seen.has(`${key}|${p.whoId}`)) continue;
          seen.add(`${key}|${p.whoId}`);
          const chip = el("span", "app-ib-rolechip");
          const a = el("span", "app-ib-avatar", initialsFor(p.who));
          a.title = p.who;
          chip.append(a, el("span", "app-ib-rolechip-t", `${p.who} · ${roleLabel(key)}`));
          rolesBox.appendChild(chip);
        }
      }
      if (seen.size === 0) rolesBox.textContent = "—";
      line("Roles", rolesBox);
      // health
      const health = parseHealth(i.fieldValues.__health ?? "");
      const healthBtn = btn(health ? `Health ${health.score} / ${health.of} · ${health.at.slice(5, 7)}/${health.at.slice(2, 4)}` : "Health check", "app-btn app-ib-health");
      healthBtn.title = imp.healthQuestions.length === 0 ? "No health questions set — Settings → Improvement" : "Run a health check";
      healthBtn.disabled = imp.healthQuestions.length === 0 || !mine() || i.status !== "active";
      healthBtn.addEventListener("click", () => openHealth());
      const hrow = el("div", "app-ib-keyrow");
      hrow.appendChild(el("span", "app-ib-keyk", "Health"));
      hrow.appendChild(healthBtn);
      box.appendChild(hrow);
      return box;
    };

    // ---- the stage rail (the stepper's replacement) ------------------------------
    const renderStageRail = (): HTMLElement => {
      const rail = el("div", "app-ib-rail");
      rail.appendChild(el("div", "app-tw-preview-h", "Stages & gates"));
      const stages = i.snapshot.stages;
      const curIdx = Math.max(0, stages.findIndex((s) => s.id === i.stageId));
      activeStageEl = null;

      /** Past gate/move history for a stage, from the one event read. */
      const historyFor = (stageName: string): string[] =>
        events
          .filter((e) => (e.kind === "stagemove" || e.kind === "gate") && (String(e.detail.from ?? "") === stageName || String(e.detail.to ?? "") === stageName))
          .map((e) => `${e.at.slice(0, 10)} · ${e.actorName} · ${e.kind === "gate" ? `gate ${String(e.detail.what ?? "")}` : `${String(e.detail.from ?? "")} → ${String(e.detail.to ?? "")}`}${String(e.detail.comment ?? "") !== "" ? ` — “${String(e.detail.comment)}”` : ""}`)
          .reverse();

      const gateBlock = (stageIdx: number): HTMLElement | null => {
        // the gate AFTER stages[stageIdx] (or the Complete gate)
        const isLast = stageIdx === stages.length - 1;
        const gate = isLast ? i.snapshot.completeGate : stages[stageIdx].gate;
        const toName = isLast ? "Complete" : (stages[stageIdx + 1]?.name ?? "");
        const isCurrent = stageIdx === curIdx && i.status === "active";
        if (!gate.enabled && !isCurrent) return null;
        const box = el("div", "app-ib-gateblock");
        if (!gate.enabled) {
          box.appendChild(el("div", "app-cp-muted", `→ ${toName} · no approval needed`));
          if (isCurrent && mine()) {
            const move = btn(`Move to ${toName}`, "app-btn app-ib-gatebtn");
            move.addEventListener("click", () => openMoveDialog(isLast ? "" : stages[stageIdx + 1].id));
            box.appendChild(move);
          }
          return box;
        }
        box.appendChild(el("div", "app-ib-gatehead", `⚑ Gate → ${toName}`));
        const pending = isCurrent ? i.gate : null;
        for (const role of gate.approverRoles) {
          const d = pending?.decisions[role];
          const glyph = d ? (d.approved ? "✓" : "✕") : "◐";
          const cls = d ? (d.approved ? "app-ib-appr-ok" : "app-ib-appr-no") : "app-ib-appr-wait";
          const row = el("div", "app-ib-apprrow");
          row.appendChild(el("span", "app-ib-appr " + cls, `${glyph} ${roleLabel(role)}`));
          const pool = actorsForRole(role);
          row.appendChild(
            el(
              "span",
              "app-ib-apprwho",
              d ? `${d.byName} · ${d.at.slice(0, 10)}${d.comment !== "" ? ` — “${d.comment}”` : ""}` : pool.length > 0 ? pool.map((p) => p.who).join(", ") : "nobody fills this role"
            )
          );
          box.appendChild(row);
        }
        if (isCurrent) {
          if (pending === null) {
            if (mine()) {
              const req = btn("Request gate", "app-btn app-btn-primary app-ib-gatebtn");
              req.addEventListener("click", () => requestGate(isLast ? "" : stages[stageIdx + 1].id, toName, gate.approverRoles));
              box.appendChild(req);
            }
          } else if (iAmApprover(gate.approverRoles.filter((r) => !pending.decisions[r]))) {
            const line = el("div", "app-ib-gatebtns");
            const approve = btn("Approve", "app-btn app-btn-primary app-ib-gatebtn");
            const decline = btn("Decline", "app-btn app-btn-danger app-ib-gatebtn");
            approve.addEventListener("click", () => void decide(pending, true));
            decline.addEventListener("click", () => void decide(pending, false));
            line.append(approve, decline);
            box.appendChild(line);
          } else {
            box.appendChild(el("div", "app-cp-muted", `requested by ${pending.requestedByName} · ${pending.requestedAt.slice(0, 10)}`));
          }
        }
        return box;
      };

      stages.forEach((s, idx) => {
        const state = i.status === "completed" || idx < curIdx ? "done" : idx === curIdx ? "current" : "future";
        const row = el("div", `app-ib-railstage app-ib-railstage-${state}`);
        row.style.borderLeftColor = PDCA_TOKENS[s.pdca].fg;
        const head = el("div", "app-ib-railhead");
        head.appendChild(el("span", "app-ib-railname", `${state === "done" ? "✓ " : ""}${s.name}`));
        const target = i.stageTargets[s.id] ?? "";
        if (target !== "") {
          const t = el("span", "app-ib-railtarget", dayLabel(target));
          if (state === "current" && target < todayIso()) {
            t.style.color = stateColor("issue");
            t.style.fontWeight = "700";
          }
          head.appendChild(t);
        }
        row.appendChild(head);
        if (state === "current") {
          row.classList.add("app-ib-rail-on");
          activeStageEl = row;
        }
        if (state === "done") {
          const hist = historyFor(s.name);
          if (hist.length > 0) {
            const h = el("div", "app-ib-railhist");
            for (const lineTxt of hist.slice(0, 3)) h.appendChild(el("div", undefined, lineTxt));
            row.appendChild(h);
          }
        }
        const gb = gateBlock(idx);
        if (gb) row.appendChild(gb);
        rail.appendChild(row);
      });
      // the Complete row
      const doneRow = el("div", "app-ib-railstage app-ib-railstage-" + (i.status === "completed" ? "done" : "future"));
      doneRow.appendChild(el("div", "app-ib-railhead")).appendChild(el("span", "app-ib-railname", `${i.status === "completed" ? "✓ " : ""}Complete`));
      rail.appendChild(doneRow);
      return rail;
    };

    const requestGate = (toStageId: string, toName: string, approverRoles: string[]) => {
      void promptConfirm({
        title: `Ask ${approverRoles.map(roleLabel).join(" and ")} to approve the move to ${toName}?`,
        confirmLabel: "Request gate",
      }).then(async (yes) => {
        if (!yes) return;
        i.gate = {
          from: i.stageId,
          to: toStageId,
          requestedById: actor().whoId,
          requestedByName: actor().who,
          requestedAt: nowIso(),
          decisions: {},
          approverRoles,
        };
        await persist();
        await appendInitiativeEvent(i, "gate", { what: "requested", from: i.snapshot.stages.find((s) => s.id === i.stageId)?.name ?? "", to: toName }, actor());
        await loadEvents();
        render();
      });
    };

    const decide = async (pending: PendingGate, approved: boolean) => {
      const myRolesHere = pending.approverRoles.filter((r) => !pending.decisions[r] && actorsForRole(r).some((p) => p.whoId === actor().whoId));
      if (myRolesHere.length === 0) return;
      let comment = "";
      if (!approved) {
        const c = prompt("Why is this gate declined? The team sees this.") ?? "";
        if (c.trim() === "") return;
        comment = c.trim();
      }
      for (const role of myRolesHere) {
        pending.decisions[role] = { by: actor().whoId, byName: actor().who, at: nowIso(), approved, comment };
      }
      await appendInitiativeEvent(i, "gate", { what: approved ? "approved" : "declined", roles: myRolesHere, comment }, actor());
      const allDone = pending.approverRoles.every((r) => pending.decisions[r]?.approved);
      const anyDeclined = pending.approverRoles.some((r) => pending.decisions[r] && !pending.decisions[r].approved);
      if (allDone) {
        // stamp the gate snapshot BEFORE the stage moves (P6e)
        const stageName = i.snapshot.stages.find((s) => s.id === i.stageId)?.name ?? i.stageId;
        await o.onGateApproved?.(stageName).catch(() => undefined);
        await moveStage(pending.to, "gate approved");
        return;
      }
      if (anyDeclined) i.gate = pending; // stays visible with the ✕ until re-requested
      await persist();
      await loadEvents();
      render();
    };

    // ---- stage moves ------------------------------------------------------------
    const moveStage = async (toStageId: string, comment: string) => {
      const from = i.snapshot.stages.find((s) => s.id === i.stageId)?.name ?? i.stageId;
      if (toStageId === "") {
        i.status = "completed";
        await appendInitiativeEvent(i, "stagemove", { from, to: "Complete", comment }, actor());
      } else {
        i.stageId = toStageId;
        const to = i.snapshot.stages.find((s) => s.id === toStageId)?.name ?? toStageId;
        await appendInitiativeEvent(i, "stagemove", { from, to, comment }, actor());
      }
      i.gate = null;
      await persist();
      await loadEvents();
      render();
    };

    const openMoveDialog = (toStageId: string) => {
      const ng = nextGateFor(i);
      const toName = toStageId === "" ? "Complete" : (i.snapshot.stages.find((s) => s.id === toStageId)?.name ?? "");
      if (ng?.gated && !(i.gate && ng.approverRoles.every((r) => i.gate?.decisions[r]?.approved))) {
        void promptConfirm({
          title: `${ng.fromName} → ${toName} needs approval`,
          note: `Approvers: ${(ng.approverRoles ?? []).map(roleLabel).join(", ")}. Request the gate — the move happens when everyone approves.`,
          confirmLabel: "Request gate",
        }).then((yes) => {
          if (!yes) return;
          requestGate(toStageId, toName, ng.approverRoles);
        });
        return;
      }
      const c = prompt(`Move to ${toName}? A comment for the log (optional):`);
      if (c === null) return;
      void moveStage(toStageId, c.trim());
    };

    // ---- commentary (High / Low / Next / Support needed) -------------------------
    interface Comment {
      high: string;
      low: string;
      next: string;
      support: string;
      who: string;
      at: string;
    }
    let commentIdx = 0; // 0 = latest
    const commentList = (): Comment[] =>
      events
        .filter((e) => e.kind === "comment")
        .map((c) => ({
          high: String(c.detail.high ?? ""),
          low: String(c.detail.low ?? ""),
          next: String(c.detail.next ?? ""),
          support: String(c.detail.support ?? ""),
          who: c.actorName,
          at: c.at,
        }));

    const renderCommentary = (): HTMLElement => {
      const box = el("div", "app-ib-comment");
      const head = el("div", "app-ib-comment-head");
      head.appendChild(el("span", "app-tw-preview-h", "Commentary"));
      head.appendChild(el("span", "app-bar-gap"));
      if (mine() && i.status === "active") {
        const add = btn("Add", "app-cp-ov-link");
        add.addEventListener("click", () => openAddComment());
        head.appendChild(add);
      }
      box.appendChild(head);
      const list = commentList();
      if (commentIdx >= list.length) commentIdx = Math.max(0, list.length - 1);
      const c = list[commentIdx] ?? null;
      if (c === null) box.appendChild(el("div", "app-cp-muted", "No commentary yet."));
      else {
        for (const [label, text] of [["High", c.high], ["Low", c.low], ["Next", c.next], ["Support needed", c.support]] as const) {
          if (text === "") continue;
          const line = el("div", "app-ib-comment-line");
          line.append(el("span", "app-ib-comment-k", label), el("span", undefined, text));
          box.appendChild(line);
        }
        const meta = el("div", "app-ib-comment-meta");
        meta.appendChild(el("span", "ltk-mw-help", `${c.who} · ${c.at.slice(0, 10)}${commentIdx > 0 ? ` · ${commentIdx} newer` : ""}`));
        meta.appendChild(el("span", "app-bar-gap"));
        if (commentIdx < list.length - 1) {
          const older = btn("‹ older", "app-cp-ov-link");
          older.addEventListener("click", () => {
            commentIdx++;
            render();
          });
          meta.appendChild(older);
        }
        if (commentIdx > 0) {
          const newer = btn("newer ›", "app-cp-ov-link");
          newer.addEventListener("click", () => {
            commentIdx--;
            render();
          });
          meta.appendChild(newer);
        }
        box.appendChild(meta);
      }
      return box;
    };

    const openAddComment = () => {
      const scrim = el("div", "app-modal-overlay");
      const box = el("div", "app-modal");
      box.appendChild(el("div", "app-modal-title", "Add commentary"));
      const mk = (label: string, ph: string) => {
        const ta = el("textarea", "app-input") as HTMLTextAreaElement;
        ta.rows = 2;
        ta.placeholder = ph;
        const f = el("div", "app-field");
        f.append(el("span", "app-field-label", label), ta);
        box.appendChild(f);
        return ta;
      };
      const high = mk("High", "What went well");
      const low = mk("Low", "What hurt");
      const next = mk("Next", "What happens next");
      const support = mk("Support needed", "What would unblock this");
      // support text and the ⚐ flag must not silently disagree — the tick
      // pre-arms when support text exists, stays the author's call
      let flagWrap: HTMLElement | null = null;
      let flagBox: HTMLInputElement | null = null;
      if (i.flag === "") {
        flagWrap = el("label", "app-check app-ib-supportflag");
        flagBox = el("input") as HTMLInputElement;
        flagBox.type = "checkbox";
        flagWrap.append(flagBox, el("span", undefined, "Raise the ⚐ Needs support flag"));
        flagWrap.style.display = "none";
        box.appendChild(flagWrap);
        support.addEventListener("input", () => {
          const has = support.value.trim() !== "";
          flagWrap!.style.display = has ? "" : "none";
          if (has && !flagBox!.dataset.touched) flagBox!.checked = true;
        });
        flagBox.addEventListener("change", () => {
          flagBox!.dataset.touched = "1";
        });
      }
      const foot = el("div", "app-modal-footer");
      const cancel = btn("Cancel", "app-link");
      cancel.addEventListener("click", () => scrim.remove());
      const save = btn("Save", "app-btn app-btn-primary");
      save.addEventListener("click", () => {
        void (async () => {
          await appendInitiativeEvent(
            i,
            "comment",
            { high: high.value.trim(), low: low.value.trim(), next: next.value.trim(), support: support.value.trim() },
            actor()
          );
          if (flagBox?.checked && support.value.trim() !== "" && i.flag === "") {
            i.flag = "flag";
            await persist();
            await appendInitiativeEvent(i, "flag", { flag: "flag" }, actor());
          }
          scrim.remove();
          commentIdx = 0;
          await loadEvents();
          render();
        })();
      });
      foot.append(cancel, save);
      box.appendChild(foot);
      scrim.appendChild(box);
      document.body.appendChild(scrim);
    };

    // ---- health check (§2.4; questions from Settings → Improvement) --------------
    const openHealth = () => {
      const scrim = el("div", "app-modal-overlay");
      const box = el("div", "app-modal");
      box.appendChild(el("div", "app-modal-title", "Health check"));
      box.appendChild(el("div", "app-modal-note", "The company question set — answer as things stand today."));
      const answers = new Map<string, number>();
      for (const q of imp.healthQuestions) {
        const f = el("div", "app-field");
        f.appendChild(el("span", "app-field-label", q.label));
        const rowEl = el("div", "app-cp-reasons");
        const opts = q.scale === "yesno" ? [["0", "No"], ["1", "Yes"]] : [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"]];
        for (const [v, l] of opts) {
          const chip = btn(l, "app-cp-reason");
          chip.addEventListener("click", () => {
            answers.set(q.key, Number(v));
            rowEl.querySelectorAll(".app-cp-reason").forEach((x) => x.classList.remove("app-cp-reason-on"));
            chip.classList.add("app-cp-reason-on");
          });
          rowEl.appendChild(chip);
        }
        f.appendChild(rowEl);
        box.appendChild(f);
      }
      const err = el("div", "app-cp-err", "");
      box.appendChild(err);
      const foot = el("div", "app-modal-footer");
      const cancel = btn("Cancel", "app-link");
      cancel.addEventListener("click", () => scrim.remove());
      const save = btn("Save", "app-btn app-btn-primary");
      save.addEventListener("click", () => {
        if (answers.size < imp.healthQuestions.length) {
          err.textContent = "Answer every question.";
          return;
        }
        void (async () => {
          // score = achieved / possible, weighted
          let got = 0;
          let of = 0;
          for (const q of imp.healthQuestions) {
            const max = q.scale === "yesno" ? 1 : 5;
            got += (answers.get(q.key) ?? 0) * q.weight;
            of += max * q.weight;
          }
          const score = Math.round((got / Math.max(1, of)) * 10);
          i.fieldValues.__health = JSON.stringify({ score, of: 10, at: todayIso() });
          await persist();
          await appendInitiativeEvent(i, "health", { score, of: 10, answers: Object.fromEntries(answers) }, actor());
          scrim.remove();
          render();
        })();
      });
      foot.append(cancel, save);
      box.appendChild(foot);
      scrim.appendChild(box);
      document.body.appendChild(scrim);
    };

    // ---- ⋮ + escalation (notify via the docs road) -------------------------------
    const openMenu = (anchor: HTMLElement) => {
      document.querySelectorAll(".app-cp-menu").forEach((m) => m.remove());
      const menu = el("div", "app-cp-menu");
      const item = (label: string, run: () => void, disabled = false) => {
        const b = btn(label, "app-cp-menu-item");
        b.disabled = disabled;
        b.addEventListener("click", () => {
          menu.remove();
          run();
        });
        menu.appendChild(b);
      };
      item("Edit details…", () => {
        void import("./editDetails").then(({ openEditDetails }) => {
          openEditDetails({
            host: document.body,
            initiative: i,
            actor: actor(),
            onSaved: () => window.location.reload(),
          });
        });
      }, !mine());
      item(i.flag === "" ? "⚐ Flag — needs support" : "Clear flag", () => {
        void (async () => {
          i.flag = i.flag === "" ? "flag" : "";
          i.flagNote = "";
          await persist();
          await appendInitiativeEvent(i, "flag", { flag: i.flag }, actor());
          render();
        })();
      }, !mine());
      item("▲ Escalate to sponsor", () => void escalate(), !mine() || i.flag === "escalated");
      item(i.endorsement ? "Owner endorsement: on" : "Owner endorsement: off", () => {
        void (async () => {
          i.endorsement = !i.endorsement;
          await persist();
          render();
        })();
      }, !mine());
      item("＋ Add card from template", () => void addFromTemplate(), !mine() || i.status !== "active" || i.templateId === "");
      item(i.status === "archived" ? "Restore" : "Archive", () => {
        void (async () => {
          i.status = i.status === "archived" ? "active" : "archived";
          await persist();
          await appendInitiativeEvent(i, i.status === "archived" ? "archived" : "reopened", {}, actor());
          render();
        })();
      }, !mine());
      const r = anchor.getBoundingClientRect();
      menu.style.top = `${r.bottom + 4}px`;
      menu.style.left = `${Math.min(r.left, window.innerWidth - 260)}px`;
      document.body.appendChild(menu);
      const off = (e: PointerEvent) => {
        if (!menu.contains(e.target as Node)) {
          menu.remove();
          document.removeEventListener("pointerdown", off, true);
        }
      };
      setTimeout(() => document.addEventListener("pointerdown", off, true), 0);
      cleanups.push(() => menu.remove());
    };

    /** The template's OPTIONAL cards not yet on this board (design 2.3). */
    const addFromTemplate = async () => {
      const [{ getTemplate }, { getBoard, saveManifest }, { parseManifest }] = await Promise.all([
        import("../store/templates"),
        import("../store/boards"),
        import("../store/mappers"),
      ]);
      const t = await getTemplate(i.templateId);
      if (!t || t.boardId === "") return;
      const [tplBoard, myBoard] = await Promise.all([getBoard(t.boardId), getBoard(i.boardId)]);
      if (!tplBoard || !myBoard) return;
      const tplSlots = parseManifest(tplBoard.manifestRaw).slots;
      const manifest = parseManifest(myBoard.manifestRaw);
      const have = new Set(manifest.slots.map((sl) => sl.cardId));
      const offer = tplSlots.filter((sl) => {
        const tpl = (sl.settings.template ?? {}) as Record<string, unknown>;
        return tpl.mandatory !== true && !have.has(sl.cardId);
      });
      if (offer.length === 0) {
        void promptConfirm({ title: "Nothing to add", note: "Every optional card from the template is already on this board.", confirmLabel: "OK" });
        return;
      }
      const menu = el("div", "app-cp-menu");
      const stageName = (sl: (typeof offer)[number]) => {
        const tpl = (sl.settings.template ?? {}) as Record<string, unknown>;
        const st = i.snapshot.stages.find((x) => x.id === String(tpl.stage ?? ""));
        return st ? ` · ${st.name}` : "";
      };
      for (const sl of offer) {
        const b = btn(`＋ ${sl.title || sl.cardType}${stageName(sl)}`, "app-cp-menu-item");
        b.addEventListener("click", () => {
          menu.remove();
          void (async () => {
            manifest.slots.push({ ...sl, pos: manifest.slots.length + 1, nav: manifest.slots.length + 1 });
            await saveManifest(myBoard.id, manifest);
            window.location.reload();
          })();
        });
        menu.appendChild(b);
      }
      menu.style.top = "120px";
      menu.style.left = "50%";
      document.body.appendChild(menu);
      const off = (e: PointerEvent) => {
        if (!menu.contains(e.target as Node)) {
          menu.remove();
          document.removeEventListener("pointerdown", off, true);
        }
      };
      setTimeout(() => document.addEventListener("pointerdown", off, true), 0);
    };

    const escalate = async () => {
      // the document-control notify anatomy (Ben, 2026-08-20): recipient
      // chips + message + send by Teams or email, outcome in place
      const { openEscalateDialog } = await import("./escalate");
      const sponsors = actorsForRole("sponsor")
        .map((p) => ({ name: p.who, email: emailOf(p.whoId) }))
        .filter((p) => p.email !== "");
      openEscalateDialog({
        host: document.body,
        initiativeTitle: i.title,
        orgLine: `${actor().who} escalated "${i.title}" (${i.org.site}${i.org.department ? " · " + i.org.department : ""})`,
        recipients: sponsors,
        link: `${window.location.origin}${window.location.pathname}${window.location.search}#/board/${i.boardId}`,
        onEscalate: async (note) => {
          i.flag = "escalated";
          i.flagNote = note;
          await persist();
          await appendInitiativeEvent(i, "flag", { flag: "escalated", note }, actor());
          render();
        },
      });
    };

    await loadEvents();
    if (dead) return;
    render();
  })().catch(() => pane.remove());

  return {
    teardown: () => {
      dead = true;
      for (const fn of cleanups) fn();
      pane.remove();
    },
    revealActive: () => {
      activeStageEl?.scrollIntoView({ block: "center", behavior: "smooth" });
    },
  };
}

function parseHealth(raw: string): { score: number; of: number; at: string } | null {
  try {
    const o = JSON.parse(raw || "null") as { score?: unknown; of?: unknown; at?: unknown };
    if (typeof o?.score !== "number") return null;
    return { score: o.score, of: typeof o.of === "number" ? o.of : 10, at: typeof o.at === "string" ? o.at : "" };
  } catch {
    return null;
  }
}

export type { HealthQuestion };
