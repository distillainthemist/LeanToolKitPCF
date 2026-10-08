// Improvement — the initiative board's DETAILS PANE + title-zone bits
// (P6e remake, Ben's markup 2026-08-28; supersedes the two-tier header
// band). Three hosts, one mount:
//   • titleHost (board toolbar): stage pill · flag/confidential chips
//   • controlsHost (board toolbar): Current | All seg (default All) · ⋮
//   • paneHost (the right side column, the meeting schedule pane's spot):
//     key details (org · period · priority · roles · health) → the STAGE
//     RAIL (every stage with target date + gate approvals, the chevron
//     stepper's replacement — richer and vertical) → commentary
//     (High / Low / Next / Support needed; every update, newest first).
//   • bandHost (above the cards, 2026-09-29): the STATUS BAND — the
//     current stage and its gate, and the latest update, always in view.
//
// Escalation notifies the sponsor by Teams/email through the docs notify
// road (dynamic import — the connectors stay docs-only per the import
// gate; this module is itself a lazy chunk off the board path).

import { el, clear } from "../../../shared/ui/dom";
import { initialsFor } from "../../../shared/schema/people";
import { nowIso, todayIso } from "../../../shared/schema/id";
import { currentViewer } from "../runtime";
import { promptConfirm, promptText } from "../prompts";
import { listPeople } from "../store/people";
import { improvementSettingsJson } from "../store/config";
import { currentPeriodNow } from "../store/priorities";
import { appendInitiativeEvent, listInitiativeEvents, listInitiatives, saveInitiative } from "../store/initiatives";
import { InitiativeEvent } from "../store/initiatives";
import { dayLabel } from "../linkTitle";
import { boardUrl } from "../links";
import { WORKING_FOLDER_KEY, linkDisplayText, workingFolderUrl } from "./workingFolder";
import { copyText } from "../../../shared/ui/clipboard";
import { Initiative, myRoles, nextGateFor, PendingGate } from "./initiativeModel";
import { mergeUserPrefs, userPrefsJson } from "../store/config";
import { openUpdateDialog, renderTrail } from "./commentary";
import { addUpdate, editUpdate } from "./commentaryActions";
import { daysBetween, staleDays, Update, updatesFrom } from "./commentaryModel";
import { BandGate, BandStage, renderStatusBand } from "./statusBand";
import { actionBelongsTo, LtkAction } from "../../../shared/schema/actions";
import { endorsementOn, endorserIds } from "./endorsers";
import { applyRevert, gateDeclined, mayRevert, mayWithdraw, revertTargets, standingRevert, StageViewer, undoneApproverRoles } from "./stageRevert";
import { HealthQuestion, parseImprovementSettings, PDCA_TOKENS, roleFillersAt, PDCA_ORDER } from "./templateModel";

const btn = (label: string, cls = "app-btn"): HTMLButtonElement => {
  const b = el("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  return b;
};

export interface InitiativePaneOpts {
  paneHost: HTMLElement;
  titleHost: HTMLElement;
  controlsHost: HTMLElement;
  /** Where ⋮ goes (the toolbar's far right); defaults to controlsHost. */
  kebabHost?: HTMLElement;
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
  /** Above the cards: the status band (stage and gate · latest update). */
  bandHost?: HTMLElement;
  /** The band asks for the details pane to be opened. */
  onOpenPane?: () => void;
}

export interface InitiativePaneHandle {
  teardown: () => void;
  /** Scroll the pane's stage rail to the active stage (Show details). */
  revealActive: () => void;
  /** Scroll the pane to its commentary trail. */
  revealCommentary: () => void;
  /** Re-read the initiative and repaint the pane alone (a charter's bound
   *  field wrote the header — no board remount, 2026-09-15). */
  refresh: () => Promise<void>;
}

export function mountInitiativePane(o: InitiativePaneOpts): InitiativePaneHandle {
  const pane = el("div", "app-ib-pane");
  o.paneHost.appendChild(pane);
  let dead = false;
  const cleanups: (() => void)[] = [];
  let activeStageEl: HTMLElement | null = null;
  let commentaryEl: HTMLElement | null = null;
  let refreshPane: () => Promise<void> = async () => undefined;

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
    refreshPane = async () => {
      const fresh = (await listInitiatives()).find((x) => x.boardId === o.boardId) ?? null;
      if (dead || !fresh) return;
      i = fresh;
      render();
    };
    const imp = parseImprovementSettings(impRaw);
    const palettes = await import("../store/config").then((m) => m.appPalettes()).catch(() => null);
    const stateMap = palettes ? (await import("../../../shared/palette")).paletteMap(palettes.states) : {};
    const stateColor = (key: string): string => (stateMap as Record<string, string>)[key] ?? "#9a948a";
    const me = roster.find((p) => p.whoId === (who?.objectId ?? "")) ?? null;
    const isAdmin = me?.role === "superadmin" || me?.role === "siteadmin";
    const mine = () => myRoles(i, who?.objectId ?? "").length > 0 || isAdmin;
    const actor = () => ({ whoId: who?.objectId ?? "", who: me?.who ?? who?.name ?? "" });
    let stageMode: "current" | "all" = "all"; // default All (Ben, 2026-08-28)
    // the band's one-line state follows the person (their prefs row)
    let bandCollapsed = false;
    try {
      const prefs = JSON.parse((await userPrefsJson(who?.objectId ?? "").catch(() => "")) || "{}") as { initiativeBand?: { collapsed?: unknown } };
      bandCollapsed = prefs.initiativeBand?.collapsed === true;
    } catch {
      bandCollapsed = false;
    }
    if (dead) return;

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
    // the actions waiting for an endorser (endorsement on), for the band
    let awaiting: LtkAction[] = [];
    const loadAwaiting = async () => {
      if (!endorsementOn(i)) {
        awaiting = [];
        return;
      }
      const { actionsForInitiatives } = await import("../store/actions");
      awaiting = (await actionsForInitiatives().catch(() => [])).filter((a) => a.status === "verify" && actionBelongsTo(i, a));
    };
    const loadEvents = async () => {
      [events] = await Promise.all([listInitiativeEvents(i).catch(() => []), loadAwaiting()]);
    };

    const render = () => {
      clear(o.titleHost);
      clear(o.controlsHost);
      if (o.kebabHost) clear(o.kebabHost);
      clear(pane);
      if (o.bandHost) {
        clear(o.bandHost);
        o.bandHost.appendChild(renderBand());
      }
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
      (o.kebabHost ?? o.controlsHost).appendChild(more);

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
      // the working folder (2026-10-08): the one link to where the work's
      // documents live — a new tab, or "Set folder…" for the initiative's people
      const folderBox = el("span", "app-ib-keyv app-ib-folder");
      const folder = workingFolderUrl(i.fieldValues);
      if (folder !== "") {
        const a = el("a", "app-ib-folderlink", `📁 ${linkDisplayText(folder)} ↗`) as HTMLAnchorElement;
        a.href = folder;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.title = folder;
        folderBox.appendChild(a);
      } else {
        folderBox.appendChild(el("span", "app-cp-muted", "No working folder set"));
      }
      if (mine() && i.status === "active") {
        const set = btn(folder !== "" ? "Change…" : "Set folder…", "app-link app-ib-folderset");
        set.addEventListener("click", () => {
          void promptText({
            title: "Working folder",
            note: "The SharePoint or Teams folder where this initiative's documents live — an https link.",
            initial: folder,
            placeholder: "https://…sharepoint.com/sites/…/Shared Documents/…",
            confirmLabel: "Save",
          }).then(async (v) => {
            if (v === null) return;
            const next = v.trim();
            if (next !== "" && !/^https:\/\/\S+$/i.test(next)) return;
            i.fieldValues[WORKING_FOLDER_KEY] = next;
            await persist();
            render();
          });
        });
        folderBox.appendChild(set);
      }
      line("Folder", folderBox);
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
          .map((e) => `${e.at.slice(0, 10)} · ${e.actorName} · ${e.kind === "gate" ? `gate ${String(e.detail.what ?? "")}` : `${e.detail.revert === true ? "↩ reverted " : ""}${String(e.detail.from ?? "")} → ${String(e.detail.to ?? "")}`}${String(e.detail.comment ?? "") !== "" ? ` — “${String(e.detail.comment)}”` : ""}`)
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
          } else {
            box.appendChild(el("div", "app-cp-muted", `requested by ${pending.requestedByName} · ${pending.requestedAt.slice(0, 10)}`));
            const line = el("div", "app-ib-gatebtns");
            if (iAmApprover(gate.approverRoles.filter((r) => !pending.decisions[r]))) {
              const approve = btn("Approve", "app-btn app-btn-primary app-ib-gatebtn");
              const decline = btn("Decline", "app-btn app-btn-danger app-ib-gatebtn");
              approve.addEventListener("click", () => void decide(pending, true));
              decline.addEventListener("click", () => void decide(pending, false));
              line.append(approve, decline);
            }
            // a declined gate can be asked again; a waiting one withdrawn
            if (gateDeclined(i) && mine()) {
              const again = btn("Request again", "app-btn app-btn-primary app-ib-gatebtn");
              again.addEventListener("click", () => requestGate(isLast ? "" : stages[stageIdx + 1].id, toName, gate.approverRoles));
              line.appendChild(again);
            }
            if (mayWithdraw(i, stageViewer())) {
              const wd = btn("Withdraw request", "app-btn app-ib-gatebtn");
              wd.addEventListener("click", () => void withdrawGate());
              line.appendChild(wd);
            }
            if (line.childElementCount > 0) box.appendChild(line);
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
          if (mayRevert(i, stageViewer())) {
            const back = btn(i.status === "completed" ? "↩ Reopen into this stage…" : "↩ Revert to this stage…", "app-cp-ov-link app-ib-revert");
            back.addEventListener("click", () => openRevert(s.id));
            row.appendChild(back);
          }
        }
        const gb = gateBlock(idx);
        if (gb) row.appendChild(gb);
        rail.appendChild(row);
      });
      // the Complete row
      const doneRow = el("div", "app-ib-railstage app-ib-railstage-" + (i.status === "completed" ? "done" : "future"));
      doneRow.appendChild(el("div", "app-ib-railhead")).appendChild(el("span", "app-ib-railname", `${i.status === "completed" ? "✓ " : ""}Complete`));
      if (i.status === "completed" && mayRevert(i, stageViewer())) {
        const reopen = btn("↩ Reopen…", "app-cp-ov-link app-ib-revert");
        reopen.addEventListener("click", () => openRevert());
        doneRow.appendChild(reopen);
      }
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
        const c = await promptText({
          title: "Decline this gate?",
          note: "Say why — the team sees this, and it stays on the stage's record.",
          placeholder: "What needs to change before this can move on",
          confirmLabel: "Decline",
          multiline: true,
          required: "A reason is needed.",
          danger: true,
        });
        if (c === null) return;
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

    // ---- going back (2026-09-29): withdraw a request, revert a stage ------------
    const stageViewer = (): StageViewer => ({
      whoId: who?.objectId ?? "",
      isAdmin,
      ownerIds: actorsForRole("owner").map((p) => p.whoId),
      sponsorIds: actorsForRole("sponsor").map((p) => p.whoId),
    });
    const withdrawGate = async () => {
      const pending = i.gate;
      if (pending === null || !mayWithdraw(i, stageViewer())) return;
      const toName = pending.to === "" ? "Complete" : (i.snapshot.stages.find((st) => st.id === pending.to)?.name ?? pending.to);
      const why = await promptText({
        title: "Withdraw the gate request?",
        note: `The request to move to ${toName} is cancelled and the decisions made so far are cleared. It can be requested again later.`,
        placeholder: "Why it is being withdrawn",
        confirmLabel: "Withdraw request",
        multiline: true,
        required: "A reason is needed — it goes on the record.",
      });
      if (why === null) return;
      i.gate = null;
      await persist();
      await appendInitiativeEvent(i, "gate", { what: "withdrawn", to: toName, comment: why.trim() }, actor());
      await loadEvents();
      render();
    };
    const openRevert = (preselect?: string) => {
      if (!mayRevert(i, stageViewer())) return;
      const completed = i.status === "completed";
      const fromName = completed ? "Complete" : (i.snapshot.stages.find((st) => st.id === i.stageId)?.name ?? i.stageId);
      const me = actor().whoId;
      void import("./revertDialog").then(({ openRevertDialog }) =>
        openRevertDialog({
          host: document.body,
          initiativeTitle: i.title,
          completed,
          fromName,
          targets: revertTargets(i),
          preselect,
          targetDates: { ...i.stageTargets },
          // the approvers whose sign-off this undoes, and the sponsor —
          // never the person doing it
          recipientsFor: (toStageId) => {
            const seen = new Set<string>([me]);
            const out: { name: string; email: string }[] = [];
            for (const role of [...undoneApproverRoles(i, toStageId), "sponsor"]) {
              for (const p of actorsForRole(role)) {
                if (seen.has(p.whoId)) continue;
                seen.add(p.whoId);
                const email = emailOf(p.whoId);
                if (email !== "") out.push({ name: p.who, email });
              }
            }
            return out;
          },
          lineFor: (toName) => `${actor().who} ${completed ? "reopened" : "reverted"} "${i.title}" from ${fromName} to ${toName} (${i.org.site}${i.org.department ? " · " + i.org.department : ""})`,
          link: boardUrl(i.boardId),
          onRevert: async (toStageId, reason, newTarget) => {
            const moved = applyRevert(i, toStageId, newTarget);
            if (moved === null) throw new Error("that stage is no longer one it can go back to");
            await persist();
            await appendInitiativeEvent(i, "stagemove", { from: moved.from, to: moved.to, comment: reason, revert: true, ...(newTarget !== "" ? { target: newTarget } : {}) }, actor());
            await loadEvents();
            render();
          },
        })
      );
    };

    // ---- stage moves ------------------------------------------------------------
    const moveStage = async (toStageId: string, comment: string) => {
      const from = i.snapshot.stages.find((s) => s.id === i.stageId)?.name ?? i.stageId;
      if (toStageId === "") {
        i.status = "completed";
        i.toPeriod = await currentPeriodNow();
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
      void promptText({
        title: toStageId === "" ? "Complete this initiative?" : `Move to ${toName}?`,
        note: "A comment for the log (optional).",
        placeholder: "What this stage achieved, or why it is moving on",
        confirmLabel: toStageId === "" ? "Complete" : `Move to ${toName}`,
        multiline: true,
      }).then((c) => {
        if (c === null) return;
        void moveStage(toStageId, c.trim());
      });
    };

    // ---- commentary (High / Low / Next / Support needed) -------------------------
    // Any member of the initiative team may add AND edit (Ben, 2026-09-29);
    // an edit keeps the earlier wording. Nothing is deleted.
    const canComment = () => mine() && i.status === "active";
    const updates = (): Update[] => updatesFrom(events);
    const afterWrite = async () => {
      await loadEvents();
      render();
    };
    const openAdd = () =>
      openUpdateDialog({
        offerFlag: i.flag === "",
        onSave: async (fields, raiseFlag) => {
          await addUpdate(i, fields, raiseFlag, actor());
          await afterWrite();
        },
      });
    const openEdit = (u: Update) =>
      openUpdateDialog({
        existing: u,
        offerFlag: false,
        onSave: async (fields) => {
          await editUpdate(u, fields, actor());
          await afterWrite();
        },
      });

    /** The pane's trail: every update, newest first. */
    const renderCommentary = (): HTMLElement => {
      const box = el("div", "app-ib-comment");
      commentaryEl = box;
      const head = el("div", "app-ib-comment-head");
      const list = updates();
      head.appendChild(el("span", "app-tw-preview-h", list.length > 0 ? `Commentary · ${list.length}` : "Commentary"));
      head.appendChild(el("span", "app-bar-gap"));
      if (canComment()) {
        const add = btn("Add update", "app-cp-ov-link");
        add.addEventListener("click", openAdd);
        head.appendChild(add);
      }
      box.appendChild(head);
      if (list.length === 0) box.appendChild(el("div", "app-cp-muted", "No commentary yet."));
      else box.appendChild(renderTrail({ list, today: todayIso(), canEdit: canComment(), onEdit: openEdit }));
      return box;
    };

    // ---- endorsement: the owner's, the sponsor's, an admin's queue ---------------
    const mayEndorse = (): boolean => isAdmin || endorserIds(i, imp.standardRoles).includes(who?.objectId ?? "");
    const openReview = () => {
      void import("./endorseReview").then(({ openEndorseReview }) =>
        openEndorseReview({
          host: document.body,
          initiativeTitle: i.title,
          actions: awaiting,
          by: actor(),
          onDecided: async (changed) => {
            const { upsertActions } = await import("../store/actions");
            await upsertActions(changed);
            await loadEvents();
            render();
            window.dispatchEvent(new CustomEvent("ltk-actions-changed"));
          },
        })
      );
    };
    // an action closed, endorsed or sent back elsewhere on the board
    const onActionsSaved = () => {
      void loadAwaiting().then(() => {
        if (!dead) render();
      });
    };
    window.addEventListener("ltk-actions-changed", onActionsSaved);
    cleanups.push(() => window.removeEventListener("ltk-actions-changed", onActionsSaved));

    // ---- the status band (above the cards) ----------------------------------------
    const openPaneAt = (reveal: () => void) => {
      o.onOpenPane?.();
      setTimeout(reveal, 80);
    };
    const bandStage = (): BandStage | null => {
      const stages = i.snapshot.stages;
      if (stages.length === 0) return null;
      const idx = Math.max(0, stages.findIndex((st) => st.id === i.stageId));
      const cur = stages[idx];
      const target = i.stageTargets[cur.id] ?? "";
      return {
        name: cur.name,
        position: idx + 1,
        count: stages.length,
        stages: stages.map((st) => ({
          name: st.name,
          cycle: PDCA_ORDER.indexOf(st.pdca),
          cycleLabel: PDCA_TOKENS[st.pdca].label,
          fg: PDCA_TOKENS[st.pdca].fg,
          bg: PDCA_TOKENS[st.pdca].bg,
        })),
        fg: PDCA_TOKENS[cur.pdca].fg,
        bg: PDCA_TOKENS[cur.pdca].bg,
        target,
        overdueDays: target !== "" && target < todayIso() ? daysBetween(target, todayIso()) : null,
      };
    };
    const bandGate = (): BandGate | null => {
      const stages = i.snapshot.stages;
      if (i.status === "completed" && stages.length > 0) {
        return {
          tone: "muted",
          text: "Every stage is complete",
          approvals: [],
          actions: mayRevert(i, stageViewer()) ? [{ label: "↩ Reopen…", kind: "plain", onClick: () => openRevert() }] : [],
        };
      }
      if (i.status !== "active" || stages.length === 0) return null;
      const idx = Math.max(0, stages.findIndex((st) => st.id === i.stageId));
      const isLast = idx === stages.length - 1;
      const gate = isLast ? i.snapshot.completeGate : stages[idx].gate;
      const toName = isLast ? "Complete" : stages[idx + 1].name;
      const toId = isLast ? "" : stages[idx + 1].id;
      if (!gate.enabled) {
        return {
          tone: "muted",
          text: `Next: ${toName} · no approval needed`,
          approvals: [],
          actions: mine() ? [{ label: `Move to ${toName}`, kind: "plain", onClick: () => openMoveDialog(toId) }] : [],
        };
      }
      const pending = i.gate;
      if (pending === null) {
        return {
          tone: "muted",
          text: `⚑ Gate to ${toName} · not yet requested`,
          approvals: gate.approverRoles.map((r) => ({ label: roleLabel(r), state: "wait" as const })),
          actions: mine() ? [{ label: "Request gate", kind: "primary", onClick: () => requestGate(toId, toName, gate.approverRoles) }] : [],
        };
      }
      const undecided = pending.approverRoles.filter((r) => !pending.decisions[r]);
      const declined = pending.approverRoles.filter((r) => pending.decisions[r] && !pending.decisions[r].approved);
      return {
        tone: declined.length > 0 ? "no" : "wait",
        text:
          declined.length > 0
            ? `⚑ Gate to ${toName} · declined by ${declined.map(roleLabel).join(", ")}`
            : `⚑ Gate to ${toName} · waiting on ${undecided.map(roleLabel).join(", ")}`,
        approvals: pending.approverRoles.map((r) => {
          const d = pending.decisions[r];
          return { label: roleLabel(r), state: d ? (d.approved ? ("ok" as const) : ("no" as const)) : ("wait" as const) };
        }),
        actions: [
          ...(iAmApprover(undecided)
            ? [
                { label: "Approve", kind: "primary" as const, onClick: () => void decide(pending, true) },
                { label: "Decline", kind: "danger" as const, onClick: () => void decide(pending, false) },
              ]
            : []),
          ...(declined.length > 0 && mine() ? [{ label: "Request again", kind: "primary" as const, onClick: () => requestGate(toId, toName, gate.approverRoles) }] : []),
          ...(mayWithdraw(i, stageViewer()) ? [{ label: "Withdraw request", kind: "plain" as const, onClick: () => void withdrawGate() }] : []),
        ],
      };
    };
    const renderBand = (): HTMLElement => {
      const list = updates();
      const started = events.length > 0 ? events[events.length - 1].at : "";
      return renderStatusBand({
        collapsed: bandCollapsed,
        onToggle: () => {
          bandCollapsed = !bandCollapsed;
          render();
          const id = who?.objectId ?? "";
          if (id !== "") void mergeUserPrefs(id, { initiativeBand: { collapsed: bandCollapsed } }).catch(() => undefined);
        },
        stage: i.singleAction ? null : bandStage(),
        revert: i.status === "active" ? standingRevert(events) : null,
        endorse: endorsementOn(i) ? { count: awaiting.length, mine: mayEndorse(), onReview: openReview } : null,
        completed: i.status === "completed",
        gate: i.singleAction ? null : bandGate(),
        onOpenStages: () => openPaneAt(() => activeStageEl?.scrollIntoView({ block: "center", behavior: "smooth" })),
        latest: list[0] ?? null,
        updateCount: list.length,
        today: todayIso(),
        stale: i.status === "active" ? staleDays(list[0]?.at ?? "", started, todayIso()) : null,
        canComment: canComment(),
        onAdd: openAdd,
        onEdit: openEdit,
        onAllUpdates: () => openPaneAt(() => commentaryEl?.scrollIntoView({ block: "start", behavior: "smooth" })),
      });
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
      // a permalink (Ben, 2026-09-29): the player's own URL, so it opens
      // the app ON this initiative from a chat, an email or a bookmark.
      // The menu stays open to say it worked; a host that refuses the
      // clipboard hands over the raw URL to copy by hand (the ritual
      // "Copy link" pattern).
      if (i.boardId !== "") {
        const copy = btn("🔗 Copy link to this initiative", "app-cp-menu-item");
        copy.addEventListener("click", () => {
          const link = boardUrl(i.boardId);
          void copyText(link).then((ok) => {
            if (!ok) {
              const box = el("input", "app-input app-ritual-link app-ib-linkbox") as HTMLInputElement;
              box.value = link;
              box.readOnly = true;
              box.setAttribute("aria-label", "Link to this initiative — copy it");
              copy.replaceWith(box);
              box.focus();
              box.select();
              return;
            }
            copy.textContent = "✓ Link copied";
            window.setTimeout(() => menu.remove(), 1100);
          });
        });
        menu.appendChild(copy);
      }
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
      // Owner endorsement is a DETAIL of the initiative, set in Edit
      // details — not a menu action (Ben, 2026-09-29)
      if (!i.singleAction) {
        item(i.status === "completed" ? "↩ Reopen initiative…" : "↩ Revert to an earlier stage…", () => openRevert(), !mayRevert(i, stageViewer()));
      }
      item("＋ Add card from template", () => void addFromTemplate(), !mine() || i.status !== "active" || i.templateId === "");
      item("Reset board to template…", () => void resetToTemplate(), !mine() || i.status !== "active" || i.templateId === "");
      item(i.status === "archived" ? "Restore" : "Archive", () => {
        void (async () => {
          i.status = i.status === "archived" ? "active" : "archived";
          i.toPeriod = i.status === "archived" ? await currentPeriodNow() : "";
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
            // its template cell when that is free, else the first free cell
            const { firstFreePos } = await import("../store/initiatives");
            const cols = Number(manifest.grid) || 2;
            const taken = manifest.slots.some((x) => x.pos === sl.pos);
            const wanted = sl.pos >= 1 && !taken ? sl.pos : firstFreePos(manifest.slots, cols);
            manifest.slots.push({ ...sl, pos: wanted, nav: Math.max(0, ...manifest.slots.map((x) => x.nav || 0)) + 1 });
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

    /** Put the board back to the template's card set and layout (Ben,
     *  2026-09-14). Cards that survive keep their content; hand-added
     *  cards leave the board but their data stays in the tables. */
    const resetToTemplate = async () => {
      const { previewBoardReset, resetBoardToTemplate } = await import("../store/initiatives");
      const p = await previewBoardReset(i);
      if (!p) {
        await promptConfirm({ title: "No template board", note: "This initiative's template has no board to reset to.", confirmLabel: "OK" });
        return;
      }
      const lines = [
        "Layout, card set and card settings return to the template's. Cards the template still has keep what's on them.",
        p.drops.length > 0 ? `Leaving the board: ${p.drops.join(", ")} — their content stays stored and comes back if the card is added again.` : "",
        p.adds.length > 0 ? `Coming back: ${p.adds.join(", ")}.` : "",
      ].filter((x) => x !== "");
      const ok = await promptConfirm({ title: "Reset this board to its template?", note: lines.join("\n\n"), confirmLabel: "Reset board" });
      if (!ok) return;
      const done = await resetBoardToTemplate(i, actor());
      if (done) window.location.reload();
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
        link: boardUrl(i.boardId),
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
      if (o.bandHost) clear(o.bandHost);
    },
    revealActive: () => {
      activeStageEl?.scrollIntoView({ block: "center", behavior: "smooth" });
    },
    revealCommentary: () => {
      commentaryEl?.scrollIntoView({ block: "start", behavior: "smooth" });
    },
    refresh: () => refreshPane(),
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
