// Ritual wizard screen — MeetingWizard mounted against the store, with
// the board designer embedded as its final "Meeting board" step. Create
// mode saves the ritual on entering that step (so the designer has a
// real board to edit — Agenda + Actions are already seeded); Done
// returns to Settings → Rituals. Edit mode tracks unsaved changes with
// the same amber bar + save/discard guard as Settings.

import { MeetingWizardView } from "../../../controls/MeetingWizard/editor";
import {
  parseWizardDraft,
  serializeWizardDraft,
} from "../../../controls/MeetingWizard/types";
import { parseOrgTree } from "../../../shared/schema/meeting";
import { parsePeople } from "../../../shared/schema/people";
import { el } from "../../../shared/ui/dom";
import { appTheme, editorHost } from "../cardHost";
import { detectHost } from "../runtime";
import { saveMeetingBoard } from "../store/boards";
import { meetingCategories, orgJson, rosterPatternLibrary } from "../store/config";
import { listPeople, searchEntra, upsertPerson, viewerPerson } from "../store/people";
import { currentViewer } from "../runtime";
import { setLeaveGuard } from "../navGuard";
import { promptUnsaved } from "../prompts";
import { effectivePerson } from "../viewAs";
import { getBoard } from "../store/boards";

function mintBoardId(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `board-${slug || "meeting"}-${Math.random().toString(36).slice(2, 6)}`;
}

export function mountWizard(parent: HTMLElement, editBoardId = ""): () => void {
  const host = editorHost(parent);
  // cancel (top-right of the wizard's title bar) → back to Rituals;
  // the leave guard still prompts if there are unsaved changes
  host.style.position = "relative";
  const cancel = el("a", "app-wizard-cancel", "✕") as HTMLAnchorElement;
  cancel.href = "#/settings/boards";
  cancel.title = "Cancel and return to Rituals";
  host.appendChild(cancel);
  let view: MeetingWizardView | null = null;
  let designerCleanup: (() => void) | null = null;
  void (async () => {
    const hosted = await detectHost();
    // creation is admin-gated; editing is open to admins AND the owner
    let editRaw = "";
    if (hosted) {
      const viewer = currentViewer()!;
      const stored = await viewerPerson(viewer.objectId);
      const me = stored ? effectivePerson(stored) : null; // honour view-as
      const isAdmin = me?.role === "superadmin" || me?.role === "siteadmin";
      if (editBoardId !== "") {
        const board = await getBoard(editBoardId);
        if (!board) {
          parent.appendChild(el("p", "app-missing", `Unknown board: ${editBoardId}`));
          return;
        }
        editRaw = board.occurrenceSettingsRaw;
        let ownerId = "";
        try {
          const blob = JSON.parse(editRaw) as { meeting?: { owner?: { whoId?: string } } };
          ownerId = blob.meeting?.owner?.whoId ?? "";
        } catch { /* no owner */ }
        if (!isAdmin && ownerId !== viewer.objectId) {
          parent.appendChild(
            el("div", "app-board-note", "Only admins or the meeting owner can edit this meeting.")
          );
          return;
        }
      } else if (!isAdmin) {
        parent.appendChild(
          el("div", "app-board-note", "Creating meetings is for site and super admins — ask yours, or request a role in Settings.")
        );
        return;
      }
    }
    const org = hosted ? await orgJson() : "[]";
    const peopleRaw = hosted
      ? JSON.stringify(
          (await listPeople()).map((p) => ({ whoId: p.whoId, who: p.who, crew: p.crew }))
        )
      : "[]";

    const editing = editBoardId !== "";
    // the board this wizard is bound to; minted when create mode reaches
    // the Meeting board step (that save also seeds Agenda + Actions)
    let boardId = editBoardId;
    let outputJson = editing ? serializeWizardDraft(parseWizardDraft(editRaw)) : "";
    let lastSavedRaw = editing ? editRaw : "";
    let dirty = false;

    // ---- unsaved-changes bar (same look as Settings) ----
    const saveBar = el("div", "app-save-bar");
    const saveMsg = el("span", "app-save-bar-msg", "You have unsaved changes.");
    const discardBtn = el("button", "app-btn", "Discard") as HTMLButtonElement;
    const saveNowBtn = el("button", "app-btn app-btn-primary", "Save now") as HTMLButtonElement;
    saveBar.append(saveMsg, el("span", "app-bar-gap"), discardBtn, saveNowBtn);
    parent.insertBefore(saveBar, host);
    const paintBar = () => {
      // before the board exists nothing is saved yet — a bar would lie
      saveBar.classList.toggle("app-save-bar-on", dirty && boardId !== "");
    };
    const markDirty = () => {
      if (!dirty) {
        dirty = true;
        paintBar();
      }
    };
    const markClean = () => {
      dirty = false;
      paintBar();
    };

    const saveBlob = async (): Promise<void> => {
      if (boardId === "") boardId = mintBoardId((JSON.parse(outputJson) as { title?: string }).title ?? "meeting");
      await saveMeetingBoard(boardId, outputJson);
      lastSavedRaw = outputJson;
      markClean();
    };
    discardBtn.addEventListener("click", () => {
      outputJson = lastSavedRaw === "" ? "" : serializeWizardDraft(parseWizardDraft(lastSavedRaw));
      view?.setDraft(parseWizardDraft(lastSavedRaw));
      markClean();
    });
    saveNowBtn.addEventListener("click", () => void saveBlob());

    // directory adds carry their Entra hit (email) for roster registration
    const dirCache = new Map<string, { mail: string }>();

    view = new MeetingWizardView(host, {
      onChange: (draft) => {
        outputJson = serializeWizardDraft(draft);
        markDirty();
      },
      onDirectoryAdd: (p) => {
        // register the invitee as an app person — but never overwrite
        // someone who already has a roster row (site/role would reset)
        void (async () => {
          if (await viewerPerson(p.whoId)) return;
          // joining the roster grants access — upsertPerson itself
          // syncs the access group (an admin who isn't a group owner
          // reconciles later via Sync now)
          await upsertPerson({
            whoId: p.whoId,
            who: p.who,
            email: dirCache.get(p.whoId)?.mail ?? "",
            site: "",
            department: "",
            area: "",
            role: "user",
            active: true,
          });
        })();
      },
      onSubmit: () => {
        // Done: persist anything outstanding, back to Settings → Rituals
        if (!hosted) {
          console.log("demo: create meeting", outputJson);
          return;
        }
        void (async () => {
          if (dirty || boardId === "") await saveBlob();
          window.location.hash = "#/settings/boards";
        })();
      },
    });
    view.setTheme(appTheme());
    view.setChrome(editing ? "Edit meeting" : "New meeting", "");
    view.setOrgTree(parseOrgTree(org));
    if (hosted) {
      view.setRosterPatterns(await rosterPatternLibrary());
      view.setMeetingCategories((await meetingCategories()).map((c) => c.name));
      // Entra search: invite anyone in the organisation, app user or not
      view.setDirectorySearch(async (q) => {
        const hits = await searchEntra(q);
        for (const h of hits) dirCache.set(h.objectId, { mail: h.mail });
        return hits.map((h) => ({
          whoId: h.objectId,
          who: h.displayName,
          initials: "",
        }));
      });
    }
    view.setPeople(parsePeople(peopleRaw));
    view.setDraft(parseWizardDraft(editRaw));
    view.setSubmitLabel("Done");

    // ---- the embedded Meeting board step ----
    // The designer DOM is built once and re-attached on every wizard
    // re-render, so board edits survive step navigation.
    let designerDiv: HTMLDivElement | null = null;
    view.setBoardStep((stepHost) => {
      if (designerDiv) {
        stepHost.appendChild(designerDiv);
        return;
      }
      designerDiv = document.createElement("div");
      designerDiv.className = "app-wizard-designer";
      stepHost.appendChild(designerDiv);
      void (async () => {
        if (!hosted) {
          designerDiv!.appendChild(
            el("div", "app-board-note", "The board designer needs the Power Apps host.")
          );
          return;
        }
        // create mode: reaching this step saves the ritual (seeding the
        // default Agenda + Actions board) so there is a board to design
        if (boardId === "") {
          const note = el("div", "app-board-note", "Saving the meeting…");
          designerDiv!.appendChild(note);
          await saveBlob();
          note.remove();
        }
        const { mountDesigner } = await import("./composer");
        designerCleanup = await mountDesigner(designerDiv!, boardId);
      })();
    });

    // leaving with unsaved meeting settings prompts save/discard/cancel
    if (hosted) {
      setLeaveGuard(async () => {
        if (!dirty || boardId === "") return true; // nothing saved yet = classic wizard bail
        const choice = await promptUnsaved();
        if (choice === "cancel") return false;
        if (choice === "save") await saveBlob();
        return true;
      });
    }
    if (!hosted) {
      parent.prepend(
        el("div", "app-board-note", "Demo mode — Done logs instead of saving.")
      );
    }
  })();
  return () => {
    setLeaveGuard(null);
    designerCleanup?.();
    view?.destroy();
  };
}
