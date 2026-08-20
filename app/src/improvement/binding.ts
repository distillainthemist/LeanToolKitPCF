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
import { pickOwner } from "../priorities/dialogs";

export async function makeInitiativeBinding(boardId: string, onChanged: () => void): Promise<CanvasBinding | null> {
  const all = await listInitiatives();
  const i = all.find((x) => x.boardId === boardId) ?? null;
  if (!i) return null;
  const roster = await listPeople().catch(() => []);
  const host = document.body;

  const get = (bound: string): string => {
    if (bound === "title") return i.title;
    if (bound === "description") return i.description;
    if (bound === "owner") return (i.roles.owner ?? []).map((p) => p.who).join(", ");
    if (bound === "period") return i.period;
    if (bound === "stage") {
      if (i.singleAction) return "single action";
      return i.snapshot.stages.find((s) => s.id === i.stageId)?.name ?? "";
    }
    if (bound.startsWith("field:")) return i.fieldValues[bound.slice(6)] ?? "";
    return "";
  };

  const canEdit = (bound: string): boolean => bound !== "stage" && i.status === "active";

  const edit = (bound: string): void => {
    void (async () => {
      if (bound === "owner") {
        const res = await pickOwner(host, roster, (i.roles.owner ?? [])[0] ?? null);
        if (res === null) return;
        i.roles.owner = res === "clear" ? [] : [{ whoId: res.whoId, who: res.who }];
      } else {
        const labels: Record<string, string> = { title: "Initiative title", description: "Description", period: "Period" };
        const label = bound.startsWith("field:") ? bound.slice(6).replace(/_/g, " ") : (labels[bound] ?? bound);
        const v = await promptText({ title: label, initial: get(bound), confirmLabel: "Save" });
        if (v === null) return;
        if (bound === "title") i.title = v.trim();
        else if (bound === "description") i.description = v.trim();
        else if (bound === "period") i.period = v.trim();
        else if (bound.startsWith("field:")) i.fieldValues[bound.slice(6)] = v.trim();
      }
      await saveInitiative(i);
      onChanged();
    })();
  };

  return { get, canEdit, edit };
}
