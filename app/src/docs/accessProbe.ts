// Access diagnostics (5G0) — measured answers to the two questions the
// request-edit-access build rests on, runnable by ANY signed-in user
// (that is the point: the interesting run is a NON-admin's):
//
//   1. Can this user write the app-side requests LEDGER? The ledger is
//      its own row (ben_listid "__requests__") in the doc-libraries
//      table — deliberately NOT the "__app__" config row, so a request
//      write can never clobber the docs configuration.
//   2. Can this user, as an Entra OWNER of the Temporary Document
//      Editors group, add and remove a member? (Self-add, verified,
//      removed — and skipped entirely if they are ALREADY a member, so
//      a live grant is never disturbed.)
//
// Also reports plain visibility facts (roster role, group links,
// memberships) — the same facts that would have self-diagnosed the
// 2026-08-05 "documents not set up" security-role incident. Output is
// status-only: names and outcomes, never tokens or URLs.

import {
  accessGroup,
  isGroupMember,
  isGroupOwner,
} from "../store/accessGroup";
import { currentViewer } from "../runtime";
import { viewerPerson } from "../store/people";
import { appDocsConfig } from "./docsStore";
// the ledger transport lives with the request flow it carries (5G2);
// the probe exercises the REAL one, not a copy
import { AccessRequest, readLedger, writeLedger } from "./accessRequests";

export async function runAccessProbe(log: (line: string) => void): Promise<void> {
  const viewer = currentViewer();
  if (!viewer) {
    log("FAIL — no signed-in viewer (probe needs the hosted app).");
    return;
  }
  log(`Signed in as ${viewer.name} (${viewer.email}).`);

  // ---- roster + app access group (visibility facts) --------------------
  try {
    const me = await viewerPerson(viewer.objectId);
    log(
      me
        ? `OK — roster row found; app role: ${me.role}.`
        : "INFO — no roster row for this account (a super admin adds people under Settings → Users)."
    );
  } catch (e) {
    log(`FAIL — could not read the roster: ${trim(e)}`);
  }
  try {
    const ag = await accessGroup();
    if (ag) {
      const member = await isGroupMember(ag.id, viewer.objectId);
      log(`OK — app access group "${ag.name}": ${member ? "member" : "NOT a member"}.`);
    } else {
      log("INFO — no app access group configured.");
    }
  } catch (e) {
    log(`FAIL — could not read the app access group: ${trim(e)}`);
  }

  // ---- document groups (5G config) -------------------------------------
  let editorsId = "";
  let ownersId = "";
  try {
    const cfg = await appDocsConfig();
    const line = (label: string, id: string, name: string) =>
      log(id !== "" ? `OK — ${label} linked: ${name}.` : `INFO — ${label} not linked yet.`);
    line("Document controllers group", cfg.controllersGroupId, cfg.controllersGroupName);
    line("Owners & approvers group", cfg.ownersGroupId, cfg.ownersGroupName);
    line("Temporary editors group", cfg.editorsGroupId, cfg.editorsGroupName);
    editorsId = cfg.editorsGroupId;
    ownersId = cfg.ownersGroupId;
  } catch (e) {
    log(`FAIL — could not read the documents configuration: ${trim(e)}`);
  }
  if (ownersId !== "") {
    try {
      const inPool = await isGroupMember(ownersId, viewer.objectId);
      log(`INFO — owners & approvers pool: ${inPool ? "member" : "not a member"}.`);
    } catch (e) {
      log(`FAIL — could not read the owners & approvers group: ${trim(e)}`);
    }
  }

  // ---- probe 1: the requests ledger ------------------------------------
  log("— Ledger probe (the request-edit-access home) —");
  const marker = `probe:${viewer.objectId}:${Date.now()}`;
  // a WELL-FORMED entry — readLedger drops shapes a request never has
  const probeEntry: AccessRequest = {
    id: marker,
    listId: "",
    itemId: 0,
    uniqueId: marker,
    name: "access probe",
    who: { id: viewer.objectId, name: viewer.name, email: viewer.email },
    owners: [],
    reason: "access diagnostics probe entry",
    when: new Date().toISOString(),
  };
  try {
    const before = await readLedger();
    log(`OK — ledger row read (${before.length} entr${before.length === 1 ? "y" : "ies"}).`);
    await writeLedger([...before, probeEntry]);
    const after = await readLedger();
    if (after.some((e) => e.id === marker)) {
      log("OK — ledger write landed and read back.");
    } else {
      log("FAIL — the write reported success but the entry did not read back.");
    }
    await writeLedger(after.filter((e) => e.id !== marker));
    log("OK — probe entry removed.");
  } catch (e) {
    log(`FAIL — ledger write refused: ${trim(e)}`);
    log("   (The request flow would need per-user rows instead — the fallback design.)");
  }

  // ---- probe 2: editors-group membership as a group owner --------------
  log("— Editors-group probe (executing a grant) —");
  if (editorsId === "") {
    log("SKIP — no temporary editors group linked under Settings → Access control.");
    return;
  }
  try {
    const owner = await isGroupOwner(editorsId, viewer.objectId);
    log(
      owner
        ? "OK — you are an Entra OWNER of the editors group."
        : "INFO — you are NOT an owner of the editors group; membership changes below would be refused (the ownership hierarchy seeds owners in 5G3)."
    );
    if (await isGroupMember(editorsId, viewer.objectId)) {
      log("SKIP — you are ALREADY a member (a live grant?) — add/remove not attempted, a real membership is never disturbed.");
      return;
    }
    const { addMember, removeMember } = await import("../store/accessGroup");
    await addMember(editorsId, viewer.objectId);
    const added = await isGroupMember(editorsId, viewer.objectId);
    log(added ? "OK — self-add landed (verified by read-back)." : "FAIL — add reported success but membership did not read back.");
    await removeMember(editorsId, viewer.objectId);
    const gone = !(await isGroupMember(editorsId, viewer.objectId));
    log(gone ? "OK — self-remove landed; the group is back as it was." : "FAIL — remove reported success but membership persists — remove it in Entra.");
  } catch (e) {
    log(`FAIL — editors-group membership change refused: ${trim(e)}`);
  }
}

const trim = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).slice(0, 300);
