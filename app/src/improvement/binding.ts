// Improvement — the charter's bound-field provider (P6d, design 2.5).
// Board.ts and the card editor hand this to every CanvasCard mounted on
// an `init-` board: get() reads the initiative header, edit() opens the
// right affordance (text prompt, people picker) and writes the header —
// edit here or there, same data. Stage is read-only here (the stepper is
// its edit affordance).

import type { CanvasBinding } from "../../../controls/CanvasCard/types";
import { promptText } from "../prompts";
import { listPeople } from "../store/people";
import { listInitiatives, saveInitiative } from "../store/initiatives";
import { pickOwner, pickPeople } from "../priorities/dialogs";
import { getTemplate, listTemplates } from "../store/templates";
import { improvementSettingsJson } from "../store/config";
import { activeRoles, parseImprovementSettings, roleFillersAt } from "./templateModel";
import type { TemplateField, TemplateRole } from "./templateModel";
import { orgName as priorityOrgName } from "../priorities/model";

/** The header fields a charter field on this board may bind to: the
 *  app's standard fields (every initiative) + the template's own. Works
 *  for a template board (`tpl-<id>`) and an initiative board (`init-`,
 *  via the initiative's template). Labels are the fields' display
 *  labels; the group says where each is defined. */
export async function headerFieldsForBoard(boardId: string): Promise<{ key: string; label: string; group: string }[]> {
  const imp = parseImprovementSettings(await improvementSettingsJson().catch(() => ""));
  let templateId = boardId.startsWith("tpl-") ? boardId.slice(4) : "";
  if (boardId.startsWith("init-")) {
    const i = (await listInitiatives()).find((x) => x.boardId === boardId) ?? null;
    templateId = i?.templateId ?? "";
  }
  let tpl = templateId !== "" ? await getTemplate(templateId).catch(() => null) : null;
  // a template board whose id is not tpl-<templateId>: find it by boardId
  if (!tpl && boardId.startsWith("tpl-")) tpl = (await listTemplates().catch(() => [])).find((t) => t.boardId === boardId) ?? null;
  const out: { key: string; label: string; group: string }[] = [];
  const seen = new Set<string>();
  const add = (fs: TemplateField[], group: string) => {
    for (const f of fs) {
      if (f.key === "" || seen.has(f.key)) continue;
      seen.add(f.key);
      out.push({ key: f.key, label: f.label || f.key, group });
    }
  };
  add(imp.standardFields, "Standard fields");
  add(tpl?.fields ?? [], tpl ? `Template fields · ${tpl.name}` : "Template fields");
  return out;
}

/** EVERY bindable header target for a charter field on this board
 *  (Ben's review, 2026-09-15): the header itself, every role the template
 *  uses (standard, app-level and template roles alike), then the custom
 *  fields. `value` is the binding key the CanvasCard stores. */
export async function bindingTargetsForBoard(boardId: string): Promise<{ value: string; label: string; group: string }[]> {
  let templateId = boardId.startsWith("tpl-") ? boardId.slice(4) : "";
  let initiative: Awaited<ReturnType<typeof listInitiatives>>[number] | null = null;
  if (boardId.startsWith("init-")) {
    initiative = (await listInitiatives()).find((x) => x.boardId === boardId) ?? null;
    templateId = initiative?.templateId ?? "";
  }
  let tpl = templateId !== "" ? await getTemplate(templateId).catch(() => null) : null;
  if (!tpl && boardId.startsWith("tpl-")) tpl = (await listTemplates().catch(() => [])).find((t) => t.boardId === boardId) ?? null;
  const header: [string, string][] = [
    ["title", "Initiative title"],
    ["description", "Description"],
    ["period", "Period"],
    ["method", "Method"],
    ["status", "Status (read-only)"],
    ["stage", "Stage (read-only)"],
    ["stage_target", "Stage target date (read-only)"],
    ["org", "Organisation (read-only)"],
    ["org:site", "Site (read-only)"],
    ["org:department", "Department (read-only)"],
    ["org:area", "Area (read-only)"],
    ["priority", "Primary priority (read-only)"],
    ["template", "Template (read-only)"],
    ["metric:primary", "Primary metric (read-only)"],
  ];
  const out = header.map(([value, label]) => ({ value, label, group: "Initiative header" }));
  // roles: the template's active roles, else the initiative's snapshot
  const roles: { key: string; label: string }[] = tpl
    ? activeRoles(tpl).map((r: TemplateRole) => ({ key: r.key, label: r.label }))
    : Object.entries(initiative?.snapshot.roleLabels ?? {}).map(([key, label]) => ({ key, label }));
  for (const r of roles) out.push({ value: `role:${r.key}`, label: r.label, group: "Roles" });
  for (const f of await headerFieldsForBoard(boardId)) out.push({ value: `field:${f.key}`, label: f.label, group: f.group });
  return out;
}

/** Everyone holding a role on this board's initiative: the people
 *  assigned on the row plus the site's standard-role fillers for roles
 *  the template defines. Fronts the action-assignee picker on `init-`
 *  boards (Ben, 2026-08-27) — the rest of the roster stays behind the
 *  search box, as on meetings. */
export async function initiativeAssignees(boardId: string): Promise<{ whoId: string; who: string }[]> {
  const i = (await listInitiatives()).find((x) => x.boardId === boardId) ?? null;
  if (!i) return [];
  const imp = parseImprovementSettings(await improvementSettingsJson().catch(() => ""));
  const seen = new Set<string>();
  const out: { whoId: string; who: string }[] = [];
  const add = (p: { whoId: string; who: string }) => {
    const key = p.whoId !== "" ? p.whoId : p.who;
    if (p.who === "" || seen.has(key)) return;
    seen.add(key);
    out.push({ whoId: p.whoId, who: p.who });
  };
  for (const people of Object.values(i.roles)) for (const p of people) add(p);
  const roleKeys = new Set([...Object.keys(i.roles), ...Object.keys(i.snapshot.roleLabels)]);
  for (const std of imp.standardRoles) {
    if (!roleKeys.has(std.key)) continue;
    for (const p of roleFillersAt(std, i.org.site)) add(p);
  }
  return out;
}

export async function makeInitiativeBinding(boardId: string, onChanged: () => void): Promise<CanvasBinding | null> {
  const all = await listInitiatives();
  const i = all.find((x) => x.boardId === boardId) ?? null;
  if (!i) return null;
  const roster = await listPeople().catch(() => []);
  const host = document.body;
  // the fields' display labels, for the edit prompt's title
  const fieldLabel = new Map((await headerFieldsForBoard(boardId).catch(() => [])).map((f) => [f.key, f.label]));

  const tpl = i.templateId !== "" ? await getTemplate(i.templateId).catch(() => null) : null;
  const roleDefs = new Map((tpl ? activeRoles(tpl) : []).map((r) => [r.key, r]));
  const roleKeyOf = (bound: string): string | null => (bound === "owner" ? "owner" : bound.startsWith("role:") ? bound.slice(5) : null);
  const roleLabel = (key: string) => roleDefs.get(key)?.label ?? i.snapshot.roleLabels[key] ?? key;
  const READONLY = new Set(["stage", "stage_target", "status", "org", "org:site", "org:department", "org:area", "priority", "template", "metric:primary"]);

  const get = (bound: string): string => {
    if (bound === "title") return i.title;
    if (bound === "description") return i.description;
    if (bound === "period") return i.period;
    if (bound === "method") return i.method;
    if (bound === "status") return i.status;
    if (bound === "stage") return i.singleAction ? "single action" : (i.snapshot.stages.find((s) => s.id === i.stageId)?.name ?? "");
    if (bound === "stage_target") return i.stageTargets[i.stageId] ?? "";
    if (bound === "org") return priorityOrgName(i.org);
    if (bound === "org:site") return i.org.site;
    if (bound === "org:department") return i.org.department;
    if (bound === "org:area") return i.org.area;
    if (bound === "template") return tpl?.name ?? "";
    if (bound === "priority") return i.priorities.find((l) => l.primary)?.priorityId !== undefined ? (priorityLabel ?? "") : "";
    if (bound === "metric:primary") {
      const m = i.metrics.find((x) => x.primary) ?? i.metrics[0];
      return m ? `${m.name}${m.target !== null ? ` · plan ${m.target}${m.unit ? " " + m.unit : ""}` : ""}` : "";
    }
    const rk = roleKeyOf(bound);
    if (rk !== null) return (i.roles[rk] ?? []).map((p) => p.who).join(", ");
    if (bound.startsWith("field:")) return i.fieldValues[bound.slice(6)] ?? "";
    return "";
  };

  const canEdit = (bound: string): boolean => !READONLY.has(bound) && i.status === "active";
  const kind = (bound: string): "text" | "people" | "readonly" => (READONLY.has(bound) ? "readonly" : roleKeyOf(bound) !== null ? "people" : "text");

  /** Direct write of a text target (the card's inline editor). */
  const set = async (bound: string, value: string): Promise<void> => {
    const v = value.trim();
    if (bound === "title") i.title = v;
    else if (bound === "description") i.description = v;
    else if (bound === "period") i.period = v;
    else if (bound === "method") i.method = v;
    else if (bound.startsWith("field:")) i.fieldValues[bound.slice(6)] = v;
    else return;
    await saveInitiative(i);
    onChanged();
  };

  const edit = (bound: string): void => {
    void (async () => {
      const rk = roleKeyOf(bound);
      if (rk !== null) {
        const def = roleDefs.get(rk);
        const multi = def ? def.multi : rk !== "owner";
        const cur = i.roles[rk] ?? [];
        if (multi) {
          const res = await pickPeople(host, roster, cur, roleLabel(rk));
          if (res === null) return;
          i.roles[rk] = res.map((p) => ({ whoId: p.whoId, who: p.who }));
        } else {
          const res = await pickOwner(host, roster, cur[0] ?? null, roleLabel(rk));
          if (res === null) return;
          i.roles[rk] = res === "clear" ? [] : [{ whoId: res.whoId, who: res.who }];
        }
      } else {
        const labels: Record<string, string> = { title: "Initiative title", description: "Description", period: "Period", method: "Method" };
        const label = bound.startsWith("field:") ? (fieldLabel.get(bound.slice(6)) ?? bound.slice(6).replace(/_/g, " ")) : (labels[bound] ?? bound);
        const v = await promptText({ title: label, initial: get(bound), confirmLabel: "Save" });
        if (v === null) return;
        if (bound === "title") i.title = v.trim();
        else if (bound === "description") i.description = v.trim();
        else if (bound === "period") i.period = v.trim();
        else if (bound === "method") i.method = v.trim();
        else if (bound.startsWith("field:")) i.fieldValues[bound.slice(6)] = v.trim();
      }
      await saveInitiative(i);
      onChanged();
    })();
  };

  // the primary priority's statement (read-only target) — loaded once
  let priorityLabel: string | null = null;
  const primaryPriorityId = i.priorities.find((l) => l.primary)?.priorityId ?? "";
  if (primaryPriorityId !== "") {
    try {
      const { loadCascade } = await import("../store/priorities");
      priorityLabel = (await loadCascade("")).priorities.find((p) => p.id === primaryPriorityId)?.statement ?? "";
    } catch {
      priorityLabel = "";
    }
  }

  return { get, canEdit, edit, kind, set };
}
