// Improvement — "Edit details…" for an existing initiative: the shared
// header form (initiativeForm.ts, six groups) pre-filled, in a 820px
// modal. Saves back to the header row (and renames the initiative's
// board when the title changes); History gets an "edited" event.
// Reached from the Improvement row kebab and the board header's ⋮.
// Period is not on the form (edit-details-proposal-2026-10.md §2.2):
// the spread keeps the record's start period as it is.

import { el, clear } from "../../../shared/ui/dom";
import { parseOrgTree } from "../../../shared/schema/meeting";
import { appPalettes, improvementSettingsJson, orgJson, siteCompanies } from "../store/config";
import { paletteMap } from "../../../shared/palette";
import { assigneePeople } from "../../../shared/schema/people";
import { listPeople } from "../store/people";
import { loadCascade } from "../store/priorities";
import { getTemplate } from "../store/templates";
import { appendInitiativeEvent, ensureMetricCards, saveInitiative } from "../store/initiatives";
import { Ben_ltkboardsService } from "../generated/services/Ben_ltkboardsService";
import { eq, upsertWhere } from "../store/dv";
import { promptConfirm } from "../prompts";
import { Initiative } from "./initiativeModel";
import { parseImprovementSettings, roleFillersAt, TemplateRole, activeRoles } from "./templateModel";
import { renderInitiativeForm } from "./initiativeForm";

const btn = (label: string, cls = "app-btn"): HTMLButtonElement => {
  const b = el("button", cls, label) as HTMLButtonElement;
  b.type = "button";
  return b;
};

export interface EditDetailsOpts {
  host: HTMLElement;
  initiative: Initiative;
  actor: { whoId: string; who: string };
  onSaved: () => void;
}

export function openEditDetails(o: EditDetailsOpts): void {
  const overlay = el("div", "app-modal-overlay");
  const box = el("div", "app-modal app-modal-form app-im-create");
  overlay.appendChild(box);
  o.host.appendChild(overlay);
  const close = () => overlay.remove();
  // a FORM never closes on a stray click outside it — Cancel or Save is
  // the way out (Ben, 2026-10-07: an edit lost to a click off the box)

  box.appendChild(el("div", "app-modal-title", "Edit details"));
  const body = el("div", "app-cp-modal-body");
  box.appendChild(body);
  body.appendChild(el("div", "app-settings-note", "Loading…"));

  void (async () => {
    const i = o.initiative;
    const [treeRaw, siteCo, roster, impRaw, template, palettes] = await Promise.all([
      orgJson(),
      siteCompanies(),
      listPeople(),
      improvementSettingsJson(),
      i.templateId !== "" ? getTemplate(i.templateId).catch(() => null) : Promise.resolve(null),
      appPalettes().catch(() => ({ states: [], titles: [] })),
    ]);
    clear(body);
    const sites = parseOrgTree(treeRaw);
    const imp = parseImprovementSettings(impRaw);

    // roles: template roles when the template survives, else the roles the
    // initiative carries (snapshot labels)
    const roleDefs: TemplateRole[] =
      (template ? activeRoles(template) : undefined) ??
      Object.keys({ ...i.snapshot.roleLabels, ...i.roles }).map((key) => ({
        key,
        label: i.snapshot.roleLabels[key] ?? key,
        standard: true,
        multi: true,
        timeCommitment: false,
      }));
    const meRow = roster.find((p) => p.whoId === o.actor.whoId) ?? null;
    const canPromote = (() => {
      if (meRow?.role === "superadmin") return true;
      const role = imp.standardRoles.find((r) => r.key === imp.vdtEditorRole);
      return role !== undefined && roleFillersAt(role, i.org.site).some((p) => p.whoId === o.actor.whoId);
    })();

    const form = renderInitiativeForm({
      host: body,
      dialogHost: o.host,
      mode: "edit",
      sites,
      siteCo,
      roster,
      imp,
      roleDefs,
      fields: [...imp.standardFields, ...(template?.fields ?? [])],
      singleAction: i.singleAction,
      metricRule: template?.metricRule ?? "none",
      initial: {
        title: i.title,
        description: i.description,
        org: { ...i.org },
        alsoOrgs: (i.alsoOrgs ?? []).map((x) => ({ ...x })),
        priorities: i.priorities.map((l) => ({ ...l, label: l.priorityId })),
        roles: i.roles,
        fieldValues: i.fieldValues,
        metrics: i.metrics,
        confidential: i.confidential,
        endorsement: i.endorsement,
      },
      fiCtx: { people: assigneePeople([], roster, "search"), palette: paletteMap(palettes.states) },
      canPromote,
      loadPriorities: (company) => loadCascade(company).then((data) => data.priorities),
      // linking an own metric migrates its card's private points into the driver
      onMetricLinked: async (m) => {
        if (i.boardId === "" || !m.driverId) return;
        const [{ getBoard }, { parseManifest }, { mergeCardSeriesIntoDriver }] = await Promise.all([
          import("../store/boards"),
          import("../store/mappers"),
          import("../store/driverSeries"),
        ]);
        const board = await getBoard(i.boardId);
        if (!board) return;
        const slot = parseManifest(board.manifestRaw).slots.find(
          (sl) => sl.cardType === "KpiTrendCard" && String(((sl.settings.metric ?? {}) as Record<string, unknown>).key ?? "") === m.key
        );
        if (!slot) return;
        const r = await mergeCardSeriesIntoDriver(i.boardId, slot.cardId, m.driverId);
        if (r.moved > 0 || r.kept > 0) {
          await promptConfirm({
            title: "Series merged",
            note: `${r.moved} point${r.moved === 1 ? "" : "s"} moved into the driver's series${r.kept > 0 ? `; ${r.kept} kept the driver's existing value` : ""}. The card records into the driver from now on.`,
            confirmLabel: "OK",
          });
        }
      },
    });

    const footer = el("div", "app-modal-footer");
    const cancel = btn("Cancel", "app-link");
    cancel.addEventListener("click", close);
    const save = btn("Save details", "app-btn app-btn-primary");
    save.addEventListener("click", () => {
      void (async () => {
        if (form.validate().length > 0) return;
        const v = form.read();
        const next: Initiative = {
          ...i,
          title: v.title,
          description: v.description,
          org: v.org,
          alsoOrgs: v.alsoOrgs,
          confidential: v.confidential,
          endorsement: v.endorsement,
          roles: v.roles,
          priorities: v.priorities.map((l) => ({ priorityId: l.priorityId, primary: l.primary })),
          fieldValues: v.fieldValues,
          metrics: v.metrics,
        };
        save.disabled = true;
        const endorsementWentOff = i.endorsement && !next.endorsement;
        Object.assign(i, next);
        await saveInitiative(i);
        // endorsement switched off: what was waiting for an endorser closes
        if (endorsementWentOff) {
          try {
            const { closeAwaitingEndorsement } = await import("../store/actions");
            const n = await closeAwaitingEndorsement(i);
            if (n > 0) await promptConfirm({ title: "Waiting actions closed", note: `${n} action${n === 1 ? " was" : "s were"} awaiting endorsement and ${n === 1 ? "is" : "are"} now closed.`, confirmLabel: "OK" });
          } catch {
            /* the details are saved; the actions stay waiting and can be closed by hand */
          }
        }
        // a KPI card per metric on the board — added for new metrics, dropped
        // for removed ones only when empty
        try {
          const r = await ensureMetricCards(i);
          if (r.kept.length > 0) {
            await promptConfirm({ title: "Cards kept", note: `${r.kept.join(", ")} still hold recorded points, so their cards stay on the board.`, confirmLabel: "OK" });
          }
        } catch {
          /* the board catches up on its next open */
        }
        // the board carries the title as its name — keep them together
        if (i.boardId !== "" && i.title !== "") {
          await upsertWhere(
            Ben_ltkboardsService,
            eq("ben_boardid", i.boardId),
            (row) => row.ben_ltkboardid,
            { ben_boardid: i.boardId, ben_name: i.title }
          ).catch(() => undefined);
        }
        await appendInitiativeEvent(i, "edited", { fields: "details" }, o.actor);
        // claim the primary priority's primary-initiative slot when empty
        const primaryLink = i.priorities.find((l) => l.primary) ?? null;
        if (primaryLink) await import("../store/priorities").then((m) => m.setPrimaryInitiative(primaryLink.priorityId, i.id, true)).catch(() => false);
        close();
        o.onSaved();
      })().catch((e) => {
        form.showError(e instanceof Error ? e.message : String(e));
        save.disabled = false;
      });
    });
    footer.append(cancel, save);
    box.appendChild(footer);
    form.focus();
  })().catch((e) => {
    clear(body);
    body.appendChild(el("div", "app-board-note", `Could not load: ${e instanceof Error ? e.message : String(e)}`));
  });
}
