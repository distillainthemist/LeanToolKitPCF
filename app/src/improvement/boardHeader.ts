// Improvement — the initiative board's header band (P6a; design spec
// `leanboard-cascade-initiative-board-design.md` §2.1–2.2). Two tiers:
// tier 1 always (breadcrumb · title · flag chip · role avatars · health ·
// ▴/▾ · ⋮), tier 2 collapsible (stage stepper doubling as the gate
// control + gate line, commentary block). Board.ts mounts this above the
// grid for `init-` project boards and gets back the current-stage filter.
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
import { Initiative, myRoles, nextGateFor, PendingGate } from "./initiativeModel";
import { boardOrigin, REOPEN_PRIORITY_KEY } from "./boardOrigin";
import { HealthQuestion, parseImprovementSettings, PDCA_TOKENS, roleFillersAt } from "./templateModel";

const btn = (label: string, cls = "app-btn"): HTMLButtonElement => {
  const b = el("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  return b;
};

export interface InitiativeHeaderOpts {
  host: HTMLElement;
  boardId: string;
  /** The board repaints its tiles through this filter: slot stage id →
   *  show? (the Current stage / All stages control lives here). The stage
   *  list rides along for tile chips, the current ring and future-stage
   *  placeholders. */
  onStageFilter: (
    mode: "current" | "all",
    currentStageId: string,
    stages: { id: string; name: string; fg: string; bg: string }[]
  ) => void;
}

const TIER2_KEY = "ltk-initiative-tier2";

export function mountInitiativeHeader(o: InitiativeHeaderOpts): () => void {
  const band = el("div", "app-ib-band");
  o.host.appendChild(band);
  let dead = false;
  const cleanups: (() => void)[] = [];

  void (async () => {
    const who = currentViewer();
    const [all, roster, impRaw] = await Promise.all([listInitiatives(), listPeople(), improvementSettingsJson()]);
    if (dead) return;
    const initiative = all.find((x) => x.boardId === o.boardId) ?? null;
    if (!initiative) {
      band.remove();
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
    let tier2Open = localStorage.getItem(TIER2_KEY) !== "0";
    let stageMode: "current" | "all" = "current";

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

    const render = () => {
      clear(band);
      o.onStageFilter(
        stageMode,
        i.stageId,
        i.snapshot.stages.map((st) => ({ id: st.id, name: st.name, fg: PDCA_TOKENS[st.pdca].fg, bg: PDCA_TOKENS[st.pdca].bg }))
      );

      // ---- tier 1 -----------------------------------------------------------
      const t1 = el("div", "app-ib-t1");
      // crumb returns WHERE THE BOARD WAS OPENED FROM (Ben, 2026-08-27):
      // the Improvement tab, or the Priorities tab with the overlay it
      // came from reopened (REOPEN_PRIORITY_KEY, consumed on mount)
      const origin = boardOrigin();
      const fromPriorities = origin !== null && origin.hash.startsWith("#/priorities");
      const crumb = el("a", "app-ib-crumb", fromPriorities ? "Priorities" : "Improvement") as HTMLAnchorElement;
      crumb.href = origin?.hash ?? "#/improvement";
      if (fromPriorities && origin?.priorityId) {
        crumb.addEventListener("click", () => {
          try {
            sessionStorage.setItem(REOPEN_PRIORITY_KEY, origin.priorityId ?? "");
          } catch {
            /* lands on the tab without the overlay */
          }
        });
      }
      t1.appendChild(crumb);
      t1.appendChild(el("span", "app-cp-crumb-sep", "›"));
      t1.appendChild(el("span", "app-ib-org", [i.org.site, i.org.department, i.org.area].filter((s) => s !== "").join(" · ") || i.org.company));
      t1.appendChild(el("span", "app-ib-title", i.title));
      if (i.flag === "escalated") {
        const sponsor = (i.roles.sponsor ?? [])[0]?.who ?? "sponsor";
        const chip = el("span", "app-im-chip", `▲ Escalated to ${sponsor}`);
        chip.style.background = stateColor("issue");
        chip.style.color = "#fff";
        t1.appendChild(chip);
      } else if (i.flag === "flag") {
        const chip = el("span", "app-im-chip", "⚐ Needs support");
        chip.style.border = `1px solid ${stateColor("atrisk")}`;
        chip.style.color = stateColor("atrisk");
        t1.appendChild(chip);
      }
      if (i.confidential) t1.appendChild(el("span", "app-im-chip app-im-chip-conf", "◈ Confidential"));
      if (i.status !== "active") t1.appendChild(el("span", "app-status-badge", i.status));
      t1.appendChild(el("span", "app-bar-gap"));
      // role avatars, overlapped, +n overflow
      const avatars = el("span", "app-ib-avatars");
      const people = Object.values(i.roles).flat();
      const seen = new Set<string>();
      const uniq = people.filter((p) => (seen.has(p.whoId) ? false : (seen.add(p.whoId), true)));
      uniq.slice(0, 5).forEach((p) => {
        const a = el("span", "app-ib-avatar", initialsFor(p.who));
        a.title = p.who;
        avatars.appendChild(a);
      });
      if (uniq.length > 5) avatars.appendChild(el("span", "app-ib-avatar app-ib-avatar-more", `+${uniq.length - 5}`));
      t1.appendChild(avatars);
      // health
      const health = parseHealth(i.fieldValues.__health ?? "");
      const healthBtn = btn(health ? `Health ${health.score} / ${health.of} · ${health.at.slice(5, 7)}/${health.at.slice(2, 4)}` : "Health check", "app-btn app-ib-health");
      healthBtn.title = imp.healthQuestions.length === 0 ? "No health questions set — Settings → Improvement" : "Run a health check";
      healthBtn.disabled = imp.healthQuestions.length === 0 || !mine() || i.status !== "active";
      healthBtn.addEventListener("click", () => openHealth());
      t1.appendChild(healthBtn);
      const tier2Btn = btn(tier2Open ? "▴ Less" : "▾ More", "app-btn");
      tier2Btn.addEventListener("click", () => {
        tier2Open = !tier2Open;
        localStorage.setItem(TIER2_KEY, tier2Open ? "1" : "0");
        render();
      });
      t1.appendChild(tier2Btn);
      const more = btn("⋮", "app-btn app-cp-more");
      more.addEventListener("click", () => openMenu(more));
      t1.appendChild(more);
      band.appendChild(t1);

      // ---- tier 2 -----------------------------------------------------------
      if (!tier2Open) {
        band.appendChild(renderStageFilter());
        return;
      }
      const t2 = el("div", "app-ib-t2");
      const left = el("div", "app-ib-t2-left");
      left.appendChild(renderStepper());
      left.appendChild(renderGateLine());
      left.appendChild(renderStageFilter());
      t2.appendChild(left);
      t2.appendChild(renderCommentary());
      band.appendChild(t2);
    };

    // ---- stepper (§2.2) --------------------------------------------------------
    const renderStepper = (): HTMLElement => {
      const strip = el("div", "app-tw-stepper app-ib-stepper");
      const stages = i.snapshot.stages;
      const curIdx = Math.max(0, stages.findIndex((s) => s.id === i.stageId));
      stages.forEach((s, idx) => {
        const state = idx < curIdx ? "done" : idx === curIdx ? "current" : "future";
        const gatedInto = idx > 0 && stages[idx - 1].gate.enabled;
        const chip = btn(`${state === "done" ? "✓ " : gatedInto && state === "future" ? "⚑ " : ""}${s.name}${state === "current" ? " · current" : ""}`, "app-tw-step app-ib-step app-ib-step-" + state + (gatedInto && state === "future" ? " app-ib-step-gated" : ""));
        chip.style.color = PDCA_TOKENS[s.pdca].fg;
        chip.style.background = PDCA_TOKENS[s.pdca].bg;
        if (state === "current") chip.classList.add("app-ib-step-on");
        if (state === "done") chip.addEventListener("click", () => openGateHistory(s.name));
        else if (idx === curIdx + 1 && mine() && i.status === "active") chip.addEventListener("click", () => openMoveDialog(s.id));
        strip.appendChild(chip);
      });
      const completeChip = btn(`${i.status === "completed" ? "✓ " : i.snapshot.completeGate.enabled ? "⚑ " : ""}Complete`, "app-tw-step app-tw-step-complete app-ib-step");
      if (curIdx === stages.length - 1 && mine() && i.status === "active") completeChip.addEventListener("click", () => openMoveDialog(""));
      strip.appendChild(completeChip);
      return strip;
    };

    // ---- gate line ---------------------------------------------------------------
    const renderGateLine = (): HTMLElement => {
      const line = el("div", "app-ib-gateline");
      const ng = nextGateFor(i);
      if (ng === null) {
        line.appendChild(el("span", "app-cp-muted", i.status === "completed" ? "Complete." : "—"));
        return line;
      }
      const overdue = ng.target !== "" && ng.target < todayIso();
      const gateLabel = el("span", "app-ib-gatelabel", `Next gate — ${ng.fromName} → ${ng.toName}${ng.target !== "" ? `, ${ng.target.slice(5)}` : ""}`);
      if (overdue) gateLabel.style.color = stateColor("issue");
      line.appendChild(gateLabel);
      if (!ng.gated) {
        line.appendChild(el("span", "app-cp-muted", "no approval needed"));
        return line;
      }
      const pending = i.gate;
      for (const role of ng.approverRoles) {
        const d = pending?.decisions[role];
        const glyph = d ? (d.approved ? "✓" : "✕") : "◐";
        const cls = d ? (d.approved ? "app-ib-appr-ok" : "app-ib-appr-no") : "app-ib-appr-wait";
        const chip = el("span", "app-ib-appr " + cls, `${glyph} ${roleLabel(role)}`);
        if (d) chip.title = `${d.byName} · ${d.at.slice(0, 10)}${d.comment !== "" ? ` — “${d.comment}”` : ""}`;
        line.appendChild(chip);
      }
      if (i.status !== "active") return line;
      if (pending === null) {
        if (mine()) {
          const req = btn("Request gate", "app-btn app-btn-primary app-ib-gatebtn");
          req.addEventListener("click", () => {
            void promptConfirm({
              title: `Ask ${ng.approverRoles.map(roleLabel).join(" and ")} to approve ${ng.fromName} → ${ng.toName}?`,
              confirmLabel: "Request gate",
            }).then(async (yes) => {
              if (!yes) return;
              i.gate = {
                from: i.stageId,
                to: ng.toName === "Complete" ? "" : (i.snapshot.stages[i.snapshot.stages.findIndex((s) => s.id === i.stageId) + 1]?.id ?? ""),
                requestedById: actor().whoId,
                requestedByName: actor().who,
                requestedAt: nowIso(),
                decisions: {},
                approverRoles: ng.approverRoles,
              };
              await persist();
              await appendInitiativeEvent(i, "gate", { what: "requested", from: ng.fromName, to: ng.toName }, actor());
              render();
            });
          });
          line.appendChild(req);
        }
      } else if (iAmApprover(pending.approverRoles.filter((r) => !pending.decisions[r]))) {
        const approve = btn("Approve", "app-btn app-btn-primary app-ib-gatebtn");
        const decline = btn("Decline", "app-btn app-btn-danger app-ib-gatebtn");
        approve.addEventListener("click", () => void decide(pending, true));
        decline.addEventListener("click", () => void decide(pending, false));
        line.append(approve, decline);
      } else {
        line.appendChild(el("span", "app-cp-muted", `requested by ${pending.requestedByName} · ${pending.requestedAt.slice(0, 10)}`));
      }
      return line;
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
        await moveStage(pending.to, "gate approved");
        return;
      }
      if (anyDeclined) i.gate = pending; // stays visible with the ✕ until re-requested
      await persist();
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
      render();
    };

    const openMoveDialog = (toStageId: string) => {
      const ng = nextGateFor(i);
      const toName = toStageId === "" ? "Complete" : (i.snapshot.stages.find((s) => s.id === toStageId)?.name ?? "");
      if (ng?.gated && !(i.gate && ng.approverRoles.every((r) => i.gate?.decisions[r]?.approved))) {
        // gated and not approved: the dialog explains, offers Request
        const roles = (ng.approverRoles ?? []).map(roleLabel).join(", ");
        void promptConfirm({
          title: `${ng.fromName} → ${toName} needs approval`,
          note: `Approvers: ${roles}. Request the gate — the move happens when everyone approves.`,
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
            approverRoles: ng.approverRoles,
          };
          await persist();
          await appendInitiativeEvent(i, "gate", { what: "requested", from: ng.fromName, to: toName }, actor());
          render();
        });
        return;
      }
      const c = prompt(`Move to ${toName}? A comment for the log (optional):`) ;
      if (c === null) return;
      void moveStage(toStageId, c.trim());
    };

    const openGateHistory = (stageName: string) => {
      void (async () => {
        const events = await listInitiativeEvents(i);
        const hits = events.filter((e) => (e.kind === "stagemove" || e.kind === "gate") && (String(e.detail.from ?? "") === stageName || String(e.detail.to ?? "") === stageName));
        const lines = hits.map((e) => `${e.at.slice(0, 10)} · ${e.actorName} · ${e.kind === "gate" ? `gate ${String(e.detail.what ?? "")}` : `moved ${String(e.detail.from ?? "")} → ${String(e.detail.to ?? "")}`}${String(e.detail.comment ?? "") !== "" ? ` — “${String(e.detail.comment)}”` : ""}`);
        void promptConfirm({ title: `${stageName} — what happened`, note: lines.length > 0 ? lines.join("\n") : "No recorded gate or move events for this stage.", confirmLabel: "OK" });
      })();
    };

    // ---- commentary (High / Low / Next) ---------------------------------------
    let latestComment: { high: string; low: string; next: string; who: string; at: string } | null = null;
    const renderCommentary = (): HTMLElement => {
      const box = el("div", "app-ib-comment");
      const head = el("div", "app-ib-comment-head");
      head.appendChild(el("span", "app-tw-preview-h", "Commentary"));
      head.appendChild(el("span", "app-bar-gap"));
      const hist = btn("History", "app-cp-ov-link");
      hist.addEventListener("click", () => void openCommentHistory());
      head.appendChild(hist);
      if (mine() && i.status === "active") {
        const add = btn("Add", "app-cp-ov-link");
        add.addEventListener("click", () => openAddComment());
        head.appendChild(add);
      }
      box.appendChild(head);
      if (latestComment === null) box.appendChild(el("div", "app-cp-muted", "No commentary yet."));
      else {
        for (const [label, text] of [["High", latestComment.high], ["Low", latestComment.low], ["Next", latestComment.next]] as const) {
          if (text === "") continue;
          const line = el("div", "app-ib-comment-line");
          line.append(el("span", "app-ib-comment-k", label), el("span", undefined, text));
          box.appendChild(line);
        }
        box.appendChild(el("div", "ltk-mw-help", `${latestComment.who} · ${latestComment.at.slice(0, 10)}`));
      }
      return box;
    };

    const loadLatestComment = async () => {
      const events = await listInitiativeEvents(i);
      const c = events.find((e) => e.kind === "comment");
      latestComment = c ? { high: String(c.detail.high ?? ""), low: String(c.detail.low ?? ""), next: String(c.detail.next ?? ""), who: c.actorName, at: c.at } : null;
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
      const foot = el("div", "app-modal-footer");
      const cancel = btn("Cancel", "app-link");
      cancel.addEventListener("click", () => scrim.remove());
      const save = btn("Save", "app-btn app-btn-primary");
      save.addEventListener("click", () => {
        void (async () => {
          await appendInitiativeEvent(i, "comment", { high: high.value.trim(), low: low.value.trim(), next: next.value.trim() }, actor());
          scrim.remove();
          await loadLatestComment();
          render();
        })();
      });
      foot.append(cancel, save);
      box.appendChild(foot);
      scrim.appendChild(box);
      band.appendChild(scrim);
    };

    const openCommentHistory = async () => {
      const events = await listInitiativeEvents(i);
      const cs = events.filter((e) => e.kind === "comment").slice(0, 12);
      const lines = cs.map((c) => `${c.at.slice(0, 10)} · ${c.actorName}\nHigh: ${String(c.detail.high ?? "—")}\nLow: ${String(c.detail.low ?? "—")}\nNext: ${String(c.detail.next ?? "—")}`);
      void promptConfirm({ title: "Commentary history", note: lines.length > 0 ? lines.join("\n\n") : "No commentary yet.", confirmLabel: "OK" });
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
      band.appendChild(scrim);
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
            host: band,
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
        host: band,
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

    // ---- stage filter (§2.3) -----------------------------------------------------
    const renderStageFilter = (): HTMLElement => {
      const rowEl = el("div", "app-ib-filter");
      const cur = btn(`Current stage`, "app-cp-seg-btn" + (stageMode === "current" ? " app-cp-seg-on" : ""));
      const allB = btn("All stages", "app-cp-seg-btn" + (stageMode === "all" ? " app-cp-seg-on" : ""));
      const seg = el("div", "app-cp-seg");
      seg.append(cur, allB);
      cur.addEventListener("click", () => {
        stageMode = "current";
        render();
      });
      allB.addEventListener("click", () => {
        stageMode = "all";
        render();
      });
      rowEl.appendChild(seg);
      return rowEl;
    };

    await loadLatestComment();
    if (dead) return;
    render();
  })().catch(() => band.remove());

  return () => {
    dead = true;
    for (const fn of cleanups) fn();
    band.remove();
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
